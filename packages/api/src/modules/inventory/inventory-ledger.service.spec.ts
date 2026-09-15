import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryLedgerService, type LedgerMovement } from './inventory-ledger.service';

function mockTx(opts: { onHand?: string; replay?: any; itemActive?: boolean; locationActive?: boolean; missingItem?: boolean } = {}) {
  const created: any[] = [];
  const updates: any[] = [];
  const tx = {
    inventoryTransaction: {
      findUnique: vi.fn().mockResolvedValue(opts.replay ?? null),
      create: vi.fn().mockImplementation(async ({ data }: any) => { created.push(data); return { id: 'txn-1', ...data }; }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    inventoryItem: {
      findFirst: vi.fn().mockResolvedValue(opts.missingItem ? null : { id: 'item-1', active: opts.itemActive ?? true, unitCostCents: new Prisma.Decimal(200) }),
    },
    inventoryLocation: {
      findFirst: vi.fn().mockResolvedValue({ id: 'loc-1', active: opts.locationActive ?? true }),
    },
    inventoryBalance: {
      upsert: vi.fn().mockResolvedValue({ id: 'bal-1' }),
      update: vi.fn().mockImplementation(async ({ data }: any) => { updates.push(data); return { id: 'bal-1', ...data }; }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'bal-1', onHand: new Prisma.Decimal(opts.onHand ?? '10') }]),
  };
  return { tx, created, updates };
}

const base: LedgerMovement = {
  organizationId: 'org-1', facilityId: 'fac-1', itemId: 'item-1', locationId: 'loc-1', userId: 'user-1',
  type: 'transfer_out', quantity: 3,
};

describe('InventoryLedgerService.apply', () => {
  const service = new InventoryLedgerService({} as any);

  it('locks the balance row and writes balance and ledger from the locked value', async () => {
    const { tx, created, updates } = mockTx({ onHand: '10' });
    await service.apply(tx as any, base);

    const lockSql = tx.$queryRaw.mock.calls[0][0].join('?');
    expect(lockSql).toContain('FOR UPDATE');
    expect(updates[0].onHand.toString()).toBe('7');
    expect(created[0]).toMatchObject({ type: 'transfer_out', facilityId: 'fac-1', userId: 'user-1' });
    expect(created[0].quantityBefore.toString()).toBe('10');
    expect(created[0].quantityDelta.toString()).toBe('-3');
    expect(created[0].quantityAfter.toString()).toBe('7');
    // Valued at the item's cost when no cost is supplied.
    expect(created[0].valueDeltaCents.toString()).toBe('-600');
  });

  it('never updates or deletes ledger rows', async () => {
    const { tx } = mockTx();
    await service.apply(tx as any, base);
    expect(tx.inventoryTransaction.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.delete).not.toHaveBeenCalled();
  });

  it('returns the original transaction for a replayed idempotency key without moving stock', async () => {
    const replay = { id: 'txn-0', itemId: 'item-1', locationId: 'loc-1', type: 'transfer_out' };
    const { tx } = mockTx({ replay });
    const result = await service.apply(tx as any, { ...base, idempotencyKey: 'k1' });
    expect(result).toEqual({ transaction: replay, replayed: true });
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused for a different movement', async () => {
    const { tx } = mockTx({ replay: { id: 'txn-0', itemId: 'other', locationId: 'loc-1', type: 'receive' } });
    await expect(service.apply(tx as any, { ...base, idempotencyKey: 'k1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to take stock negative with a conflict, writing nothing', async () => {
    const { tx } = mockTx({ onHand: '2' });
    await expect(service.apply(tx as any, { ...base, quantity: 5 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('turns validation failures into bad requests', async () => {
    const { tx } = mockTx();
    await expect(service.apply(tx as any, { ...base, type: 'waste', quantity: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stamps lastCountedAt only for counts', async () => {
    const count = mockTx({ onHand: '10' });
    await service.apply(count.tx as any, { ...base, type: 'count_adjustment', quantity: 8, reasonCode: 'count_correction' });
    expect(count.updates[0].lastCountedAt).toBeInstanceOf(Date);

    const receive = mockTx({ onHand: '10' });
    await service.apply(receive.tx as any, { ...base, type: 'receive', quantity: 1 });
    expect(receive.updates[0].lastCountedAt).toBeUndefined();
  });

  it('refuses movements against missing items and inactive locations', async () => {
    await expect(service.apply(mockTx({ missingItem: true }).tx as any, base)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.apply(mockTx({ locationActive: false }).tx as any, base)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.apply(mockTx({ itemActive: false }).tx as any, base)).rejects.toBeInstanceOf(BadRequestException);
  });
});

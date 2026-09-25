import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { InventoryService } from '../src/inventory.service';
import type { PrismaService } from '../src/prisma.service';

const manager: Identity = {
  subject: 'manager-1', tenantId: '00000000-0000-0000-0000-000000000001',
  capabilities: ['operations:read', 'operations:write'], venueIds: ['00000000-0000-0000-0000-000000000002'],
  eventIds: ['00000000-0000-0000-0000-000000000003'], locationIds: ['00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010'], assignableUserIds: [],
};

function harness(query: (sql: string) => unknown = () => []) {
  const tx = {
    $queryRaw: vi.fn((parts: TemplateStringsArray) => Promise.resolve(query(parts.join('?')))),
    $executeRaw: vi.fn().mockResolvedValue(1),
    commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: manager.eventIds[0], venueId: manager.venueIds[0] }) },
    venue: { findFirst: vi.fn().mockResolvedValue({ id: manager.venueIds[0] }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: manager.locationIds[0] }) },
  };
  const prisma = { withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)) } as unknown as PrismaService;
  return { service: new InventoryService(prisma), tx };
}

describe('inventory count workflow', () => {
  it('requires an independently scoped manager to approve', async () => {
    const { service } = harness(sql => sql.includes('SELECT venue_id')
      ? [{ venueId: manager.venueIds[0], locationId: null, state: 'SUBMITTED', counterId: manager.subject }]
      : []);
    await expect(service.approve(manager, manager.eventIds[0], '00000000-0000-0000-0000-000000000005', { reason: 'Verified with supervisor' }, 'inventory-approve-key-0001'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not expose counts outside assigned event scope', async () => {
    const { service, tx } = harness();
    const otherEvent = '00000000-0000-0000-0000-000000000099';
    await expect(service.listCounts(manager, otherEvent)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects stale counts before writing any stock movement', async () => {
    const { service, tx } = harness(sql => {
      if (sql.includes('SELECT venue_id')) return [{ venueId: manager.venueIds[0], locationId: null, state: 'SUBMITTED', counterId: 'counter-1' }];
      if (sql.includes('SELECT l.item_id')) return [{ itemId: '00000000-0000-0000-0000-000000000006', expected: '10.000', counted: '8.000', onHand: '11.000' }];
      return [];
    });
    await expect(service.approve(manager, manager.eventIds[0], '00000000-0000-0000-0000-000000000005', { reason: 'Verified variance' }, 'inventory-approve-key-0002'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses to dispatch more stock than is currently available', async () => {
    const { service, tx } = harness(sql => {
      if (sql.includes('FROM stock_transfers WHERE')) return [{ venueId: manager.venueIds[0], sourceLocationId: null, destinationLocationId: '00000000-0000-0000-0000-000000000010', state: 'REQUESTED', requestedBy: 'requester' }];
      if (sql.includes('FROM stock_transfer_lines l')) return [{ id: '00000000-0000-0000-0000-000000000011', sourceItemId: '00000000-0000-0000-0000-000000000012', quantity: '5.000', sku: 'WATER', name: 'Bottled water', unit: 'case', onHand: '2.000' }];
      return [];
    });
    await expect(service.dispatchTransfer(manager, manager.eventIds[0], '00000000-0000-0000-0000-000000000013', 'stock-transfer-dispatch-key-01'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('requires an independent receiver for in-transit stock', async () => {
    const { service, tx } = harness(sql => sql.includes('FROM stock_transfers WHERE')
      ? [{ venueId: manager.venueIds[0], sourceLocationId: null, destinationLocationId: null, state: 'IN_TRANSIT', dispatchedBy: manager.subject, requestedBy: 'requester' }]
      : []);
    await expect(service.receiveTransfer(manager, manager.eventIds[0], '00000000-0000-0000-0000-000000000014', {
      lines: [{ lineId: '00000000-0000-0000-0000-000000000015', quantity: 3 }],
    }, 'stock-transfer-receive-key-01')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('credits only received quantities and requires variance rationale', async () => {
    const { service, tx } = harness(sql => {
      if (sql.includes('FROM stock_transfers WHERE')) return [{ venueId: manager.venueIds[0], sourceLocationId: null, destinationLocationId: null, state: 'IN_TRANSIT', dispatchedBy: 'dispatcher-1', requestedBy: 'requester' }];
      if (sql.includes('FROM stock_transfer_lines WHERE')) return [{ id: '00000000-0000-0000-0000-000000000016', destinationItemId: '00000000-0000-0000-0000-000000000017', requestedQuantity: '5.000' }];
      return [];
    });
    await expect(service.receiveTransfer(manager, manager.eventIds[0], '00000000-0000-0000-0000-000000000018', {
      lines: [{ lineId: '00000000-0000-0000-0000-000000000016', quantity: 4 }],
    }, 'stock-transfer-receive-key-02')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

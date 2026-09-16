import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafeWranglerOperatorService } from './safe-wrangler-operator.service';
import { WranglerOperatorService } from './wrangler-operator.service';

describe('SafeWranglerOperatorService', () => {
  it('rejects direct write plans from non-manager members', async () => {
    const reservations = { saveReservation: vi.fn() };
    const service = new SafeWranglerOperatorService({} as never, reservations as never);

    await expect(service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'staff-1', fullName: 'Staff Member', role: 'staff', allAccess: false },
      plan: { tool: 'CREATE_RESERVATION', args: { guestName: 'Guest', partySize: 2, reservationTime: '2026-08-10T18:00:00.000Z' } },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservations.saveReservation).not.toHaveBeenCalled();
  });

  it('rejects invalid reservation statuses before Prisma receives them', async () => {
    const prisma = {
      reservation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'reservation-1', guestName: 'Guest', partySize: 2,
          reservationTime: new Date('2026-08-10T18:00:00.000Z'), durationMinutes: 90,
          status: 'confirmed', notes: null, source: 'direct', tags: [], specialRequests: null,
          guestPhone: null, guestEmail: null,
        }),
      },
    };
    const reservations = { saveReservation: vi.fn() };
    const service = new SafeWranglerOperatorService(prisma as never, reservations as never);

    await expect(service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'manager-1', fullName: 'Manager', role: 'manager', allAccess: false },
      plan: { tool: 'UPDATE_RESERVATION', args: { reservationId: 'reservation-1', status: 'garbage' } },
    })).rejects.toThrow('Invalid reservation status');
    expect(reservations.saveReservation).not.toHaveBeenCalled();
  });

  it('executes CLEAR_TABLE command to clear a table status', async () => {
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'plan-1' }) },
      floorTable: { findMany: vi.fn().mockResolvedValue([{ id: 'table-3', label: '3' }]) },
      tableState: {
        findFirst: vi.fn().mockResolvedValue({ id: 'ts-3', status: 'seated' }),
        update: vi.fn().mockResolvedValue({ id: 'ts-3', status: 'available' }),
      },
      tableAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const service = new WranglerOperatorService(prisma as never);

    const result = await service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'manager-1', fullName: 'Manager', role: 'manager', allAccess: true },
      plan: { tool: 'CLEAR_TABLE', args: { tableId: 'table-3', tableLabel: '3', status: 'available' }, summary: 'Clear table 3.', risk: 'operational_write' },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ id: 'table-3', label: '3', status: 'available' });
    expect(prisma.tableState.update).toHaveBeenCalledWith({
      where: { id: 'ts-3' },
      data: expect.objectContaining({ status: 'available', partySize: null, seatedAt: null }),
    });
    expect(prisma.tableAssignment.updateMany).toHaveBeenCalledWith({
      where: { venueId: 'venue-1', tableId: 'table-3', releasedAt: null },
      data: expect.objectContaining({ releasedAt: expect.any(Date) }),
    });
  });

  it('executes UPDATE_ITEM_86 command across Inventory domain', async () => {
    const prisma = {
      prepBoardItem: {
        create: vi.fn().mockResolvedValue({ id: 'prep-1', title: 'Tuna Tartare', kind: 'eighty_six', status: 'open' }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-4' }) },
    };
    const service = new WranglerOperatorService(prisma as never);

    const result = await service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'manager-1', fullName: 'Manager', role: 'manager', allAccess: true },
      plan: {
        tool: 'UPDATE_ITEM_86',
        args: { itemName: 'Tuna Tartare', isEightySix: true },
        summary: '86 item Tuna Tartare.',
        risk: 'operational_write',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ id: 'prep-1', itemName: 'Tuna Tartare', isEightySix: true });
  });

  it('does not invent a table target when fallback parsing lacks one', async () => {
    const service = new WranglerOperatorService({} as never);

    const parsed = (service as any).fallbackParse('clear table');

    expect(parsed).toEqual({ tool: 'CLEAR_TABLE', args: {}, summary: 'Clear the requested table.' });
  });

  it('rejects invalid table statuses before Prisma receives them', async () => {
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({ id: 'plan-1' }) },
      floorTable: { findMany: vi.fn().mockResolvedValue([{ id: 'table-3', label: '3' }]) },
      tableState: { findFirst: vi.fn() },
    };
    const service = new WranglerOperatorService(prisma as never);

    await expect(service.execute({
      venueId: 'venue-1',
      actor: { profileId: 'manager-1', fullName: 'Manager', role: 'manager', allAccess: true },
      plan: { tool: 'UPDATE_TABLE_STATUS', args: { tableLabel: '3', status: 'destroyed' }, summary: 'Update table 3.', risk: 'operational_write' },
    })).rejects.toThrow('Invalid table status');
    expect(prisma.floorTable.findMany).not.toHaveBeenCalled();
  });
});

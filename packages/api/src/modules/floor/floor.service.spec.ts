import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FloorService } from './floor.service';

describe('FloorService regressions', () => {
  it('serializes floor-plan saves per venue', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', width: 800, height: 600 }),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      floorTable: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
      tableAssignment: { count: vi.fn().mockResolvedValue(0) },
      floorChair: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    await service.saveFloorPlan('venue-1', { tables: [] });

    expect(transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(transaction.floorPlan.findFirst).toHaveBeenCalledWith({ where: { venueId: 'venue-1', isActive: true } });
  });

  it('returns the saved seat-label style in the active floor payload', async () => {
    const now = new Date();
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({
        id: 'plan-1', venueId: 'venue-1', name: 'Main', width: 900, height: 600,
        backgroundImageUrl: null, isActive: true, createdAt: now, updatedAt: now,
        chairs: [],
        tables: [{
          id: 'table-1', floorPlanId: 'plan-1', label: '12', shape: 'round', seats: 4,
          seatLabelStyle: 'letter', x: 10, y: 20, width: 80, height: 80, rotation: 0,
          section: 'main', minSpend: 0, isReservable: true,
        }],
      }) },
      tableState: { findMany: vi.fn().mockResolvedValue([]) },
      tableAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new FloorService(prisma as any, {} as any);

    const result = await service.getActiveFloorPlan('venue-1');

    expect(result?.tables[0].table.seatLabelStyle).toBe('letter');
  });

  it('requires an existing merge to be split before those tables are merged again', async () => {
    const prisma = {
      floorPlan: { findFirst: vi.fn().mockResolvedValue({ tables: [{ id: 't1' }, { id: 't2' }] }) },
      tableState: { findMany: vi.fn().mockResolvedValue([
        { id: 's1', tableId: 't1', status: 'seated', mergeGroupId: 'group-1' },
        { id: 's2', tableId: 't2', status: 'seated', mergeGroupId: 'group-1' },
      ]), updateMany: vi.fn() },
    };
    const service = new FloorService(prisma as any, {} as any);

    await expect(service.mergeTablesForParty('venue-1', ['t1', 't2'], 6)).rejects.toThrow(ConflictException);
    expect(prisma.tableState.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a table-status write that loses an optimistic concurrency race', async () => {
    const lastActivityAt = new Date();
    const prisma = {
      tableState: {
        findFirst: vi.fn().mockResolvedValue({ id: 'state-1', lastActivityAt }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new FloorService(prisma as any, {} as any);

    await expect(service.updateTableStatus('venue-1', 'table-1', 'dirty')).rejects.toThrow(
      'Table status changed. Refresh and try again.',
    );
    expect(prisma.tableState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'state-1', venueId: 'venue-1', lastActivityAt },
    }));
  });

  it('lists archived floor plans for a venue', async () => {
    const now = new Date();
    const prisma = {
      floorPlan: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'archived-1',
            name: '[Archived Backup] Main Floor (2026-09-07 12:00:00)',
            width: 800,
            height: 600,
            backgroundImageUrl: null,
            _count: { tables: 15, chairs: 60 },
            createdAt: now,
            updatedAt: now,
          },
        ]),
      },
    };
    const service = new FloorService(prisma as any, {} as any);

    const result = await service.listArchivedFloorPlans('venue-1');
    expect(prisma.floorPlan.findMany).toHaveBeenCalledWith({
      where: { venueId: 'venue-1', isActive: false },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { tables: true, chairs: true } } },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('archived-1');
    expect(result[0].tableCount).toBe(15);
  });

  it('restores an archived floor plan and creates missing table states', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            id: 'archived-1',
            name: 'Old Layout',
            isActive: false,
            tables: [{ id: 'table-arch-1' }],
            chairs: [],
          })
          .mockResolvedValueOnce({
            id: 'current-active',
            isActive: true,
          }),
        update: vi.fn().mockResolvedValue({ id: 'archived-1' }),
      },
      tableState: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'ts-new' }),
      },
    };
    const prisma = {
      $transaction: vi.fn((cb: any) => cb(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    const result = await service.restoreArchivedFloorPlan('venue-1', 'archived-1');

    expect(result.ok).toBe(true);
    expect(transaction.floorPlan.update).toHaveBeenCalledWith({
      where: { id: 'current-active' },
      data: { isActive: false },
    });
    expect(transaction.floorPlan.update).toHaveBeenCalledWith({
      where: { id: 'archived-1' },
      data: { isActive: true },
    });
    expect(transaction.tableState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        venueId: 'venue-1',
        tableId: 'table-arch-1',
        status: 'available',
      }),
    });
  });

  it('does NOT create backup when backupPriorPlan is false, even if name mentions overwrite', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      floorPlan: {
        findFirst: vi.fn().mockResolvedValue({ id: 'plan-1', name: 'Main', width: 800, height: 600 }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      floorTable: {
        count: vi.fn().mockResolvedValue(5),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
      tableAssignment: { count: vi.fn().mockResolvedValue(0) },
      floorChair: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((cb: any) => cb(transaction)),
    };
    const service = new FloorService(prisma as any, {} as any);

    await service.saveFloorPlan('venue-1', {
      name: 'Event (Live Floor Plan Overwrite)',
      tables: [],
      backupPriorPlan: false,
    });

    expect(transaction.floorPlan.create).not.toHaveBeenCalled();
  });
});

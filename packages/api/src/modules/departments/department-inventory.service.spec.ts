import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { DepartmentInventoryService } from './department-inventory.service';

describe('DepartmentInventoryService', () => {
  const mockPrisma = (opts: {
    items?: any[];
    membership?: boolean;
    venue?: any;
    transfer?: any;
  }) => {
    return {
      department: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id) return { id: where.id, facilityId: where.facilityId };
          return null;
        }),
      },
      departmentMembership: {
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where?.department?.code?.in) {
            return null;
          }
          if (where?.departmentId === 'dept-culinary' && opts.membership) {
            return { id: 'mem-culinary' };
          }
          return null;
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      userAreaOverride: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      departmentInventoryItem: {
        findMany: vi.fn().mockResolvedValue(opts.items ?? []),
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return opts.items?.find((i) => i.id === where.id && i.departmentId === where.departmentId) ?? null;
        }),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.facilityId_departmentId_sku) {
            const { departmentId, sku } = where.facilityId_departmentId_sku;
            return opts.items?.find((i) => i.departmentId === departmentId && i.sku === sku) ?? null;
          }
          return opts.items?.find((i) => i.id === where.id) ?? null;
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-item-id', ...data })),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      departmentInventoryMovement: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-mov-id', ...data })),
      },
      inventoryTransferRequest: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 'new-tr-id', ...data })),
        findUnique: vi.fn().mockResolvedValue(opts.transfer ?? null),
        update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: opts.transfer?.id, ...opts.transfer, ...data })),
      },
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(opts.venue ?? { organizationId: 'org-1' }),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockPrisma(opts))),
    } as any;
  };

  const culinaryUser = {
    userId: 'user-cook',
    role: 'executive_chef',
    venueId: 'facility-1',
    profileId: 'p-cook',
  };

  const warehouseManager = {
    userId: 'user-wm',
    role: 'warehouse_manager',
    venueId: 'facility-1',
    profileId: 'p-wm',
  };

  describe('Isolation: listItems & getItem', () => {
    it('allows culinary user to list their own department inventory', async () => {
      const items = [{ id: 'item-1', name: 'Flour', departmentId: 'dept-culinary', sku: 'FLOUR-01' }];
      const prisma = mockPrisma({ items, membership: true });
      const service = new DepartmentInventoryService(prisma);

      const result = await service.listItems('facility-1', 'dept-culinary', culinaryUser);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Flour');
    });

    it('denies culinary user from listing beverage inventory with 403 Forbidden', async () => {
      const items = [{ id: 'item-2', name: 'Vodka', departmentId: 'dept-beverage', sku: 'VODKA-01' }];
      const prisma = mockPrisma({ items, membership: true });
      const service = new DepartmentInventoryService(prisma);

      await expect(service.listItems('facility-1', 'dept-beverage', culinaryUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows warehouse_manager to list any department inventory', async () => {
      const items = [{ id: 'item-2', name: 'Vodka', departmentId: 'dept-beverage', sku: 'VODKA-01' }];
      const prisma = mockPrisma({ items });
      const service = new DepartmentInventoryService(prisma);

      const result = await service.listItems('facility-1', 'dept-beverage', warehouseManager);
      expect(result).toHaveLength(1);
    });

    it('denies culinary user from fetching a beverage item by guessable ID', async () => {
      const items = [{ id: 'bev-123', name: 'Vodka', departmentId: 'dept-beverage', sku: 'VODKA-01' }];
      const prisma = mockPrisma({ items, membership: true });
      const service = new DepartmentInventoryService(prisma);

      await expect(service.getItem('facility-1', 'dept-beverage', 'bev-123', culinaryUser)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Movements & 86', () => {
    it('records an 86 movement and sets onHand to 0 and status to 86ed', async () => {
      const items = [{ id: 'item-1', name: 'Burger Buns', departmentId: 'dept-culinary', sku: 'BUN-01', onHand: 50, status: 'active' }];
      const prisma = mockPrisma({ items, membership: true });
      const service = new DepartmentInventoryService(prisma);

      const result = await service.recordMovement(
        'facility-1',
        'dept-culinary',
        'item-1',
        { movementType: '86', quantity: 0, notes: 'Ran out during halftime' },
        culinaryUser,
      );

      expect(result.item.onHand).toBe(0);
      expect(result.item.status).toBe('86ed');
      expect(result.movement.movementType).toBe('86');
    });

    it('records a receive movement and increments onHand', async () => {
      const items = [{ id: 'item-1', name: 'Flour', departmentId: 'dept-culinary', sku: 'FLOUR-01', onHand: 10, status: 'active' }];
      const prisma = mockPrisma({ items, membership: true });
      const service = new DepartmentInventoryService(prisma);

      const result = await service.recordMovement(
        'facility-1',
        'dept-culinary',
        'item-1',
        { movementType: 'receive', quantity: 20 },
        culinaryUser,
      );

      expect(result.item.onHand).toBe(30);
      expect(result.movement.movementType).toBe('receive');
    });
  });

  describe('Transfers between departments', () => {
    it('allows source department to request transfer', async () => {
      const prisma = mockPrisma({ membership: true });
      const service = new DepartmentInventoryService(prisma);

      const result = await service.requestTransfer(
        'facility-1',
        'dept-culinary',
        {
          toDepartmentId: 'dept-banquet',
          items: [{ sku: 'FLOUR-01', name: 'Flour', quantity: 5 }],
        },
        culinaryUser,
      );

      expect(result.fromDepartmentId).toBe('dept-culinary');
      expect(result.toDepartmentId).toBe('dept-banquet');
      expect(result.status).toBe('pending');
    });

    it('rejects approval from non-warehouse/non-leadership user', async () => {
      const transfer = {
        id: 'tr-1',
        facilityId: 'facility-1',
        organizationId: 'org-1',
        fromDepartmentId: 'dept-culinary',
        toDepartmentId: 'dept-banquet',
        status: 'pending',
        items: [{ sku: 'FLOUR-01', name: 'Flour', quantity: 5 }],
      };
      const prisma = mockPrisma({ transfer, membership: true });
      const service = new DepartmentInventoryService(prisma);

      await expect(service.approveTransfer('facility-1', 'tr-1', culinaryUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows warehouse_manager to approve transfer and updates both ledgers', async () => {
      const transfer = {
        id: 'tr-1',
        facilityId: 'facility-1',
        organizationId: 'org-1',
        fromDepartmentId: 'dept-warehouse',
        toDepartmentId: 'dept-culinary',
        status: 'pending',
        items: [{ sku: 'FLOUR-01', name: 'Flour', quantity: 5 }],
      };
      const items = [
        { id: 'wh-flour', departmentId: 'dept-warehouse', sku: 'FLOUR-01', name: 'Flour', onHand: 100, unit: 'bag' },
        { id: 'cul-flour', departmentId: 'dept-culinary', sku: 'FLOUR-01', name: 'Flour', onHand: 10, unit: 'bag' },
      ];
      const prisma = mockPrisma({ transfer, items });
      const service = new DepartmentInventoryService(prisma);

      const approved = await service.approveTransfer('facility-1', 'tr-1', warehouseManager);
      expect(approved.status).toBe('completed');
      expect(approved.approvedBy).toBe(warehouseManager.userId);
    });
  });
});

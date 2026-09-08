import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { assertDepartmentAccess, canAccessAllDepartments, getAllowedDepartmentIds } from './department-auth.helper';

describe('department-auth.helper', () => {
  const mockPrisma = (opts: {
    warehouseMembership?: boolean;
    departmentMembership?: boolean;
    userOverride?: boolean;
    memberships?: Array<{ departmentId: string }>;
    overrides?: Array<{ departmentId: string | null }>;
  }) => ({
    departmentMembership: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.department?.code?.in) {
          return opts.warehouseMembership ? { id: 'mem-wh' } : null;
        }
        return opts.departmentMembership ? { id: 'mem-dept' } : null;
      }),
      findMany: vi.fn().mockResolvedValue(opts.memberships ?? []),
    },
    userAreaOverride: {
      findFirst: vi.fn().mockResolvedValue(opts.userOverride ? { id: 'override-1' } : null),
      findMany: vi.fn().mockResolvedValue(opts.overrides ?? []),
    },
  } as any);

  describe('canAccessAllDepartments', () => {
    it.each([
      'admin',
      'owner',
      'platform_admin',
      'organization_admin',
      'manager',
      'fnb_director',
      'event_manager',
      'warehouse_manager',
      'procurement_manager',
    ])('allows cross-department role %s without checking DB', async (role) => {
      const prisma = mockPrisma({});
      const allowed = await canAccessAllDepartments(
        { userId: 'u1', role, venueId: 'v1', profileId: 'p1' },
        'v1',
        prisma,
      );
      expect(allowed).toBe(true);
      expect(prisma.departmentMembership.findFirst).not.toHaveBeenCalled();
    });

    it('allows a user with WAREHOUSE membership even if their role is staff', async () => {
      const prisma = mockPrisma({ warehouseMembership: true });
      const allowed = await canAccessAllDepartments(
        { userId: 'u1', role: 'staff', venueId: 'v1', profileId: 'p1' },
        'v1',
        prisma,
      );
      expect(allowed).toBe(true);
    });

    it('denies department-scoped roles like executive_chef if not in warehouse/procurement', async () => {
      const prisma = mockPrisma({ warehouseMembership: false });
      const allowed = await canAccessAllDepartments(
        { userId: 'u1', role: 'executive_chef', venueId: 'v1', profileId: 'p1' },
        'v1',
        prisma,
      );
      expect(allowed).toBe(false);
    });
  });

  describe('assertDepartmentAccess', () => {
    it('allows cross-department role to access any department', async () => {
      const prisma = mockPrisma({});
      await expect(
        assertDepartmentAccess(
          { userId: 'u1', role: 'fnb_director', venueId: 'v1', profileId: 'p1' },
          'v1',
          'dept-beverage',
          prisma,
        ),
      ).resolves.toBeUndefined();
    });

    it('allows executive_chef into culinary when they have culinary membership', async () => {
      const prisma = mockPrisma({ departmentMembership: true });
      await expect(
        assertDepartmentAccess(
          { userId: 'u1', role: 'executive_chef', venueId: 'v1', profileId: 'p1' },
          'v1',
          'dept-culinary',
          prisma,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException (403) when executive_chef tries to access beverage', async () => {
      const prisma = mockPrisma({ departmentMembership: false, userOverride: false });
      await expect(
        assertDepartmentAccess(
          { userId: 'u1', role: 'executive_chef', venueId: 'v1', profileId: 'p1' },
          'v1',
          'dept-beverage',
          prisma,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows access via active UserAreaOverride', async () => {
      const prisma = mockPrisma({ departmentMembership: false, userOverride: true });
      await expect(
        assertDepartmentAccess(
          { userId: 'u1', role: 'server', venueId: 'v1', profileId: 'p1' },
          'v1',
          'dept-banquet',
          prisma,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('getAllowedDepartmentIds', () => {
    it('returns "all" for warehouse_manager', async () => {
      const prisma = mockPrisma({});
      const result = await getAllowedDepartmentIds(
        { userId: 'u1', role: 'warehouse_manager', venueId: 'v1', profileId: 'p1' },
        'v1',
        prisma,
      );
      expect(result).toBe('all');
    });

    it('returns list of department IDs for isolated staff', async () => {
      const prisma = mockPrisma({
        memberships: [{ departmentId: 'dept-1' }],
        overrides: [{ departmentId: 'dept-2' }],
      });
      const result = await getAllowedDepartmentIds(
        { userId: 'u1', role: 'server', venueId: 'v1', profileId: 'p1' },
        'v1',
        prisma,
      );
      expect(result).toEqual(['dept-1', 'dept-2']);
    });
  });
});

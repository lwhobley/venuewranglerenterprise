import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isCrossDepartmentRole } from './roles';

export type UserScope = {
  userId: string;
  role: string;
  venueId: string;
  profileId: string;
  allAccess?: boolean;
};

/**
 * Checks if the user has cross-department authority across this facility.
 * Granted to leadership, directors, warehouse_manager, procurement_manager,
 * OR users holding an active membership in the facility's WAREHOUSE or PROCUREMENT departments.
 * Note: allAccess is deliberately NOT a bypass here to enforce department isolation.
 */
export async function canAccessAllDepartments(
  scope: UserScope,
  facilityId: string,
  prisma: PrismaService,
): Promise<boolean> {
  if (isCrossDepartmentRole(scope.role)) {
    return true;
  }

  // Check if user has active membership in WAREHOUSE or PROCUREMENT department
  const warehouseOrProcurement = await prisma.departmentMembership.findFirst({
    where: {
      facilityId,
      userId: scope.userId,
      isActive: true,
      department: {
        code: { in: ['WAREHOUSE', 'PROCUREMENT'] },
        active: true,
      },
    },
    select: { id: true },
  });

  return Boolean(warehouseOrProcurement);
}

/**
 * Asserts that the caller has access to the specified department at this facility.
 * If not authorized, throws ForbiddenException (403). Never returns 200 + empty.
 */
export async function assertDepartmentAccess(
  scope: UserScope,
  facilityId: string,
  departmentId: string,
  prisma: PrismaService,
): Promise<void> {
  const hasCross = await canAccessAllDepartments(scope, facilityId, prisma);
  if (hasCross) {
    return;
  }

  // Require active DepartmentMembership for this specific department
  const membership = await prisma.departmentMembership.findFirst({
    where: {
      facilityId,
      departmentId,
      userId: scope.userId,
      isActive: true,
    },
    select: { id: true },
  });

  if (membership) {
    return;
  }

  // Check valid active UserAreaOverride for this department if applicable
  const now = new Date();
  const override = await prisma.userAreaOverride.findFirst({
    where: {
      facilityId,
      userId: scope.userId,
      active: true,
      departmentId,
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });

  if (override) {
    return;
  }

  throw new ForbiddenException('Access denied for this department');
}

/**
 * Returns the list of department IDs the user is allowed to access at this facility,
 * or 'all' if the user has cross-department authority.
 */
export async function getAllowedDepartmentIds(
  scope: UserScope,
  facilityId: string,
  prisma: PrismaService,
): Promise<string[] | 'all'> {
  const hasCross = await canAccessAllDepartments(scope, facilityId, prisma);
  if (hasCross) {
    return 'all';
  }

  const memberships = await prisma.departmentMembership.findMany({
    where: {
      facilityId,
      userId: scope.userId,
      isActive: true,
    },
    select: { departmentId: true },
  });

  const now = new Date();
  const overrides = await prisma.userAreaOverride.findMany({
    where: {
      facilityId,
      userId: scope.userId,
      active: true,
      departmentId: { not: null },
      startsAt: { lte: now },
      expiresAt: { gt: now },
    },
    select: { departmentId: true },
  });

  const deptIds = new Set<string>();
  memberships.forEach((m) => deptIds.add(m.departmentId));
  overrides.forEach((o) => {
    if (o.departmentId) deptIds.add(o.departmentId);
  });

  return Array.from(deptIds);
}

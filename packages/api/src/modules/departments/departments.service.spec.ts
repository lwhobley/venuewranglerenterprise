import { describe, expect, it, vi } from 'vitest';
import { DepartmentsService, STANDARD_VENUE_DEPARTMENTS } from './departments.service';

function makePrisma(existingCodes: string[]) {
  const departments = existingCodes.map((code, index) => ({ id: `dept-${index}`, code }));
  return {
    department: {
      findMany: vi.fn()
        .mockResolvedValueOnce(existingCodes.map((code) => ({ code })))
        .mockResolvedValueOnce(departments),
      create: vi.fn(),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    departmentAreaRule: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as any;
}

describe('DepartmentsService.ensureDefaultDepartments', () => {
  it('recognizes existing department codes case-insensitively', async () => {
    const prisma = makePrisma(STANDARD_VENUE_DEPARTMENTS.map((department) => department.code));
    const service = new DepartmentsService(prisma);

    await service.ensureDefaultDepartments('org-1', 'facility-1');

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.createMany).not.toHaveBeenCalled();
  });

  it('seeds missing departments with database-level duplicate protection', async () => {
    const prisma = makePrisma([]);
    const service = new DepartmentsService(prisma);

    await service.ensureDefaultDepartments('org-1', 'facility-1');

    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.createMany).toHaveBeenCalledOnce();
    expect(prisma.department.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));
  });
});

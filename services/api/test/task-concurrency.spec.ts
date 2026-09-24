import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { OperationsService } from '../src/operations.service';
import type { PrismaService } from '../src/prisma.service';

describe('operational task update serialization', () => {
  it('locks the scoped task before reading its current state', async () => {
    const identity: Identity = {
      subject: 'manager-1',
      tenantId: 'tenant-1',
      capabilities: ['operations:write'],
      venueIds: ['venue-1'],
      eventIds: ['event-1'],
      locationIds: ['location-1'],
      assignableUserIds: [],
    };
    const task = {
      id: 'task-1',
      organizationId: 'tenant-1',
      eventId: 'event-1',
      venueId: 'venue-1',
      locationId: 'location-1',
      state: 'OPEN',
      title: 'Open gate 4',
    };
    const queryRaw = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(task);
    const tx = {
      $queryRaw: queryRaw,
      operationalTask: {
        findFirst,
        update: vi.fn().mockImplementation(({ data }) => ({ ...task, ...data })),
      },
      operationalTaskAudit: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const service = new OperationsService(prisma);

    await service.updateTask(identity, 'event-1', 'task-1', { state: 'IN_PROGRESS' });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(queryRaw.mock.calls[0]?.[1]).toBe('task:tenant-1:task-1');
    expect(findFirst).toHaveBeenCalledOnce();
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(findFirst.mock.invocationCallOrder[0]!);
  });
});

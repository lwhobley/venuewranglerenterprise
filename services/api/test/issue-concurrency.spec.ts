import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { IssuesService } from '../src/issues.service';
import type { PrismaService } from '../src/prisma.service';
import type { PushNotificationsService } from '../src/push-notifications.service';

describe('issue transition serialization', () => {
  it('locks the issue row after idempotency replay lookup and before reading its state', async () => {
    const identity: Identity = {
      subject: 'manager-1',
      tenantId: 'tenant-1',
      capabilities: ['issue:triage'],
      venueIds: ['venue-1'],
      eventIds: ['event-1'],
      locationIds: ['location-1'],
      assignableUserIds: [],
    };
    const issue = {
      id: 'issue-1',
      eventId: 'event-1',
      organizationId: 'tenant-1',
      venueId: 'venue-1',
      locationId: 'location-1',
      state: 'REPORTED',
      reporterId: 'reporter-1',
      ownerId: null,
      title: 'Cooling unit stopped',
    };
    const queryRaw = vi.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: queryRaw,
      commandReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      issue: {
        findFirst: vi.fn().mockResolvedValue(issue),
        update: vi.fn().mockImplementation(({ data }) => ({ ...issue, ...data })),
      },
      issueAuditEvent: { create: vi.fn().mockResolvedValue({}) },
      issueDomainEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const push = { deliver: vi.fn().mockResolvedValue(undefined) } as unknown as PushNotificationsService;
    const service = new IssuesService(prisma, push);

    await service.triage(identity, 'event-1', 'issue-1', { reason: 'Confirmed.' }, 'idempotency-key');

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(queryRaw.mock.calls[0]?.[1]).toBe('tenant-1idempotency-key');
    expect(queryRaw.mock.calls[1]?.[1]).toBe('issue:tenant-1:issue-1');
    expect(tx.issue.findFirst).toHaveBeenCalledOnce();
    expect(queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.issue.findFirst.mock.invocationCallOrder[0]!);
  });
});

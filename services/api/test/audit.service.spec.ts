import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { AuditService } from '../src/audit.service';
import type { PrismaService } from '../src/prisma.service';

const identity: Identity = {
  subject: 'issuer|admin-1',
  tenantId: '00000000-0000-4000-8000-000000000001',
  capabilities: ['tenant:admin'],
  venueIds: [],
  eventIds: [],
  locationIds: [],
  assignableUserIds: [],
};

describe('tenant audit history', () => {
  it('combines tenant records in reverse chronological order without record contents', async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([
      {
        id: '00000000-0000-4000-8000-000000000001',
        actor_id: 'issuer|manager-1',
        action: 'reported',
        resource_type: 'task',
        resource_id: '30000000-0000-4000-8000-000000000001',
        event_id: '20000000-0000-4000-8000-000000000001',
        changed_fields: null,
        created_at: '2026-09-24T12:00:00.000002Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        actor_id: 'issuer|admin-2',
        action: 'updated',
        resource_type: 'person',
        resource_id: '40000000-0000-4000-8000-000000000001',
        event_id: null,
        changed_fields: ['active'],
        created_at: '2026-09-24T11:00:00.000001Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        actor_id: 'issuer|manager-1',
        action: 'reported',
        resource_type: 'issue',
        resource_id: '10000000-0000-4000-8000-000000000001',
        event_id: null,
        changed_fields: null,
        created_at: '2026-09-24T10:00:00.000000Z',
      },
    ]).mockResolvedValueOnce([]);
    const tx = {
      $queryRaw: queryRaw,
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (tx: typeof tx) => unknown) =>
        action(tx),
      ),
    } as unknown as PrismaService;

    const result = await new AuditService(prisma).list(identity, '2');

    expect(prisma.withTenant).toHaveBeenCalledWith(identity, expect.any(Function));
    expect(result.items.map((row) => row.resourceType)).toEqual(['task', 'person']);
    expect(result.items[1].changedFields).toEqual(['active']);
    expect(result.items[0]).not.toHaveProperty('before');
    expect(result.items[0]).not.toHaveProperty('after');
    expect(result.nextCursor).toBeTruthy();
    const cursor = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    ) as { createdAt: string; id: string };
    expect(cursor.createdAt).toBe('2026-09-24T11:00:00.000001Z');
    expect(queryRaw).toHaveBeenCalledWith(
      expect.any(Array),
      identity.tenantId,
      identity.tenantId,
      identity.tenantId,
      null,
      null,
      null,
      3,
    );
    await new AuditService(prisma).list(identity, '2', result.nextCursor!);
    expect(queryRaw.mock.calls[1][4]).toBe(cursor.createdAt);
    expect(queryRaw.mock.calls[1][5]).toBe(cursor.createdAt);
    expect(queryRaw.mock.calls[1][6]).toBe(cursor.id);
  });

  it('requires tenant administrator capability before querying audit data', async () => {
    const withTenant = vi.fn();
    const prisma = { withTenant } as unknown as PrismaService;
    await expect(
      new AuditService(prisma).list(
        { ...identity, capabilities: ['operations:read'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('rejects invalid page sizes and cursors', async () => {
    const prisma = { withTenant: vi.fn() } as unknown as PrismaService;
    const audit = new AuditService(prisma);
    await expect(audit.list(identity, '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(audit.list(identity, '101')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(audit.list(identity, '50', 'bad-cursor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});

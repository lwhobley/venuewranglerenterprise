import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { OperationsService } from '../src/operations.service';
import type { PrismaService } from '../src/prisma.service';

const admin: Identity = {
  subject: 'admin-1',
  tenantId: 'tenant-1',
  capabilities: ['tenant:admin'],
  venueIds: [],
  eventIds: [],
  locationIds: [],
  assignableUserIds: [],
};

describe('tenant setup command idempotency', () => {
  it('replays a venue creation receipt instead of creating a duplicate', async () => {
    const receipts = new Map<string, { fingerprint: string; response: unknown }>();
    const createVenue = vi.fn().mockImplementation(({ data }) => ({ id: 'venue-1', ...data }));
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: {
        findUnique: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve(receipts.get(where.organizationId_key.key) ?? null)),
        create: vi.fn().mockImplementation(({ data }) => {
          receipts.set(data.key, data);
          return Promise.resolve(data);
        }),
      },
      venue: { create: createVenue },
      tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const service = new OperationsService(prisma);

    const first = await service.createVenue(admin, { name: 'North Arena' }, 'venue-create-key-0001');
    const replay = await service.createVenue(admin, { name: 'North Arena' }, 'venue-create-key-0001');

    expect(replay).toEqual(first);
    expect(createVenue).toHaveBeenCalledOnce();
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledOnce();
    expect(tx.commandReceipt.create).toHaveBeenCalledOnce();
  });

  it('rejects reuse of a key for a different command payload', async () => {
    const receipts = new Map<string, { fingerprint: string; response: unknown }>();
    const createVenue = vi.fn().mockImplementation(({ data }) => ({ id: 'venue-1', ...data }));
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: {
        findUnique: vi.fn().mockImplementation(({ where }) =>
          Promise.resolve(receipts.get(where.organizationId_key.key) ?? null)),
        create: vi.fn().mockImplementation(({ data }) => {
          receipts.set(data.key, data);
          return Promise.resolve(data);
        }),
      },
      venue: { create: createVenue },
      tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const service = new OperationsService(prisma);
    await service.createVenue(admin, { name: 'North Arena' }, 'venue-create-key-0002');

    await expect(service.createVenue(admin, { name: 'South Arena' }, 'venue-create-key-0002'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(createVenue).toHaveBeenCalledOnce();
  });

  it('audits tenant-admin roster creation without copying personal values into the audit row', async () => {
    const person = {
      id: 'person-1',
      organizationId: admin.tenantId,
      externalSubject: 'https://idp.invalid|worker-1',
      email: 'worker@example.invalid',
      displayName: 'Worker One',
      active: true,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      person: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(person),
      },
      personAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const service = new OperationsService(prisma);

    await service.upsertPerson(admin, {
      externalSubject: person.externalSubject,
      email: person.email,
      displayName: person.displayName,
    }, 'roster-create-command-0001');

    expect(tx.personAuditEvent.create).toHaveBeenCalledWith({
      data: {
        organizationId: admin.tenantId,
        personId: person.id,
        actorId: admin.subject,
        action: 'created',
        changedFields: ['external_subject', 'email', 'display_name', 'active'],
      },
    });
    expect(JSON.stringify(tx.personAuditEvent.create.mock.calls[0][0])).not.toContain(person.email);
    expect(JSON.stringify(tx.personAuditEvent.create.mock.calls[0][0])).not.toContain(person.displayName);
  });
});

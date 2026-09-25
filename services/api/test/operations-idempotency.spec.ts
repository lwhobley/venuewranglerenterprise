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
    };
    const prisma = {
      withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
    } as unknown as PrismaService;
    const service = new OperationsService(prisma);

    const first = await service.createVenue(admin, { name: 'North Arena' }, 'venue-create-key-0001');
    const replay = await service.createVenue(admin, { name: 'North Arena' }, 'venue-create-key-0001');

    expect(replay).toEqual(first);
    expect(createVenue).toHaveBeenCalledOnce();
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
});

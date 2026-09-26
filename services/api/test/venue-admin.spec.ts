import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { OperationsService } from '../src/operations.service';
import type { PrismaService } from '../src/prisma.service';

const venueA = '10000000-0000-4000-8000-000000000001';
const venueB = '10000000-0000-4000-8000-000000000002';
const venueAdmin: Identity = {
  subject: 'venue-admin-1',
  tenantId: 'tenant-1',
  organizationSlug: 'harbor-city',
  capabilities: ['venue:admin'],
  venueIds: [venueA],
  eventIds: [],
  locationIds: [],
  assignableUserIds: [],
};

function serviceFor(tx: Record<string, unknown>) {
  const receipts = new Map<string, { fingerprint: string; response: unknown }>();
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commandReceipt: {
      findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(receipts.get(where.organizationId_key.key) ?? null)),
      create: vi.fn().mockImplementation(({ data }) => { receipts.set(data.key, data); return Promise.resolve(data); }),
    },
    tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    personAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    ...tx,
  };
  const prisma = { withTenant: vi.fn((_identity: Identity, action: (value: never) => Promise<unknown>) => action(transaction as never)) } as unknown as PrismaService;
  return { service: new OperationsService(prisma), tx: transaction };
}

describe('venue administrator scope', () => {
  it('lets an assigned venue administrator update only that venue and replays the same key', async () => {
    const update = vi.fn().mockResolvedValue({ id: venueA, name: 'North Arena' });
    const { service, tx } = serviceFor({
      venue: { findFirst: vi.fn().mockResolvedValue({ id: venueA, organizationId: venueAdmin.tenantId, name: 'Arena', timeZone: 'America/Chicago' }), update },
    });

    const first = await service.updateVenue(venueAdmin, venueA, { name: 'North Arena' }, 'venue-admin-update-01');
    const replay = await service.updateVenue(venueAdmin, venueA, { name: 'North Arena' }, 'venue-admin-update-01');

    expect(replay).toEqual(first);
    expect(update).toHaveBeenCalledOnce();
    expect(tx.venue.findFirst).toHaveBeenCalledWith({ where: { id: venueA, organizationId: venueAdmin.tenantId } });
  });

  it('rejects an unassigned venue and a non-admin using the same update path', async () => {
    const update = vi.fn();
    const { service } = serviceFor({ venue: { update } });

    await expect(service.updateVenue(venueAdmin, venueB, { name: 'Other Arena' }, 'venue-admin-update-02')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateVenue({ ...venueAdmin, capabilities: ['operations:write'] }, venueA, { name: 'Other Arena' }, 'venue-admin-update-03')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a reused venue-admin key when the command payload changes', async () => {
    const { service } = serviceFor({
      venue: {
        findFirst: vi.fn().mockResolvedValue({ id: venueA, organizationId: venueAdmin.tenantId, name: 'Arena', timeZone: 'America/Chicago' }),
        update: vi.fn().mockResolvedValue({ id: venueA, name: 'North Arena' }),
      },
    });

    await service.updateVenue(venueAdmin, venueA, { name: 'North Arena' }, 'venue-admin-update-04');
    await expect(service.updateVenue(venueAdmin, venueA, { name: 'South Arena' }, 'venue-admin-update-04')).rejects.toBeInstanceOf(ConflictException);
  });

  it('shows a venue administrator every event in an assigned venue and hides other venues', async () => {
    const venues = [{ id: venueA, name: 'North', timeZone: 'America/Chicago' }];
    const events = [{ id: 'event-1', venueId: venueA, name: 'Game', startsAt: new Date('2027-01-02T02:00:00.000Z'), closeout: null }];
    const { service, tx } = serviceFor({
      organization: { findUnique: vi.fn().mockResolvedValue({ id: venueAdmin.tenantId, slug: 'harbor-city', name: 'Harbor' }), upsert: vi.fn().mockResolvedValue({ id: venueAdmin.tenantId, slug: 'harbor-city', name: 'Harbor' }) },
      person: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      venue: { findMany: vi.fn().mockResolvedValue(venues) },
      event: { findMany: vi.fn().mockResolvedValue(events) },
      location: { findMany: vi.fn().mockResolvedValue([]) },
      venueServiceArea: { findMany: vi.fn().mockResolvedValue([{ id: 'area-1', venueId: venueA, name: 'Concourse', code: 'CONCOURSE' }]) },
    });

    const result = await service.bootstrap(venueAdmin, {});

    expect(tx.venue.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [venueA] }, organizationId: venueAdmin.tenantId } }));
    expect(tx.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ venueId: { in: [venueA] }, organizationId: venueAdmin.tenantId }) }));
    expect(tx.event.findMany.mock.calls[0][0].where).not.toHaveProperty('id');
    expect(tx.venueServiceArea.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: venueAdmin.tenantId, venueId: { in: [venueA] } } }));
    expect(result.events).toEqual([expect.objectContaining({ id: 'event-1', timeZone: 'America/Chicago', startsAtLocal: '2027-01-01T20:00' })]);
    expect(result.serviceAreas).toEqual([expect.objectContaining({ venueId: venueA })]);
  });
});

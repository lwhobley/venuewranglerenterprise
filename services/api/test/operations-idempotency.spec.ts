import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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
  it('updates the tenant organization display name idempotently and audits only the field', async () => {
    const updated = { id: admin.tenantId, name: 'Northstar Stadium Group' };
    const tx = setupUpdateTx({ organization: {
      findUnique: vi.fn().mockResolvedValue({ id: admin.tenantId, name: 'Venue organization' }),
      update: vi.fn().mockResolvedValue(updated),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    const result = await service.updateOrganization(admin, '  Northstar Stadium Group  ', 'organization-name-key-01');
    const replay = await service.updateOrganization(admin, 'Northstar Stadium Group', 'organization-name-key-01');

    expect(result).toEqual(updated);
    expect(replay).toEqual(result);
    expect(tx.organization.update).toHaveBeenCalledOnce();
    expect(tx.organization.update).toHaveBeenCalledWith({ where: { id: admin.tenantId }, data: { name: 'Northstar Stadium Group' } });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith({ data: {
      organizationId: admin.tenantId, actorId: admin.subject, action: 'updated',
      resourceType: 'organization', resourceId: admin.tenantId, changedFields: ['name'],
    } });
  });

  it('does not let a non-admin rename the tenant organization', async () => {
    const tx = setupUpdateTx({ organization: { update: vi.fn() } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.updateOrganization({ ...admin, capabilities: ['operations:write'] }, 'Changed name', 'organization-name-key-02'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.organization.update).not.toHaveBeenCalled();
  });

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

    const first = await service.createVenue(admin, { name: 'North Arena', timeZone: 'America/Chicago' }, 'venue-create-key-0001');
    const replay = await service.createVenue(admin, { name: 'North Arena', timeZone: 'America/Chicago' }, 'venue-create-key-0001');

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
    await service.createVenue(admin, { name: 'North Arena', timeZone: 'America/Chicago' }, 'venue-create-key-0002');

    await expect(service.createVenue(admin, { name: 'South Arena', timeZone: 'America/Chicago' }, 'venue-create-key-0002'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(createVenue).toHaveBeenCalledOnce();
  });

  it('requires a valid IANA timezone when creating a venue', async () => {
    const tx = setupUpdateTx({ venue: { create: vi.fn() } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.createVenue(admin, { name: 'North Arena', timeZone: 'Not/A_Timezone' }, 'venue-invalid-zone-01'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.venue.create).not.toHaveBeenCalled();
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
        changedFields: ['external_subject', 'email', 'display_name', 'active', 'provisioning_source'],
      },
    });
    expect(JSON.stringify(tx.personAuditEvent.create.mock.calls[0][0])).not.toContain(person.email);
    expect(JSON.stringify(tx.personAuditEvent.create.mock.calls[0][0])).not.toContain(person.displayName);
  });

  it('updates a venue only within the tenant and audits changed field names', async () => {
    const updatedVenue = { id: 'venue-1', organizationId: admin.tenantId, name: 'North Pavilion', timeZone: 'America/Chicago' };
    const tx = setupUpdateTx({ venue: {
      findFirst: vi.fn().mockResolvedValue({ id: 'venue-1', organizationId: admin.tenantId, name: 'North Arena', timeZone: 'America/Chicago' }),
      update: vi.fn().mockResolvedValue(updatedVenue),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    const result = await service.updateVenue(admin, 'venue-1', { name: 'North Pavilion' }, 'venue-update-key-001');
    const replay = await service.updateVenue(admin, 'venue-1', { name: 'North Pavilion' }, 'venue-update-key-001');

    expect(result).toEqual(updatedVenue);
    expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(result)));
    expect(tx.venue.findFirst).toHaveBeenCalledOnce();
    expect(tx.venue.findFirst).toHaveBeenCalledWith({ where: { id: 'venue-1', organizationId: admin.tenantId } });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledOnce();
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith({ data: {
      organizationId: admin.tenantId, actorId: admin.subject, action: 'updated',
      resourceType: 'venue', resourceId: 'venue-1', changedFields: ['name'],
    } });
  });

  it('reports venue readiness and prevents non-admins from reading it', async () => {
    const tx = setupUpdateTx({ venue: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'venue-1', organizationId: admin.tenantId, lifecycleState: 'DRAFT',
        timeZone: 'America/Chicago', _count: { locations: 1 },
      }),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.venueReadiness(admin, 'venue-1')).resolves.toMatchObject({
      venueId: 'venue-1', lifecycleState: 'DRAFT', ready: true,
      checks: [{ key: 'time_zone', passed: true }, { key: 'location', passed: true }],
    });
    await expect(service.venueReadiness({ ...admin, capabilities: ['operations:read'] }, 'venue-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activates a ready venue once and records the tenant-admin actor', async () => {
    const activated = { id: 'venue-1', lifecycleState: 'ACTIVE', activatedAt: new Date(), activatedBy: admin.subject };
    const tx = setupUpdateTx({ venue: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'venue-1', organizationId: admin.tenantId, lifecycleState: 'DRAFT',
        timeZone: 'America/Chicago', _count: { locations: 1 },
      }),
      update: vi.fn().mockResolvedValue(activated),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    const result = await service.updateVenueLifecycle(admin, 'venue-1', 'activate', 'venue-activate-key-001');
    const replay = await service.updateVenueLifecycle(admin, 'venue-1', 'activate', 'venue-activate-key-001');

    expect(result).toMatchObject({ id: 'venue-1', lifecycleState: 'ACTIVE', activatedBy: admin.subject });
    expect(typeof result.activatedAt).toBe('object');
    expect(JSON.parse(JSON.stringify(replay))).toEqual(JSON.parse(JSON.stringify(result)));
    expect(tx.venue.update).toHaveBeenCalledOnce();
    expect(tx.venue.update).toHaveBeenCalledWith({ where: { id: 'venue-1' }, data: {
      lifecycleState: 'ACTIVE', activatedAt: expect.any(Date), activatedBy: admin.subject,
    } });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: admin.tenantId, actorId: admin.subject, action: 'activated',
      resourceType: 'venue', resourceId: 'venue-1',
      changedFields: ['lifecycle_state', 'activated_at', 'activated_by'],
    }) });
  });

  it('blocks venue activation until timezone and location checks pass', async () => {
    const tx = setupUpdateTx({ venue: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'venue-1', organizationId: admin.tenantId, lifecycleState: 'DRAFT',
        timeZone: null, _count: { locations: 0 },
      }),
      update: vi.fn(),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.updateVenueLifecycle(admin, 'venue-1', 'activate', 'venue-activate-key-002'))
      .rejects.toThrow('Venue is not ready to activate');
    expect(tx.venue.update).not.toHaveBeenCalled();
    expect(tx.tenantSetupAuditEvent.create).not.toHaveBeenCalled();
  });

  it('allows administrators to add the first location while a venue is still draft', async () => {
    const location = { id: 'location-1', organizationId: admin.tenantId, venueId: 'venue-1', name: 'North Concourse' };
    const tx = setupUpdateTx({
      venue: { findFirst: vi.fn().mockResolvedValue({ id: 'venue-1', lifecycleState: 'DRAFT' }) },
      location: { create: vi.fn().mockResolvedValue(location) },
    });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.createLocation(admin, { venueId: 'venue-1', name: 'North Concourse' }, 'location-draft-create-01'))
      .resolves.toEqual(location);
    expect(tx.location.create).toHaveBeenCalledWith({ data: {
      organizationId: admin.tenantId, venueId: 'venue-1', name: 'North Concourse',
    } });
  });

  it('rejects event creation at draft or suspended venues', async () => {
    const tx = setupUpdateTx({ venue: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'venue-1', organizationId: admin.tenantId, lifecycleState: 'DRAFT',
        timeZone: 'America/Chicago',
      }),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.createEvent(admin, {
      venueId: 'venue-1', name: 'Opening Night', startsAt: '2027-01-01T20:00:00.000Z',
    }, 'event-create-draft-key-01')).rejects.toThrow('Activate this venue');
  });

  it('updates a location without allowing its venue scope to be changed', async () => {
    const updatedLocation = { id: 'location-1', organizationId: admin.tenantId, venueId: 'venue-1', name: 'West Concourse' };
    const tx = setupUpdateTx({ location: {
      findFirst: vi.fn().mockResolvedValue({ id: 'location-1', organizationId: admin.tenantId, venueId: 'venue-1', name: 'Concourse' }),
      update: vi.fn().mockResolvedValue(updatedLocation),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await service.updateLocation(admin, 'location-1', { name: 'West Concourse' }, 'location-update-key-01');

    expect(tx.location.findFirst).toHaveBeenCalledWith({ where: { id: 'location-1', organizationId: admin.tenantId } });
    expect(tx.location.update).toHaveBeenCalledWith({ where: { id: 'location-1' }, data: { name: 'West Concourse' } });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceType: 'location', changedFields: ['name'] }) });
  });

  it('updates an open event under a row lock and records only changed fields', async () => {
    const startsAt = new Date('2027-01-01T20:00:00.000Z');
    const tx = setupUpdateTx({ event: {
      findFirst: vi.fn().mockResolvedValue({ id: 'event-1', organizationId: admin.tenantId, name: 'Game', startsAt: new Date('2027-01-01T19:00:00.000Z'), closeout: { state: 'OPEN' } }),
      update: vi.fn().mockResolvedValue({ id: 'event-1', organizationId: admin.tenantId, name: 'Game Night', startsAt }),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await service.updateEvent(admin, 'event-1', { name: 'Game Night', startsAt: startsAt.toISOString() }, 'event-update-key-001');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2); // idempotency serialization and event finalization lock
    expect(tx.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'event-1', organizationId: admin.tenantId }, include: { closeout: { select: { state: true } } } }));
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ resourceType: 'event', eventId: 'event-1', changedFields: ['name', 'starts_at'] }) });
  });

  it('rejects edits to finalized events and rejects setup writes from non-admins', async () => {
    const update = vi.fn();
    const tx = setupUpdateTx({ event: {
      findFirst: vi.fn().mockResolvedValue({ id: 'event-1', organizationId: admin.tenantId, name: 'Closed event', startsAt: new Date(), closeout: { state: 'CLOSED' } }),
      update,
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.updateEvent(admin, 'event-1', { name: 'Changed' }, 'event-update-key-002')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateVenue({ ...admin, capabilities: ['operations:write'] }, 'venue-1', { name: 'Changed' }, 'venue-update-key-002')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(tx.tenantSetupAuditEvent.create).not.toHaveBeenCalled();
  });

  it('deactivates a manually managed roster record with an idempotent, value-free audit', async () => {
    const person = { id: 'person-2', organizationId: admin.tenantId, externalSubject: 'worker-2', email: 'worker@example.invalid', displayName: 'Worker Two', active: true, provisioningSource: 'admin' };
    const tx = setupUpdateTx({ person: {
      findFirst: vi.fn().mockResolvedValue(person),
      update: vi.fn().mockResolvedValue({ ...person, active: false }),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    const result = await service.setPersonActive(admin, person.id, false, 'person-deactivate-0001');
    const replay = await service.setPersonActive(admin, person.id, false, 'person-deactivate-0001');

    expect(result).toMatchObject({ id: person.id, active: false });
    expect(replay).toEqual(result);
    expect(tx.person.findFirst).toHaveBeenCalledWith({ where: { id: person.id, organizationId: admin.tenantId } });
    expect(tx.person.update).toHaveBeenCalledOnce();
    expect(tx.personAuditEvent.create).toHaveBeenCalledWith({ data: {
      organizationId: admin.tenantId, personId: person.id, actorId: admin.subject,
      action: 'deactivated', changedFields: ['active'],
    } });
    expect(JSON.stringify(tx.personAuditEvent.create.mock.calls[0][0])).not.toContain(person.email);
  });

  it('keeps SCIM as the source of truth and prevents tenant admins from deactivating themselves', async () => {
    const scimPerson = { id: 'person-3', organizationId: admin.tenantId, externalSubject: 'worker-3', active: true, provisioningSource: 'scim' };
    const tx = setupUpdateTx({ person: {
      findFirst: vi.fn().mockResolvedValue(scimPerson),
      update: vi.fn(),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.setPersonActive(admin, scimPerson.id, false, 'person-deactivate-0002')).rejects.toBeInstanceOf(ConflictException);
    const self = { ...scimPerson, externalSubject: admin.subject, provisioningSource: 'admin' };
    tx.person.findFirst.mockResolvedValue(self);
    await expect(service.setPersonActive(admin, self.id, false, 'person-deactivate-0003')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.person.update).not.toHaveBeenCalled();
    expect(tx.personAuditEvent.create).not.toHaveBeenCalled();
  });

  it('requires provenance reconciliation before changing legacy roster records', async () => {
    const legacyPerson = { id: 'person-4', organizationId: admin.tenantId, externalSubject: 'legacy-worker', active: true, provisioningSource: 'unknown' };
    const tx = setupUpdateTx({ person: {
      findFirst: vi.fn().mockResolvedValue(legacyPerson),
      update: vi.fn(),
    } });
    const service = new OperationsService(setupUpdatePrisma(tx));

    await expect(service.setPersonActive(admin, legacyPerson.id, false, 'person-deactivate-0004')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.person.update).not.toHaveBeenCalled();
    expect(tx.personAuditEvent.create).not.toHaveBeenCalled();
  });
});

function setupUpdateTx(resources: Record<string, unknown> = {}) {
  const receipts = new Map<string, { fingerprint: string; response: unknown }>();
  return {
    ...resources,
    $queryRaw: vi.fn().mockResolvedValue([]),
    commandReceipt: {
      findUnique: vi.fn().mockImplementation(({ where }) => Promise.resolve(receipts.get(where.organizationId_key.key) ?? null)),
      create: vi.fn().mockImplementation(({ data }) => { receipts.set(data.key, data); return Promise.resolve(data); }),
    },
    organization: { findUnique: vi.fn(), update: vi.fn(), ...(resources.organization as object ?? {}) },
    venue: { findFirst: vi.fn(), update: vi.fn(), ...(resources.venue as object ?? {}) },
    location: { findFirst: vi.fn(), update: vi.fn(), ...(resources.location as object ?? {}) },
    event: { findFirst: vi.fn(), update: vi.fn(), ...(resources.event as object ?? {}) },
    person: { findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn(), ...(resources.person as object ?? {}) },
    personAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function setupUpdatePrisma(tx: ReturnType<typeof setupUpdateTx>) {
  return {
    withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
  } as unknown as PrismaService;
}

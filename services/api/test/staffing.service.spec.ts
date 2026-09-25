import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { StaffingService } from '../src/staffing.service';
import type { PrismaService } from '../src/prisma.service';

const workerSubject = 'https://idp.example|worker-1';
const manager: Identity = {
  subject: 'https://idp.example|manager-1', tenantId: 'tenant-1',
  capabilities: ['operations:read', 'operations:write'],
  venueIds: ['venue-1'], eventIds: ['event-1'], locationIds: ['location-1'], assignableUserIds: [workerSubject],
};
const worker: Identity = { ...manager, subject: workerSubject, capabilities: ['operations:read'], assignableUserIds: [] };

function harness(current?: Record<string, unknown>, restMinutes: number | null = 0) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation((query) => String(query?.[0] ?? '').includes('SELECT minimum_rest_minutes')
      ? Promise.resolve([{ minimum_rest_minutes: restMinutes }])
      : Promise.resolve([])),
    commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: 'event-1' }), findMany: vi.fn().mockResolvedValue([]) },
    staffingDemand: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'demand-1', ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'demand-1', ...data })),
    },
    staffingDemandAudit: { create: vi.fn().mockResolvedValue({}) },
    staffingVendorRequest: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'location-1' }) },
    person: {
      findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    personQualification: { findMany: vi.fn().mockResolvedValue([]) },
    staffUnavailability: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    staffAvailabilityCheck: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'availability-check-1', response: 'PENDING', ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'availability-check-1', ...data })),
    },
    staffAvailabilityCheckAudit: { create: vi.fn().mockResolvedValue({}) },
    staffShift: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'shift-1', state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1, ...data })),
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(typeof where?.id === 'object' ? null : current ?? null)),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation(({ data }) => ({ ...current, ...data })),
    },
    staffShiftAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    staffBreak: { findFirst: vi.fn().mockResolvedValue(null) },
    staffAttendanceClaim: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'claim-1', status: 'PENDING_REVIEW', ...data })),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'claim-1', ...data })),
    },
    userNotification: { create: vi.fn().mockImplementation(({ data }) => ({ id: 'notification-1', ...data })) },
  };
  const prisma = {
    withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
  } as unknown as PrismaService;
  const push = { deliver: vi.fn().mockResolvedValue(undefined) };
  return { service: new StaffingService(prisma, push as never), tx, push };
}

describe('event staffing workflow', () => {
  it('requests explicit availability only from scoped active workers and creates durable notices', async () => {
    const shift = { id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1', assignedSubject: null, state: 'DRAFT', attendance: 'NOT_STARTED', revision: 2, requiredQualificationCodes: [], startsAt: new Date(Date.now() + 60 * 60_000), endsAt: new Date(Date.now() + 4 * 60 * 60_000) };
    const { service, tx, push } = harness(shift);
    tx.person.findMany.mockResolvedValue([{ id: 'person-1', externalSubject: workerSubject }]);

    const rows = await service.requestAvailabilityChecks(manager, 'event-1', 'shift-1', { subjects: [workerSubject] }, 'availability-request-key-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workerSubject, shiftRevision: 2, response: 'PENDING' });
    expect(tx.staffAvailabilityCheckAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'requested' }) }));
    expect(tx.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientSubject: workerSubject, kind: 'staffing.availability.requested' }) }));
    expect(push.deliver).toHaveBeenCalledOnce();
  });

  it('lets only the requested worker respond once to an unchanged future draft shift', async () => {
    const check = { id: 'availability-check-1', organizationId: 'tenant-1', eventId: 'event-1', shiftId: 'shift-1', workerSubject, shiftRevision: 2, response: 'PENDING' };
    const shift = { id: 'shift-1', eventId: 'event-1', venueId: 'venue-1', locationId: 'location-1', assignedSubject: null, state: 'DRAFT', revision: 2, startsAt: new Date(Date.now() + 60 * 60_000) };
    const { service, tx } = harness();
    tx.staffAvailabilityCheck.findFirst.mockResolvedValue(check);
    tx.staffShift.findFirst.mockResolvedValue(shift);
    tx.staffAvailabilityCheck.update.mockImplementation(({ data }) => ({ ...check, ...data }));

    const response = await service.respondToAvailabilityCheck(worker, check.id, { response: 'AVAILABLE' }, 'availability-response-key-1');

    expect(response).toMatchObject({ response: 'AVAILABLE' });
    expect(response.respondedAt).toBeInstanceOf(Date);
    expect(tx.staffAvailabilityCheckAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: workerSubject, action: 'available' }) }));
  });

  it('forecasts role demand from tenant and venue scoped earlier event plans', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'venue-1', startsAt: new Date('2026-10-10T17:00:00Z') });
    tx.event.findMany.mockResolvedValue([
      { id: 'past-1', startsAt: new Date('2026-09-26T17:00:00Z') },
      { id: 'past-2', startsAt: new Date('2026-10-03T17:00:00Z') },
    ]);
    tx.staffingDemand.findMany.mockResolvedValue([
      { eventId: 'past-1', role: 'Usher', locationId: 'location-1', startsAt: new Date('2026-09-26T17:00:00Z'), endsAt: new Date('2026-09-26T22:00:00Z'), requiredHeadcount: 4, requiredQualificationCodes: ['SAFETY'] },
      { eventId: 'past-2', role: 'Usher', locationId: 'location-1', startsAt: new Date('2026-10-03T17:30:00Z'), endsAt: new Date('2026-10-03T22:30:00Z'), requiredHeadcount: 6, requiredQualificationCodes: ['SAFETY', 'CROWD'] },
      { eventId: 'past-2', role: 'Usher', locationId: 'location-1', startsAt: new Date('2026-10-03T17:00:00Z'), endsAt: new Date('2026-10-03T22:00:00Z'), requiredHeadcount: 5, requiredQualificationCodes: ['SAFETY'] },
    ]);

    const forecasts = await service.forecastCoverage(manager, 'event-1');

    expect(forecasts).toHaveLength(2);
    expect(forecasts[0]).toMatchObject({ role: 'Usher', requiredHeadcount: 5, sampleEventCount: 2, confidence: 'LIMITED_HISTORY', requiredQualificationCodes: ['SAFETY'], source: 'HISTORICAL_PLANNED_DEMAND' });
    expect(tx.event.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ startsAt: { lt: new Date('2026-10-10T17:00:00Z') } }) }));
    expect(tx.staffingDemand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: { in: ['past-1', 'past-2'] }, organizationId: 'tenant-1', venueId: 'venue-1', OR: [{ locationId: null }, { locationId: { in: ['location-1'] } }] }) }));
  });

  it('reports vendor commitments separately and reserves outstanding requests against duplicate staffing', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'venue-1' });
    tx.staffingDemand.findMany.mockResolvedValue([{ id: 'demand-1', eventId: 'event-1', venueId: 'venue-1', locationId: null, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), requiredHeadcount: 5 }]);
    tx.staffShift.findMany.mockResolvedValue([]);
    tx.staffingVendorRequest.findMany.mockResolvedValue([
      { state: 'SENT', requestedHeadcount: 3, committedHeadcount: 0 },
      { state: 'PARTIALLY_COMMITTED', requestedHeadcount: 2, committedHeadcount: 1 },
    ]);

    const [coverage] = await service.coverageRequirements(manager, 'event-1');

    expect(coverage).toMatchObject({ vendorRequestedHeadcount: 5, vendorCommittedHeadcount: 1, vendorReservedHeadcount: 4, unfilledHeadcount: 1 });
  });

  it('reports unfilled slots separately from assigned, published, and acknowledged coverage', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'venue-1' });
    tx.staffingDemand.findMany.mockResolvedValue([{
      id: 'demand-1', eventId: 'event-1', venueId: 'venue-1', locationId: 'location-1', role: 'Usher',
      startsAt: new Date('2025-10-01T17:00:00Z'), endsAt: new Date('2025-10-01T22:00:00Z'), requiredHeadcount: 3,
    }]);
    tx.staffShift.findMany.mockResolvedValue([
      { id: 'draft-open', state: 'DRAFT', response: 'PENDING', responseRevision: null, revision: 1, assignedSubject: null },
      { id: 'published-accepted', state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 2, revision: 2, assignedSubject: workerSubject },
      { id: 'published-pending', state: 'PUBLISHED', response: 'PENDING', responseRevision: null, revision: 1, assignedSubject: 'https://idp.example|worker-2' },
    ]);

    const [row] = await service.coverageRequirements(manager, 'event-1');

    expect(row).toMatchObject({ scheduledHeadcount: 3, publishedHeadcount: 2, assignedHeadcount: 2, confirmedHeadcount: 1, unfilledHeadcount: 0, unconfirmedHeadcount: 2 });
  });

  it('creates auditable scoped coverage requirements and generates only the open draft deficit', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'venue-1' });
    const requirement = await service.createCoverageRequirement(manager, 'event-1', {
      venueId: 'venue-1', locationId: 'location-1', role: 'Concourse usher', startsAt: '2025-10-01T17:00:00Z',
      endsAt: '2025-10-01T22:00:00Z', requiredHeadcount: 2, requiredQualificationCodes: ['FOOD_HANDLER'],
    }, 'staff-coverage-demand-key-1');
    expect(requirement).toMatchObject({ id: 'demand-1', role: 'Concourse usher', requiredHeadcount: 2 });
    expect(tx.staffingDemandAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'created', demandId: 'demand-1' }) }));

    tx.staffingDemand.findFirst.mockResolvedValue({ id: 'demand-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1', role: 'Concourse usher', startsAt: new Date('2025-10-01T17:00:00Z'), endsAt: new Date('2025-10-01T22:00:00Z'), requiredHeadcount: 2, requiredQualificationCodes: ['FOOD_HANDLER'] });
    tx.staffShift.count.mockResolvedValue(1);
    const generated = await service.generateCoverageShifts(manager, 'event-1', 'demand-1', 'staff-coverage-generate-key-2');
    expect(generated).toMatchObject({ demandId: 'demand-1', requiredHeadcount: 2, scheduledHeadcount: 2, unfilledHeadcount: 0 });
    expect(generated.createdShifts).toHaveLength(1);
    expect(tx.staffShift.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ staffingDemandId: 'demand-1', role: 'Concourse usher' }) }));
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'created_from_coverage_demand' }) }));
  });

  it('ranks only assignable workers without recorded schedule conflicts and required qualifications', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: null, role: 'Usher', startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
      requiredQualificationCodes: ['FOOD_HANDLER'], state: 'DRAFT', attendance: 'NOT_STARTED', revision: 1,
    };
    const { service, tx } = harness(current);
    const secondSubject = 'https://idp.example|worker-2';
    const thirdSubject = 'https://idp.example|worker-3';
    const fourthSubject = 'https://idp.example|worker-4';
    tx.person.findMany.mockResolvedValue([
      { id: 'person-1', externalSubject: workerSubject, displayName: 'Avery' },
      { id: 'person-2', externalSubject: secondSubject, displayName: 'Blake' },
      { id: 'person-3', externalSubject: thirdSubject, displayName: 'Casey' },
      { id: 'person-4', externalSubject: fourthSubject, displayName: 'Drew' },
    ]);
    tx.staffUnavailability.findMany.mockResolvedValue([]);
    tx.staffAvailabilityCheck.findMany.mockResolvedValue([
      { workerSubject, response: 'AVAILABLE' },
      { workerSubject: secondSubject, response: 'UNAVAILABLE' },
    ]);
    tx.staffShift.findMany
      .mockResolvedValueOnce([{ assignedSubject: fourthSubject }])
      .mockResolvedValueOnce([{ assignedSubject: workerSubject, startsAt: new Date('2026-10-01T10:00:00Z'), endsAt: new Date('2026-10-01T11:30:00Z') }]);
    tx.personQualification.findMany.mockResolvedValue([{ personId: 'person-1', code: 'FOOD_HANDLER' }, { personId: 'person-2', code: 'FOOD_HANDLER' }, { personId: 'person-4', code: 'FOOD_HANDLER' }]);

    const result = await service.assignmentSuggestions({ ...manager, assignableUserIds: [workerSubject, secondSubject, thirdSubject, fourthSubject] }, 'event-1', 'shift-1');

    expect(result).toMatchObject({ availabilitySignal: 'NO_RECORDED_CONFLICT_ONLY', eligibleCount: 1, excludedCount: 3 });
    expect(result.recommendations).toEqual([{ subject: workerSubject, displayName: 'Avery', eventAssignedMinutes: 90, eventAssignedShifts: 1, availabilitySignal: 'CONFIRMED_AVAILABLE' }]);
    expect(tx.person.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'tenant-1', externalSubject: { in: [thirdSubject, secondSubject, workerSubject, fourthSubject].sort() } }) }));
  });

  it('does not query or reveal roster candidates when signed identity assignment scope is empty', async () => {
    const current = { id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: null, state: 'DRAFT', attendance: 'NOT_STARTED' };
    const { service, tx } = harness(current);
    const result = await service.assignmentSuggestions({ ...manager, assignableUserIds: [] }, 'event-1', 'shift-1');
    expect(result.recommendations).toEqual([]);
    expect(tx.person.findMany).not.toHaveBeenCalled();
  });

  it('prevents changing a generated demand into another area or window until its open shifts are edited', async () => {
    const { service, tx } = harness();
    tx.staffingDemand.findFirst.mockResolvedValue({ id: 'demand-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1', role: 'Usher', startsAt: new Date('2025-10-01T17:00:00Z'), endsAt: new Date('2025-10-01T22:00:00Z'), requiredHeadcount: 2, requiredQualificationCodes: [] });
    tx.staffShift.count.mockResolvedValue(1);
    await expect(service.updateCoverageRequirement(manager, 'event-1', 'demand-1', {
      role: 'Gate usher', reason: 'Demand moved to gate staffing.',
    }, 'staff-coverage-update-key-1')).rejects.toThrow('Edit or cancel generated shifts');
    expect(tx.staffingDemand.update).not.toHaveBeenCalled();

    tx.staffShift.count.mockResolvedValue(0);
    await expect(service.updateCoverageRequirement(manager, 'event-1', 'demand-1', {
      locationId: 'other-location', reason: 'Move to restricted location.',
    }, 'staff-coverage-update-key-2')).rejects.toThrow('outside your assigned scope');
    expect(tx.location.findFirst).not.toHaveBeenCalled();
  });

  it('updates the role demand target with a reason and append-only before/after audit', async () => {
    const { service, tx } = harness();
    const current = { id: 'demand-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1', role: 'Usher', startsAt: new Date('2025-10-01T17:00:00Z'), endsAt: new Date('2025-10-01T22:00:00Z'), requiredHeadcount: 2, requiredQualificationCodes: [] };
    tx.staffingDemand.findFirst.mockResolvedValue(current);
    tx.staffingDemand.update.mockImplementation(({ data }) => ({ ...current, ...data }));

    await service.updateCoverageRequirement(manager, 'event-1', 'demand-1', { requiredHeadcount: 4, reason: 'Higher gate attendance forecast.' }, 'staff-coverage-update-key-3');

    expect(tx.staffingDemand.update).toHaveBeenCalledWith({ where: { id: 'demand-1' }, data: { requiredHeadcount: 4, updatedBy: manager.subject } });
    expect(tx.staffingDemandAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'updated', reason: 'Higher gate attendance forecast.', before: JSON.parse(JSON.stringify(current)),
      after: expect.objectContaining({ requiredHeadcount: 4 }),
    }) }));
  });

  it('returns only assigned active roster availability for a scoped manager and omits private notes', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'venue-1' });
    tx.person.findMany.mockResolvedValue([{ externalSubject: workerSubject, displayName: 'Worker A' }]);
    tx.staffUnavailability.findMany.mockResolvedValue([{
      id: 'unavailable-1', subject: workerSubject, startsAt: new Date('2026-10-05T00:00:00Z'),
      endsAt: new Date('2026-10-06T00:00:00Z'), note: 'private reason',
    }]);

    const rows = await service.teamAvailability(manager, 'event-1', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z');

    expect(tx.person.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ externalSubject: { in: manager.assignableUserIds } }) }));
    expect(tx.staffUnavailability.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'tenant-1', subject: { in: [workerSubject] }, deletedAt: null }),
      select: { id: true, subject: true, startsAt: true, endsAt: true },
    }));
    expect(rows).toEqual([{
      id: 'unavailable-1', subject: workerSubject, startsAt: new Date('2026-10-05T00:00:00Z'),
      endsAt: new Date('2026-10-06T00:00:00Z'), displayName: 'Worker A',
    }]);
  });

  it('rejects an availability query wider than 31 days', async () => {
    const { service, tx } = harness();
    await expect(service.teamAvailability(manager, 'event-1', '2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z'))
      .rejects.toThrow('no longer than 31 days');
    expect(tx.event.findFirst).not.toHaveBeenCalled();
  });

  it('denies a scheduler outside the event scope before reading availability', async () => {
    const { service, tx } = harness();
    await expect(service.teamAvailability({ ...manager, eventIds: [] }, 'event-1', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'))
      .rejects.toThrow('outside your assigned scope');
    expect(tx.event.findFirst).not.toHaveBeenCalled();
  });

  it('denies a scheduler when the event venue is outside their assigned venue scope', async () => {
    const { service, tx } = harness();
    tx.event.findFirst.mockResolvedValue({ id: 'event-1', venueId: 'other-venue' });
    await expect(service.teamAvailability(manager, 'event-1', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z'))
      .rejects.toThrow('outside your assigned scope');
    expect(tx.person.findMany).not.toHaveBeenCalled();
  });

  it('creates an assigned draft shift with an audit record and command receipt', async () => {
    const { service, tx } = harness();
    const shift = await service.create(manager, 'event-1', {
      venueId: 'venue-1', locationId: 'location-1', assignedSubject: workerSubject,
      role: '  Usher  ', instructions: '  Gate 4  ',
      startsAt: '2026-10-01T17:00:00Z', endsAt: '2026-10-01T22:00:00Z',
    }, 'staff-shift-create-key-01');
    expect(shift).toMatchObject({ state: 'DRAFT', role: 'Usher', instructions: 'Gate 4', assignedSubject: workerSubject });
    expect(tx.event.findFirst).toHaveBeenCalledWith({ where: { id: 'event-1', venueId: 'venue-1', organizationId: 'tenant-1' } });
    expect(tx.person.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'tenant-1', externalSubject: workerSubject, active: true } }));
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledOnce();
    expect(tx.commandReceipt.create).toHaveBeenCalledOnce();
  });

  it('rejects an assigned worker outside the signed assignable-user scope', async () => {
    const { service, tx } = harness();
    await expect(service.create({ ...manager, assignableUserIds: [] }, 'event-1', {
      venueId: 'venue-1', assignedSubject: workerSubject, role: 'Usher',
      startsAt: '2026-10-01T17:00:00Z', endsAt: '2026-10-01T22:00:00Z',
    }, 'staff-shift-create-key-02')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.staffShift.create).not.toHaveBeenCalled();
  });

  it('resets acknowledgement and increments the revision when a published shift changes', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, role: 'Usher', instructions: '', startsAt: new Date('2026-10-01T17:00:00Z'),
      endsAt: new Date('2026-10-01T22:00:00Z'), state: 'PUBLISHED', response: 'ACKNOWLEDGED',
      responseRevision: 1, attendance: 'NOT_STARTED', revision: 1,
    };
    const { service, tx } = harness(current);
    await service.update(manager, 'event-1', 'shift-1', { startsAt: '2026-10-01T18:00:00Z' }, 'staff-shift-update-key-01');
    expect(tx.staffShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      revision: { increment: 1 }, response: 'PENDING', responseRevision: null,
    }) }));
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledOnce();
  });

  it('rejects moving a shift into a location outside the manager token scope', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: null,
      assignedSubject: null, role: 'Usher', instructions: '', startsAt: new Date('2026-10-01T17:00:00Z'),
      endsAt: new Date('2026-10-01T22:00:00Z'), state: 'DRAFT', response: 'PENDING',
      responseRevision: null, attendance: 'NOT_STARTED', revision: 1,
    };
    const { service, tx } = harness(current);
    await expect(service.update({ ...manager, locationIds: [] }, 'event-1', 'shift-1', { locationId: 'location-1' }, 'staff-shift-update-key-02'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('publishes a draft and commits a durable inbox notice for its assignee', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
    };
    const { service, tx, push } = harness(current);
    await service.publish(manager, 'event-1', 'shift-1', 'staff-shift-publish-key-1');
    expect(tx.staffShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'PUBLISHED' }) }));
    expect(tx.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      organizationId: 'tenant-1', eventId: 'event-1', shiftId: 'shift-1', recipientSubject: workerSubject,
      kind: 'staffing.shift.published',
    }) }));
    expect(push.deliver).toHaveBeenCalledWith(expect.objectContaining({ subject: workerSubject }), expect.objectContaining({ kind: 'staffing.shift.published' }));
  });

  it('blocks publishing an assigned worker into an overlapping published shift', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
    };
    const { service, tx } = harness(current);
    tx.staffShift.findFirst.mockImplementation(({ where }) => Promise.resolve(
      typeof where?.id === 'object' ? { id: 'overlapping-shift' } : current,
    ));
    await expect(service.publish(manager, 'event-1', 'shift-1', 'staff-shift-publish-key-2'))
      .rejects.toThrow('overlapping published shift');
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('blocks publishing when the worker lacks a current required qualification', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: null,
      assignedSubject: workerSubject, state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
      requiredQualificationCodes: ['FOOD_HANDLER'],
    };
    const { service, tx } = harness(current);
    await expect(service.publish(manager, 'event-1', 'shift-1', 'staff-shift-publish-qual-1'))
      .rejects.toThrow('lacks a current eligible qualification for: FOOD_HANDLER');
    expect(tx.personQualification.findMany).toHaveBeenCalledOnce();
    expect(tx.personQualification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ evidenceStatus: { in: ['NONE', 'VERIFIED'] } }) }));
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('blocks an upcoming shift when the configured minimum rest gap would be violated', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: null,
      assignedSubject: workerSubject, state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
      requiredQualificationCodes: [],
    };
    const { service, tx } = harness(current, 240);
    tx.staffShift.findFirst.mockImplementation(({ where }) => Promise.resolve(
      typeof where?.id === 'string' ? current : { id: 'previous-published-shift' },
    ));
    await expect(service.publish(manager, 'event-1', 'shift-1', 'staff-shift-publish-rest-1'))
      .rejects.toThrow('violates the configured 240-minute minimum rest period');
    const conflictQuery = tx.staffShift.findFirst.mock.calls.map(([query]) => query).find((query) => typeof query.where?.id === 'object');
    expect(conflictQuery.where.startsAt.lt).toEqual(new Date('2026-10-02T02:00:00Z'));
    expect(conflictQuery.where.endsAt.gt).toEqual(new Date('2026-10-01T13:00:00Z'));
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('requires a tenant rest policy before assigning a worker', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: null,
      assignedSubject: workerSubject, state: 'DRAFT', attendance: 'NOT_STARTED', revision: 1,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'), requiredQualificationCodes: [],
    };
    const { service, tx } = harness(current, null);
    await expect(service.publish(manager, 'event-1', 'shift-1', 'staff-shift-publish-rest-2'))
      .rejects.toThrow('has not configured a minimum rest period');
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('allows only the assigned worker to acknowledge their shift', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'PUBLISHED', response: 'PENDING', attendance: 'NOT_STARTED', revision: 3,
    };
    const { service, tx } = harness(current);
    await expect(service.respond({ ...worker, subject: 'https://idp.example|other' }, 'event-1', 'shift-1', { response: 'ACKNOWLEDGED' }, 'staff-shift-response-key-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.staffShift.update).not.toHaveBeenCalled();
    await service.respond(worker, 'event-1', 'shift-1', { response: 'ACKNOWLEDGED' }, 'staff-shift-response-key-2');
    expect(tx.staffShift.update).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { response: 'ACKNOWLEDGED', responseRevision: 3, updatedBy: workerSubject } });
  });

  it('lets one active event-scoped worker claim an open published shift', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: null, state: 'PUBLISHED', response: 'PENDING', attendance: 'NOT_STARTED', revision: 2,
      startsAt: new Date('2026-10-01T17:00:00Z'), endsAt: new Date('2026-10-01T22:00:00Z'),
    };
    const { service, tx } = harness(current);
    await service.claim(worker, 'event-1', 'shift-1', 'staff-shift-claim-key-01');
    expect(tx.staffShift.update).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: expect.objectContaining({
      assignedSubject: workerSubject, revision: { increment: 1 }, response: 'PENDING', responseRevision: null,
    }) });
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledOnce();
  });

  it('blocks attendance until the worker acknowledges the current revision', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 2,
      attendance: 'NOT_STARTED', revision: 3,
    };
    const { service, tx } = harness(current);
    await expect(service.attendance(worker, 'event-1', 'shift-1', 'check-in', 'staff-shift-checkin-key-1'))
      .rejects.toThrow('Acknowledge the current published shift');
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });

  it('records check-in only for the assigned worker after the current shift is acknowledged', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 3,
      attendance: 'NOT_STARTED', revision: 3,
    };
    const { service, tx } = harness(current);
    await service.attendance(worker, 'event-1', 'shift-1', 'check-in', 'staff-shift-checkin-key-2');
    expect(tx.staffShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attendance: 'CHECKED_IN', checkedInAt: expect.any(Date) }) }));
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledOnce();
  });

  it('stores offline attendance as an unverified claim without changing the shift', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 3, revision: 3,
      attendance: 'NOT_STARTED', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000),
    };
    const { service, tx } = harness(current);
    const recordedAt = new Date().toISOString();
    const claim = await service.submitOfflineAttendance(worker, 'event-1', 'shift-1', { action: 'CHECK_IN', recordedAt }, 'staff-offline-checkin-key-01');
    expect(claim).toMatchObject({ id: 'claim-1', action: 'CHECK_IN', status: 'PENDING_REVIEW', workerSubject });
    expect(tx.staffShift.update).not.toHaveBeenCalled();
    expect(tx.staffAttendanceClaim.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING_REVIEW', action: 'CHECK_IN', workerSubject, recordedAt: new Date(recordedAt) }) });
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'attendance.offline_claimed' }) }));
  });

  it('accepts an offline check-in only after scoped review and uses the claimed time', async () => {
    const recordedAt = new Date(Date.now() - 5 * 60_000);
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      assignedSubject: workerSubject, state: 'PUBLISHED', response: 'ACKNOWLEDGED', responseRevision: 3, revision: 3,
      attendance: 'NOT_STARTED', requiredQualificationCodes: [],
    };
    const claim = { id: 'claim-1', eventId: 'event-1', organizationId: 'tenant-1', shiftId: 'shift-1', workerSubject, action: 'CHECK_IN', recordedAt, status: 'PENDING_REVIEW' };
    const { service, tx } = harness(current);
    tx.staffAttendanceClaim.findFirst.mockResolvedValue(claim);
    await service.reviewOfflineAttendance(manager, 'event-1', 'claim-1', { decision: 'ACCEPTED', reason: 'Confirmed at the staff entrance.' }, 'staff-offline-review-key-01');
    expect(tx.staffShift.update).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { attendance: 'CHECKED_IN', checkedInAt: recordedAt, updatedBy: manager.subject } });
    expect(tx.staffAttendanceClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: expect.objectContaining({ status: 'ACCEPTED', reviewedBy: manager.subject, reviewReason: 'Confirmed at the staff entrance.' }) });
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledTimes(2);
  });

  it('rejects offline claims with no reviewer reason without changing attendance', async () => {
    const claim = { id: 'claim-1', eventId: 'event-1', organizationId: 'tenant-1', shiftId: 'shift-1', workerSubject, action: 'CHECK_IN', recordedAt: new Date(), status: 'PENDING_REVIEW' };
    const { service, tx } = harness({ id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1' });
    tx.staffAttendanceClaim.findFirst.mockResolvedValue(claim);
    await expect(service.reviewOfflineAttendance(manager, 'event-1', 'claim-1', { decision: 'REJECTED', reason: '  ' }, 'staff-offline-review-key-02')).rejects.toThrow('at least three characters');
    expect(tx.staffShift.update).not.toHaveBeenCalled();
    expect(tx.staffAttendanceClaim.update).not.toHaveBeenCalled();
  });

  it('corrects attendance only for a scoped supervisor and retains the original times in audit', async () => {
    const current = {
      id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1',
      attendance: 'CHECKED_OUT', checkedInAt: new Date('2025-10-01T17:00:00Z'), checkedOutAt: new Date('2025-10-01T22:00:00Z'),
    };
    const { service, tx } = harness(current);
    const correctedIn = '2025-10-01T17:06:00Z';
    await service.correctAttendance(manager, 'event-1', 'shift-1', { checkedInAt: correctedIn, reason: 'Badge reader recorded six minutes late.' }, 'staff-attendance-correction-key-1');
    expect(tx.staffShift.update).toHaveBeenCalledWith({ where: { id: 'shift-1' }, data: { checkedInAt: new Date(correctedIn), updatedBy: manager.subject } });
    expect(tx.staffShiftAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'attendance.corrected', reason: 'Badge reader recorded six minutes late.', before: current,
    }) }));
  });

  it('denies worker corrections and blocks manager edits while offline claims await review', async () => {
    const current = { id: 'shift-1', eventId: 'event-1', organizationId: 'tenant-1', venueId: 'venue-1', locationId: 'location-1', attendance: 'CHECKED_IN', checkedInAt: new Date('2025-10-01T17:00:00Z'), checkedOutAt: null };
    const { service, tx } = harness(current);
    await expect(service.correctAttendance(worker, 'event-1', 'shift-1', { checkedInAt: '2025-10-01T17:05:00Z', reason: 'Correcting time.' }, 'staff-attendance-correction-key-2')).rejects.toBeInstanceOf(ForbiddenException);
    tx.staffAttendanceClaim.findFirst.mockResolvedValue({ id: 'claim-pending' });
    await expect(service.correctAttendance(manager, 'event-1', 'shift-1', { checkedInAt: '2025-10-01T17:05:00Z', reason: 'Correcting time.' }, 'staff-attendance-correction-key-3')).rejects.toThrow('Review pending offline attendance claims');
    expect(tx.staffShift.update).not.toHaveBeenCalled();
  });
});

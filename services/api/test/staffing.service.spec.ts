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
    event: { findFirst: vi.fn().mockResolvedValue({ id: 'event-1' }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'location-1' }) },
    person: {
      findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    personQualification: { findMany: vi.fn().mockResolvedValue([]) },
    staffUnavailability: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    staffShift: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'shift-1', state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1, ...data })),
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(typeof where?.id === 'object' ? null : current ?? null)),
      findMany: vi.fn().mockResolvedValue([]),
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
      .rejects.toThrow('lacks current required qualification(s): FOOD_HANDLER');
    expect(tx.personQualification.findMany).toHaveBeenCalledOnce();
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

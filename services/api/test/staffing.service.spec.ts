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

function harness(current?: Record<string, unknown>) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: 'event-1' }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'location-1' }) },
    person: { findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }) },
    staffShift: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'shift-1', state: 'DRAFT', response: 'PENDING', attendance: 'NOT_STARTED', revision: 1, ...data })),
      findFirst: vi.fn().mockImplementation(({ where }) => Promise.resolve(typeof where?.id === 'object' ? null : current ?? null)),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }) => ({ ...current, ...data })),
    },
    staffShiftAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    userNotification: { create: vi.fn().mockImplementation(({ data }) => ({ id: 'notification-1', ...data })) },
  };
  const prisma = {
    withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)),
  } as unknown as PrismaService;
  const push = { deliver: vi.fn().mockResolvedValue(undefined) };
  return { service: new StaffingService(prisma, push as never), tx, push };
}

describe('event staffing workflow', () => {
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
});

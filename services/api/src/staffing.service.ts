import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StaffShiftResponse } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, type Identity } from './auth';
import { CreateStaffShiftDto, RespondToShiftDto, UpdateStaffShiftDto } from './staffing.dto';
import { PrismaService } from './prisma.service';
import { PushNotificationsService } from './push-notifications.service';

@Injectable()
export class StaffingService {
  private readonly logger = new Logger(StaffingService.name);
  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  async list(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    const manager = identity.capabilities.includes('operations:write') || identity.capabilities.includes('tenant:admin');
    return this.prisma.withTenant(identity, (tx) => tx.staffShift.findMany({
      where: {
        organizationId: identity.tenantId,
        eventId,
        AND: [
          ...(!identity.capabilities.includes('tenant:admin') ? [
            { venueId: { in: identity.venueIds } },
            { OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] },
          ] : []),
          ...(!manager ? [{ OR: [{ assignedSubject: identity.subject }, { assignedSubject: null, state: 'PUBLISHED' as const }] }] : []),
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    }));
  }

  async create(identity: Identity, eventId: string, dto: CreateStaffShiftDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    if (!dto.role.trim()) throw new ConflictException('Shift role must not be blank.');
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);
    if (end <= start) throw new ConflictException('Shift end must be later than shift start.');
    const input = { eventId, venueId: dto.venueId, locationId: dto.locationId ?? null, assignedSubject: dto.assignedSubject ?? null, role: dto.role.trim(), instructions: dto.instructions?.trim() ?? '', startsAt: start.toISOString(), endsAt: end.toISOString() };
    return this.command(identity, key, 'staff-shift.create', input, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      await this.assertAssignable(tx, identity, dto.assignedSubject);
      const shift = await tx.staffShift.create({ data: {
        organizationId: identity.tenantId, eventId, venueId: dto.venueId, locationId: dto.locationId,
        assignedSubject: dto.assignedSubject, role: input.role, instructions: input.instructions,
        startsAt: start, endsAt: end, createdBy: identity.subject, updatedBy: identity.subject,
      } });
      await this.audit(tx, identity, shift.id, 'created', undefined, shift);
      return shift;
    });
  }

  async update(identity: Identity, eventId: string, shiftId: string, dto: UpdateStaffShiftDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    if (dto.role !== undefined && (typeof dto.role !== 'string' || dto.role.trim().length < 2)) throw new ConflictException('Shift role must contain at least two characters.');
    const normalized = { ...dto, role: dto.role?.trim(), instructions: dto.instructions === null ? '' : dto.instructions?.trim(), startsAt: dto.startsAt ? new Date(dto.startsAt).toISOString() : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt).toISOString() : undefined };
    const result = await this.command(identity, key, 'staff-shift.update', { eventId, shiftId, patch: normalized }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state === 'CANCELLED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('A cancelled or started shift cannot be edited.');
      const start = normalized.startsAt ? new Date(normalized.startsAt) : current.startsAt;
      const end = normalized.endsAt ? new Date(normalized.endsAt) : current.endsAt;
      if (end <= start) throw new ConflictException('Shift end must be later than shift start.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: current.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      if (dto.locationId) assertScope(identity, 'operations:write', eventId, current.venueId, dto.locationId);
      if (dto.assignedSubject !== undefined && dto.assignedSubject !== null) await this.assertAssignable(tx, identity, dto.assignedSubject);
      const materialChange = (dto.locationId !== undefined && dto.locationId !== current.locationId)
        || (dto.assignedSubject !== undefined && dto.assignedSubject !== current.assignedSubject)
        || (dto.role !== undefined && normalized.role !== current.role)
        || (dto.instructions !== undefined && normalized.instructions !== current.instructions)
        || (dto.startsAt !== undefined && start.getTime() !== current.startsAt.getTime())
        || (dto.endsAt !== undefined && end.getTime() !== current.endsAt.getTime());
      if (!materialChange) throw new ConflictException('No shift changes were supplied.');
      if (current.state === 'PUBLISHED') {
        const assignedSubject = dto.assignedSubject === undefined ? current.assignedSubject : dto.assignedSubject;
        await this.lockScheduleSubjects(tx, identity.tenantId, [current.assignedSubject, assignedSubject]);
        await this.assertNoOverlap(tx, identity.tenantId, assignedSubject, start, end, shiftId);
      }
      const patchData = {
        ...dto,
        role: normalized.role,
        instructions: normalized.instructions,
        startsAt: dto.startsAt ? start : undefined,
        endsAt: dto.endsAt ? end : undefined,
        ...(current.state === 'PUBLISHED' ? { revision: { increment: 1 }, response: StaffShiftResponse.PENDING, responseRevision: null } : {}),
        updatedBy: identity.subject,
      };
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: patchData });
      await this.audit(tx, identity, shiftId, 'updated', current, updated);
      const assignedSubject = updated.assignedSubject ?? current.assignedSubject;
      const notification = current.state === 'PUBLISHED' && materialChange
        ? await this.notification(tx, identity, updated, assignedSubject, 'staffing.shift.updated')
        : null;
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  async publish(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const result = await this.command(identity, key, 'staff-shift.publish', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state !== 'DRAFT') throw new ConflictException('Only a draft shift can be published.');
      await this.assertAssignable(tx, identity, current.assignedSubject ?? undefined);
      await this.lockScheduleSubjects(tx, identity.tenantId, [current.assignedSubject]);
      await this.assertNoOverlap(tx, identity.tenantId, current.assignedSubject, current.startsAt, current.endsAt, shiftId);
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { state: 'PUBLISHED', response: 'PENDING', responseRevision: null, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, 'published', current, updated);
      const notification = await this.notification(tx, identity, updated, updated.assignedSubject, 'staffing.shift.published');
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  async claim(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, 'staff-shift.claim', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject || current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('This open shift is no longer available.');
      const activePerson = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: identity.subject, active: true }, select: { id: true } });
      if (!activePerson) throw new ForbiddenException('An active organization roster record is required to claim a shift.');
      await this.lockScheduleSubjects(tx, identity.tenantId, [identity.subject]);
      await this.assertNoOverlap(tx, identity.tenantId, identity.subject, current.startsAt, current.endsAt, shiftId);
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: {
        assignedSubject: identity.subject,
        revision: { increment: 1 },
        response: 'PENDING',
        responseRevision: null,
        updatedBy: identity.subject,
      } });
      await this.audit(tx, identity, shiftId, 'claimed', current, updated);
      return updated;
    });
  }

  async respond(identity: Identity, eventId: string, shiftId: string, dto: RespondToShiftDto, key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, `staff-shift.${dto.response.toLowerCase()}`, { eventId, shiftId, response: dto.response, reason: dto.reason?.trim() ?? '' }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may respond to this shift.');
      if (current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('Only a current published shift can be acknowledged or declined.');
      if (current.response !== 'PENDING' && current.responseRevision === current.revision) throw new ConflictException('This shift version already has a response.');
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { response: dto.response, responseRevision: current.revision, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, dto.response.toLowerCase(), current, updated, dto.reason?.trim());
      return updated;
    });
  }

  async attendance(identity: Identity, eventId: string, shiftId: string, action: 'check-in' | 'check-out', key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, `staff-shift.${action}`, { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may record attendance.');
      if (current.state !== 'PUBLISHED' || current.response !== 'ACKNOWLEDGED' || current.responseRevision !== current.revision) throw new ConflictException('Acknowledge the current published shift before recording attendance.');
      if (action === 'check-in' && current.attendance !== 'NOT_STARTED') throw new ConflictException('Attendance has already started.');
      if (action === 'check-out' && current.attendance !== 'CHECKED_IN') throw new ConflictException('Check in before checking out.');
      const now = new Date();
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: action === 'check-in'
        ? { attendance: 'CHECKED_IN', checkedInAt: now, updatedBy: identity.subject }
        : { attendance: 'CHECKED_OUT', checkedOutAt: now, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, action, current, updated);
      return updated;
    });
  }

  async cancel(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const result = await this.command(identity, key, 'staff-shift.cancel', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('Only a published shift that has not started may be cancelled.');
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { state: 'CANCELLED', updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, 'cancelled', current, updated);
      const notification = await this.notification(tx, identity, updated, current.assignedSubject, 'staffing.shift.cancelled');
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  private notification(tx: Prisma.TransactionClient, identity: Identity, shift: { id: string; eventId: string }, recipientSubject: string | null | undefined, kind: string) {
    if (!recipientSubject || recipientSubject === identity.subject) return Promise.resolve(null);
    return tx.userNotification.create({ data: {
      organizationId: identity.tenantId,
      eventId: shift.eventId,
      shiftId: shift.id,
      recipientSubject,
      kind,
      title: kind === 'staffing.shift.cancelled' ? 'Shift cancelled' : kind === 'staffing.shift.published' ? 'New shift assigned' : 'Shift schedule updated',
      body: 'Open Venue Wrangler to review your event schedule.',
    } });
  }

  private deliver(identity: Identity, notification: { id: string; kind: string; recipientSubject: string } | null) {
    if (!notification) return;
    void this.push.deliver({ ...identity, subject: notification.recipientSubject }, notification).catch(() => {
      this.logger.warn('Push dispatch failed after the durable shift notification was committed.');
    });
  }

  private async assertAssignable(tx: Prisma.TransactionClient, identity: Identity, subject?: string) {
    if (subject === undefined) return;
    if (!identity.assignableUserIds.includes(subject)) throw new ForbiddenException('The selected person is outside your assignment scope.');
    const person = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: subject, active: true }, select: { id: true } });
    if (!person) throw new NotFoundException('The selected person is not an active user in this organization.');
  }

  private async lockScheduleSubjects(tx: Prisma.TransactionClient, tenantId: string, subjects: Array<string | null | undefined>) {
    for (const subject of [...new Set(subjects.filter((value): value is string => Boolean(value)))].sort()) {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${tenantId}:${subject}`}, 0))`;
    }
  }

  private async assertNoOverlap(tx: Prisma.TransactionClient, tenantId: string, subject: string | null | undefined, startsAt: Date, endsAt: Date, exceptShiftId: string) {
    if (!subject) return;
    const conflict = await tx.staffShift.findFirst({ where: {
      organizationId: tenantId,
      assignedSubject: subject,
      state: 'PUBLISHED',
      id: { not: exceptShiftId },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    }, select: { id: true } });
    if (conflict) throw new ConflictException('This worker already has an overlapping published shift. Adjust the schedule before publishing.');
  }

  private audit(tx: Prisma.TransactionClient, identity: Identity, shiftId: string, action: string, before?: unknown, after?: unknown, reason?: string) {
    return tx.staffShiftAuditEvent.create({ data: {
      organizationId: identity.tenantId, shiftId, actorId: identity.subject, action, reason,
      before: before as Prisma.InputJsonValue | undefined, after: after as Prisma.InputJsonValue | undefined,
    } });
  }

  private async command<T>(identity: Identity, key: string, action: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, actor: identity.subject, input })).digest('hex');
    return this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const receipt = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.');
        return receipt.response as T;
      }
      const response = await work(tx);
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue } });
      return response;
    });
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, type Identity } from './auth';
import { PrismaService } from './prisma.service';
import { PushNotificationsService } from './push-notifications.service';
import { CreateVendorStaffingRequestDto, RespondVendorStaffingRequestDto } from './vendor-staffing.dto';

@Injectable()
export class VendorStaffingService {
  private readonly logger = new Logger(VendorStaffingService.name);
  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  async list(identity: Identity, eventId: string) {
    const manager = identity.capabilities.includes('operations:write') || identity.capabilities.includes('tenant:admin');
    if (!manager && !identity.capabilities.includes('operations:read') && !identity.capabilities.includes('vendor:staffing')) throw new ForbiddenException('Your role cannot view vendor staffing requests.');
    assertScope(identity, identity.capabilities.includes('operations:read') ? 'operations:read' : manager ? 'operations:write' : 'vendor:staffing', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId, venueId: { in: identity.venueIds } }, select: { id: true, venueId: true } });
      if (!event) throw new NotFoundException('Event not found in your assigned scope.');
      return tx.staffingVendorRequest.findMany({
        where: { organizationId: identity.tenantId, eventId,
          ...(!identity.capabilities.includes('tenant:admin') ? { venueId: { in: identity.venueIds }, OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] } : {}),
          ...(!manager ? { vendorSubject: identity.subject } : {}),
        }, orderBy: [{ responseDueAt: 'asc' }, { createdAt: 'desc' }],
        include: { demand: { select: { role: true, startsAt: true, endsAt: true } } },
      });
    });
  }

  async create(identity: Identity, eventId: string, dto: CreateVendorStaffingRequestDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    if (!identity.assignableUserIds.includes(dto.vendorSubject)) throw new ForbiddenException('The selected vendor is outside your assignment scope.');
    const responseDueAt = new Date(dto.responseDueAt);
    if (!Number.isFinite(responseDueAt.getTime()) || responseDueAt <= new Date()) throw new BadRequestException('The response deadline must be in the future.');
    if (dto.instructions && dto.instructions.trim().length > 1000) throw new BadRequestException('Instructions cannot exceed 1000 characters.');
    const input = { eventId, demandId: dto.demandId, vendorSubject: dto.vendorSubject, requestedHeadcount: dto.requestedHeadcount, responseDueAt: responseDueAt.toISOString(), instructions: dto.instructions?.trim() ?? '' };
    const fingerprint = createHash('sha256').update(JSON.stringify({ action: 'vendor-staffing.create', actor: identity.subject, input })).digest('hex');
    const result = await this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const prior = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (prior) { if (prior.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.'); return { request: prior.response, notification: null }; }
      const demand = await tx.staffingDemand.findFirst({ where: { id: dto.demandId, eventId, organizationId: identity.tenantId } });
      if (!demand) throw new NotFoundException('Staffing demand not found in this event.');
      assertScope(identity, 'operations:write', eventId, demand.venueId, demand.locationId ?? undefined);
      const vendor = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: dto.vendorSubject, active: true }, select: { externalSubject: true } });
      if (!vendor) throw new NotFoundException('The selected vendor must be an active person in this organization.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vendor-demand:${identity.tenantId}:${dto.demandId}`}, 0))`;
      const [shifts, outstanding] = await Promise.all([
        tx.staffShift.count({ where: { organizationId: identity.tenantId, eventId, venueId: demand.venueId, ...(demand.locationId ? { locationId: demand.locationId } : {}), role: demand.role, state: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { lte: demand.startsAt }, endsAt: { gte: demand.endsAt } } }),
        tx.staffingVendorRequest.findMany({ where: { organizationId: identity.tenantId, demandId: demand.id, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } }, select: { state: true, requestedHeadcount: true, committedHeadcount: true } }),
      ]);
      const reserved = outstanding.reduce((total, request) => total + (['SENT', 'ACKNOWLEDGED'].includes(request.state) ? request.requestedHeadcount : request.committedHeadcount), 0);
      const remaining = Math.max(0, demand.requiredHeadcount - shifts - reserved);
      if (dto.requestedHeadcount > remaining) throw new ConflictException(`The request exceeds uncovered demand. Only ${remaining} position(s) remain.`);
      const request = await tx.staffingVendorRequest.create({ data: {
        organizationId: identity.tenantId, venueId: demand.venueId, eventId, locationId: demand.locationId,
        demandId: demand.id, requesterSubject: identity.subject, vendorSubject: dto.vendorSubject,
        requestedHeadcount: dto.requestedHeadcount, responseDueAt, instructions: input.instructions,
      } });
      const notification = await tx.userNotification.create({ data: { organizationId: identity.tenantId, eventId, recipientSubject: dto.vendorSubject, kind: 'vendor_staffing_request', title: 'Staffing request', body: 'A venue requested staffing coverage. Open Vendor Staffing to review the role, time, quantity, and deadline.' } });
      await this.audit(tx, identity, request.id, 'sent', undefined, request);
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action: 'vendor-staffing.create', response: request as unknown as Prisma.InputJsonValue } });
      return { request, notification };
    });
    if (result.notification) this.deliver(identity, result.notification);
    return result.request;
  }

  async respond(identity: Identity, eventId: string, requestId: string, dto: RespondVendorStaffingRequestDto, key: string) {
    assertScope(identity, 'vendor:staffing', eventId);
    if (!['ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED', 'DECLINED'].includes(dto.decision)) throw new BadRequestException('Unsupported vendor response.');
    const reason = dto.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw new BadRequestException('A response reason between 3 and 500 characters is required.');
    const committed = dto.committedHeadcount ?? (dto.decision === 'COMMITTED' ? undefined : 0);
    const input = { eventId, requestId, decision: dto.decision, committedHeadcount: committed, reason };
    return this.command(identity, key, 'vendor-staffing.respond', input, async (tx) => {
      const current = await tx.staffingVendorRequest.findFirst({ where: { id: requestId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Vendor staffing request not found.');
      if (current.vendorSubject !== identity.subject) throw new ForbiddenException('This request is assigned to another vendor account.');
      if (!identity.venueIds.includes(current.venueId) || (current.locationId && !identity.locationIds.includes(current.locationId))) throw new ForbiddenException('This request is outside your assigned scope.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vendor-demand:${identity.tenantId}:${current.demandId}`}, 0))`;
      const allowedSourceStates = current.state === 'PARTIALLY_COMMITTED'
        ? ['PARTIALLY_COMMITTED']
        : ['SENT', 'ACKNOWLEDGED'];
      if (!allowedSourceStates.includes(current.state)) throw new ConflictException('This request is no longer open for a response.');
      if (current.state === 'PARTIALLY_COMMITTED' && !['PARTIALLY_COMMITTED', 'COMMITTED'].includes(dto.decision)) throw new ConflictException('A partial commitment may be increased or completed; use the manager workflow if the commitment must be cancelled.');
      if (dto.decision === 'COMMITTED') dto.committedHeadcount = current.requestedHeadcount;
      if (dto.decision === 'ACKNOWLEDGED') dto.committedHeadcount = 0;
      if (dto.decision === 'DECLINED') dto.committedHeadcount = 0;
      if (dto.decision === 'PARTIALLY_COMMITTED' && (!committed || committed >= current.requestedHeadcount || committed <= current.committedHeadcount)) throw new BadRequestException('A partial commitment must increase the current commitment and stay below the requested headcount.');
      const count = dto.committedHeadcount ?? 0;
      if (count < 0 || count > current.requestedHeadcount) throw new BadRequestException('Committed headcount must not exceed the requested headcount.');
      if (['PARTIALLY_COMMITTED', 'COMMITTED'].includes(dto.decision)) {
        const demand = await tx.staffingDemand.findFirst({ where: { id: current.demandId, eventId, organizationId: identity.tenantId } });
        if (!demand) throw new NotFoundException('The staffing demand associated with this request no longer exists.');
        const [shifts, otherRequests] = await Promise.all([
          tx.staffShift.count({ where: { organizationId: identity.tenantId, eventId, venueId: demand.venueId, ...(demand.locationId ? { locationId: demand.locationId } : {}), role: demand.role, state: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { lte: demand.startsAt }, endsAt: { gte: demand.endsAt } } }),
          tx.staffingVendorRequest.findMany({ where: { organizationId: identity.tenantId, demandId: demand.id, id: { not: current.id }, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } }, select: { state: true, requestedHeadcount: true, committedHeadcount: true } }),
        ]);
        const otherReserved = otherRequests.reduce((total, request) => total + (['SENT', 'ACKNOWLEDGED'].includes(request.state) ? request.requestedHeadcount : request.committedHeadcount), 0);
        const capacityForThisRequest = Math.max(0, demand.requiredHeadcount - shifts - otherReserved);
        if (count > capacityForThisRequest) throw new ConflictException(`Other scheduled or vendor coverage now reserves this demand. The maximum commitment available to this request is ${capacityForThisRequest}.`);
      }
      const updated = await tx.staffingVendorRequest.update({ where: { id: requestId }, data: { state: dto.decision, committedHeadcount: count, responseReason: reason, respondedAt: new Date() } });
      await this.audit(tx, identity, requestId, `response.${dto.decision.toLowerCase()}`, current, updated, reason);
      const notification = await tx.userNotification.create({ data: { organizationId: identity.tenantId, eventId, recipientSubject: current.requesterSubject, kind: 'vendor_staffing_response', title: 'Vendor response received', body: 'A vendor responded to a staffing request. Open Vendor Staffing to review the commitment.' } });
      return { updated, notification };
    }).then(({ value, replayed }) => { if (!replayed) this.deliver(identity, value.notification); return value.updated; });
  }

  async escalateOverdue(identity: Identity, eventId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const input = { eventId };
    const result = await this.command(identity, key, 'vendor-staffing.escalate-overdue', input, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId }, select: { id: true, venueId: true } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:write', eventId, event.venueId);
      const due = await tx.staffingVendorRequest.findMany({ where: { organizationId: identity.tenantId, eventId, state: { in: ['SENT', 'ACKNOWLEDGED'] }, responseDueAt: { lt: new Date() }, escalatedAt: null } });
      const notices = [];
      for (const request of due) {
        const updated = await tx.staffingVendorRequest.update({ where: { id: request.id }, data: { escalatedAt: new Date() } });
        await this.audit(tx, identity, request.id, 'deadline_escalated', request, updated, 'Response deadline passed without a commitment.');
        const notice = await tx.venueNotice.create({ data: { organizationId: identity.tenantId, venueId: request.venueId, recipientSubject: request.requesterSubject, kind: 'vendor.deadline_escalated', title: 'Vendor deadline passed', body: 'A vendor staffing request passed its deadline without a commitment. The gap is still open.' } });
        notices.push(notice);
      }
      return { escalated: due.length, notices };
    });
    if (!result.replayed) {
      for (const notice of result.value.notices) this.deliver(identity, { id: notice.id, kind: notice.kind, recipientSubject: notice.recipientSubject });
    }
    return { escalated: result.value.escalated };
  }

  async resolve(identity: Identity, eventId: string, requestId: string, state: 'CANCELLED' | 'FULFILLED', reason: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const normalized = reason.trim();
    if (normalized.length < 3 || normalized.length > 500) throw new BadRequestException('A resolution reason between 3 and 500 characters is required.');
    const input = { eventId, requestId, state, reason: normalized };
    return this.command(identity, key, `vendor-staffing.${state.toLowerCase()}`, input, async (tx) => {
      const current = await tx.staffingVendorRequest.findFirst({ where: { id: requestId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Vendor staffing request not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (state === 'CANCELLED' && ['CANCELLED', 'FULFILLED', 'DECLINED'].includes(current.state)) throw new ConflictException('This request can no longer be cancelled.');
      if (state === 'FULFILLED' && !['COMMITTED', 'PARTIALLY_COMMITTED'].includes(current.state)) throw new ConflictException('Only a committed request can be marked fulfilled. This records a manager attestation and does not verify named worker attendance.');
      const updated = await tx.staffingVendorRequest.update({ where: { id: requestId }, data: { state, responseReason: normalized, ...(state === 'CANCELLED' ? { cancelledAt: new Date() } : { fulfilledAt: new Date() }) } });
      await this.audit(tx, identity, requestId, state.toLowerCase(), current, updated, normalized);
      return updated;
    }).then(({ value }) => value);
  }

  private async command<T>(identity: Identity, key: string, action: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<T>) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, actor: identity.subject, input })).digest('hex');
    return this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const prior = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (prior) { if (prior.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.'); return { value: prior.response as T, replayed: true }; }
      const response = await work(tx);
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue } });
      return { value: response, replayed: false };
    });
  }

  private audit(tx: Prisma.TransactionClient, identity: Identity, requestId: string, action: string, before?: unknown, after?: unknown, reason?: string) {
    return tx.staffingVendorRequestAudit.create({ data: { organizationId: identity.tenantId, requestId, actorId: identity.subject, action, reason,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
    } });
  }

  private deliver(identity: Identity, notification: { id: string; kind: string; recipientSubject: string }) {
    void this.push.deliver({ ...identity, subject: notification.recipientSubject }, notification).catch(() => this.logger.warn('Push dispatch failed after vendor staffing notification was committed.'));
  }
}

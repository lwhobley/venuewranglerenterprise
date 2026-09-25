import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, Identity } from './auth';
import { CreatePostCloseCorrectionDto, UpdateCloseoutFollowupDto } from './closeout.dto';
import { PrismaService } from './prisma.service';
import { PushNotificationsService } from './push-notifications.service';

type Exception = { sourceType: string; sourceId: string; title: string };

@Injectable()
export class CloseoutService {
  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  async overview(identity: Identity, eventId: string) {
    assertScope(identity, 'event:closeout', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId, venueId: { in: identity.venueIds } }, select: { id: true, venueId: true, name: true, startsAt: true } });
      if (!event) throw new NotFoundException('Event not found in your assigned scope.');
      const closeout = await tx.eventCloseout.findUnique({
        where: { eventId_organizationId: { eventId, organizationId: identity.tenantId } },
        include: {
          followups: { orderBy: [{ state: 'asc' }, { createdAt: 'asc' }] },
          corrections: { orderBy: { createdAt: 'desc' }, take: 100 },
          auditEvents: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, actorId: true, action: true, reason: true, createdAt: true } },
        },
      });
      const exceptions = await this.exceptions(tx, identity.tenantId, eventId);
      const followups = closeout?.followups ?? [];
      const corrections = closeout?.corrections ?? [];
      const followupKeys = new Map(followups.map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
      const blockers = exceptions.filter((item) => {
        const handling = followupKeys.get(`${item.sourceType}:${item.sourceId}`);
        return !handling || !['FOLLOW_UP', 'ACCEPTED'].includes(handling.state);
      });
      return { event, closeout, exceptions, followups, corrections, blockers, canFinalize: closeout?.state === 'OPEN' && blockers.length === 0 };
    });
  }

  async open(identity: Identity, eventId: string, key: string) {
    assertScope(identity, 'event:closeout', eventId);
    const input = { eventId };
    const fingerprint = createHash('sha256').update(JSON.stringify({ action: 'event.closeout.open', actor: identity.subject, input })).digest('hex');
    return this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const prior = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.');
        return prior.response;
      }
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId, venueId: { in: identity.venueIds } } });
      if (!event) throw new NotFoundException('Event not found in your assigned scope.');
      const existing = await tx.eventCloseout.findUnique({ where: { eventId_organizationId: { eventId, organizationId: identity.tenantId } } });
      if (existing?.state === 'CLOSED') throw new ConflictException('This event is already closed.');
      const closeout = existing ?? await tx.eventCloseout.create({ data: { organizationId: identity.tenantId, venueId: event.venueId, eventId, openedBy: identity.subject } });
      await tx.eventCloseoutAudit.create({ data: { organizationId: identity.tenantId, closeoutId: closeout.id, actorId: identity.subject, action: existing ? 'reopened_for_review' : 'opened', after: closeout as unknown as Prisma.InputJsonValue } });
      const response = { id: closeout.id, eventId, state: closeout.state, openedAt: closeout.openedAt };
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action: 'event.closeout.open', response: response as Prisma.InputJsonValue } });
      return response;
    });
  }

  async updateFollowup(identity: Identity, eventId: string, dto: UpdateCloseoutFollowupDto, key: string) {
    assertScope(identity, 'event:closeout', eventId);
    if (dto.state === 'FOLLOW_UP' && (!dto.ownerSubject || !dto.dueAt)) throw new ConflictException('A follow-up needs an owner and due date.');
    if (dto.state === 'FOLLOW_UP' && new Date(dto.dueAt!).getTime() <= Date.now()) throw new ConflictException('A follow-up due date must be in the future.');
    if (dto.reason.trim().length < 3) throw new ConflictException('Add a clear reason of at least three characters.');
    if (dto.ownerSubject && !identity.assignableUserIds.includes(dto.ownerSubject)) throw new ForbiddenException('The selected follow-up owner is outside your assignment scope.');
    const outcome = await this.command(identity, key, 'event.closeout.followup', { eventId, dto }, async (tx) => {
      const closeout = await tx.eventCloseout.findFirst({ where: { eventId, organizationId: identity.tenantId, state: 'OPEN' } });
      if (!closeout) throw new NotFoundException('Open event closeout not found.');
      const active = (await this.exceptions(tx, identity.tenantId, eventId)).find((item) => item.sourceType === dto.sourceType && item.sourceId === dto.sourceId);
      if (active && dto.state === 'DONE') throw new ConflictException('Resolve the source workflow first, then refresh closeout before marking it done.');
      const where = { closeoutId_sourceType_sourceId: { closeoutId: closeout.id, sourceType: dto.sourceType, sourceId: dto.sourceId } };
      const row = await tx.eventCloseoutFollowup.findUnique({ where });
      if (!active && (dto.state !== 'DONE' || !row)) throw new NotFoundException('This source exception is no longer active. Refresh the event closeout.');
      if (dto.ownerSubject) {
        const owner = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: dto.ownerSubject, active: true }, select: { id: true } });
        if (!owner) throw new NotFoundException('An active person in this organization is required for the follow-up.');
      }
      const data = { state: dto.state, ownerSubject: dto.state === 'FOLLOW_UP' ? dto.ownerSubject : null, dueAt: dto.state === 'FOLLOW_UP' ? new Date(dto.dueAt!) : null, reason: dto.reason.trim() };
      const updated = await tx.eventCloseoutFollowup.upsert({ where, create: { organizationId: identity.tenantId, closeoutId: closeout.id, sourceType: dto.sourceType, sourceId: dto.sourceId, title: active?.title ?? `Resolved ${dto.sourceType.toLowerCase()} exception`, ...data }, update: { title: active?.title ?? undefined, ...data } });
      await tx.eventCloseoutAudit.create({ data: { organizationId: identity.tenantId, closeoutId: closeout.id, actorId: identity.subject, action: dto.state === 'FOLLOW_UP' ? 'follow_up_assigned' : dto.state === 'ACCEPTED' ? 'exception_accepted' : 'exception_resolved', before: row as unknown as Prisma.InputJsonValue, after: updated as unknown as Prisma.InputJsonValue, reason: dto.reason.trim() } });
      const notification = dto.state === 'FOLLOW_UP' && dto.ownerSubject
        ? await tx.userNotification.create({ data: { organizationId: identity.tenantId, eventId, recipientSubject: dto.ownerSubject, kind: 'event_closeout_followup', title: 'Event closeout follow-up assigned', body: 'You have an assigned closeout follow-up. Open the event in Venue Wrangler to review.' }, select: { id: true, kind: true } })
        : null;
      return { followup: updated, notification };
    });
    if (outcome.notification) void this.push.deliver({ ...identity, subject: dto.ownerSubject! }, outcome.notification).catch(() => undefined);
    return outcome.followup;
  }

  async updateSummary(identity: Identity, eventId: string, summary: string, key: string) {
    assertScope(identity, 'event:closeout', eventId);
    return this.command(identity, key, 'event.closeout.summary', { eventId, summary }, async (tx) => {
      const row = await tx.eventCloseout.findFirst({ where: { eventId, organizationId: identity.tenantId } });
      if (!row || row.state !== 'OPEN') throw new ConflictException('Open the event closeout before editing its summary.');
      const updated = await tx.eventCloseout.update({ where: { id: row.id }, data: { summary: summary.trim() } });
      await tx.eventCloseoutAudit.create({ data: { organizationId: identity.tenantId, closeoutId: row.id, actorId: identity.subject, action: 'summary_updated', before: { summary: row.summary }, after: { summary: updated.summary } } });
      return { summary: updated.summary };
    });
  }

  async finalize(identity: Identity, eventId: string, key: string) {
    assertScope(identity, 'event:closeout', eventId);
    return this.command(identity, key, 'event.closeout.finalize', { eventId }, async (tx) => {
      // Serialize finalization against tenant-admin event edits. Both paths lock
      // the event row before inspecting or changing closeout state.
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId}::uuid AND organization_id = ${identity.tenantId}::uuid FOR UPDATE`;
      const closeout = await tx.eventCloseout.findFirst({ where: { eventId, organizationId: identity.tenantId } });
      if (!closeout) throw new ConflictException('Start event closeout before finalizing.');
      if (closeout.state === 'CLOSED') return closeout;
      await tx.$queryRaw`SELECT id FROM event_closeouts WHERE id = ${closeout.id}::uuid FOR UPDATE`;
      const lockedCloseout = await tx.eventCloseout.findUniqueOrThrow({ where: { id: closeout.id } });
      if (lockedCloseout.state === 'CLOSED') return lockedCloseout;
      const exceptions = await this.exceptions(tx, identity.tenantId, eventId);
      for (const item of exceptions) {
        const handling = await tx.eventCloseoutFollowup.findUnique({ where: { closeoutId_sourceType_sourceId: { closeoutId: closeout.id, sourceType: item.sourceType, sourceId: item.sourceId } } });
        if (!handling || !['FOLLOW_UP', 'ACCEPTED'].includes(handling.state)) throw new ConflictException(`Resolve, accept with a reason, or assign a dated follow-up for: ${item.title}`);
        if (handling.state === 'FOLLOW_UP') {
          const owner = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: handling.ownerSubject ?? '', active: true }, select: { id: true } });
          if (!owner || !handling.dueAt) throw new ConflictException(`The follow-up owner or due date is no longer valid for: ${item.title}`);
        }
      }
      const finalized = await tx.eventCloseout.update({ where: { id: closeout.id }, data: { state: 'CLOSED', finalizedBy: identity.subject, finalizedAt: new Date() } });
      await tx.eventCloseoutAudit.create({ data: { organizationId: identity.tenantId, closeoutId: closeout.id, actorId: identity.subject, action: 'finalized', before: closeout as unknown as Prisma.InputJsonValue, after: finalized as unknown as Prisma.InputJsonValue } });
      return finalized;
    });
  }

  async createCorrection(identity: Identity, eventId: string, dto: CreatePostCloseCorrectionDto, key: string) {
    assertScope(identity, 'event:closeout', eventId);
    return this.command(identity, key, 'event.closeout.correction', { eventId, dto }, async (tx) => {
      const closeout = await tx.eventCloseout.findFirst({ where: { eventId, organizationId: identity.tenantId } });
      if (!closeout || closeout.state !== 'CLOSED') throw new ConflictException('Post-close corrections can only be added to a closed event.');
      if (dto.sourceType === 'EVENT') {
        if (dto.sourceId !== eventId) throw new NotFoundException('The selected source record does not belong to this event.');
      } else {
        const source = await this.correctionSourceExists(tx, identity.tenantId, eventId, dto.sourceType, dto.sourceId);
        if (!source) throw new NotFoundException('The selected source record does not belong to this event.');
      }
      const data = {
        organizationId: identity.tenantId, eventId, sourceType: dto.sourceType, sourceId: dto.sourceId.trim(),
        headline: dto.headline.trim(), correction: dto.correction.trim(), reason: dto.reason.trim(), createdBy: identity.subject,
      };
      const correction = await tx.eventPostCloseCorrection.create({ data });
      await tx.eventCloseoutAudit.create({ data: {
        organizationId: identity.tenantId, closeoutId: closeout.id, actorId: identity.subject,
        action: 'post_close_correction_recorded', reason: data.reason,
        after: { id: correction.id, sourceType: correction.sourceType, sourceId: correction.sourceId, headline: correction.headline } as Prisma.InputJsonValue,
      } });
      return correction;
    });
  }

  private async correctionSourceExists(tx: Prisma.TransactionClient, tenantId: string, eventId: string, sourceType: string, sourceId: string): Promise<boolean> {
    switch (sourceType) {
      case 'ISSUE': return !!await tx.issue.findFirst({ where: { id: sourceId, eventId, organizationId: tenantId }, select: { id: true } });
      case 'TASK': return !!await tx.operationalTask.findFirst({ where: { id: sourceId, eventId, organizationId: tenantId }, select: { id: true } });
      case 'ATTENDANCE': return !!await tx.staffAttendanceClaim.findFirst({ where: { id: sourceId, eventId, organizationId: tenantId }, select: { id: true } });
      case 'HOSPITALITY': return !!await tx.hospitalityOrder.findFirst({ where: { id: sourceId, eventId, organizationId: tenantId }, select: { id: true } });
      case 'VENDOR_REQUEST': return !!await tx.staffingVendorRequest.findFirst({ where: { id: sourceId, eventId, organizationId: tenantId }, select: { id: true } });
      case 'STOCK_COUNT': return (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM stock_counts WHERE id = ${sourceId}::uuid AND event_id = ${eventId}::uuid AND organization_id = ${tenantId}::uuid`).length > 0;
      case 'STOCK_TRANSFER': return (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM stock_transfers WHERE id = ${sourceId}::uuid AND event_id = ${eventId}::uuid AND organization_id = ${tenantId}::uuid`).length > 0;
      default: return false;
    }
  }

  private async exceptions(tx: Prisma.TransactionClient, tenantId: string, eventId: string): Promise<Exception[]> {
    const [issues, tasks, claims, orders, counts, transfers, vendorRequests] = await Promise.all([
      tx.issue.findMany({ where: { organizationId: tenantId, eventId, state: { notIn: ['VERIFIED', 'CLOSED'] } }, select: { id: true, title: true, state: true } }),
      tx.operationalTask.findMany({ where: { organizationId: tenantId, eventId, state: { not: 'DONE' } }, select: { id: true, title: true } }),
      tx.staffAttendanceClaim.findMany({ where: { organizationId: tenantId, eventId, status: 'PENDING_REVIEW' }, select: { id: true, action: true, workerSubject: true } }),
      tx.hospitalityOrder.findMany({ where: { organizationId: tenantId, eventId, state: { notIn: ['PICKED_UP', 'REJECTED', 'CANCELLED'] } }, select: { id: true, state: true } }),
      tx.$queryRaw<Array<{ id: string; label: string }>>`SELECT id::text, 'Inventory count awaiting approval' AS label FROM stock_counts WHERE organization_id = ${tenantId}::uuid AND event_id = ${eventId}::uuid AND state IN ('IN_PROGRESS','SUBMITTED')`,
      tx.$queryRaw<Array<{ id: string; label: string }>>`SELECT id::text, 'Stock transfer awaiting receipt or cancellation' AS label FROM stock_transfers WHERE organization_id = ${tenantId}::uuid AND event_id = ${eventId}::uuid AND state IN ('REQUESTED','IN_TRANSIT')`,
      tx.staffingVendorRequest.findMany({ where: { organizationId: tenantId, eventId, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } }, select: { id: true, state: true, requestedHeadcount: true, committedHeadcount: true } }),
    ]);
    return [
      ...issues.map((row) => ({ sourceType: 'ISSUE', sourceId: row.id, title: `Issue: ${row.title} (${row.state.toLowerCase()})` })),
      ...tasks.map((row) => ({ sourceType: 'TASK', sourceId: row.id, title: `Open task: ${row.title}` })),
      ...claims.map((row) => ({ sourceType: 'ATTENDANCE', sourceId: row.id, title: `Offline attendance ${row.action.toLowerCase()} claim needs supervisor review` })),
      ...orders.map((row) => ({ sourceType: 'HOSPITALITY', sourceId: row.id, title: `Hospitality order awaiting completion (${row.state.toLowerCase()})` })),
      ...counts.map((row) => ({ sourceType: 'STOCK_COUNT', sourceId: row.id, title: row.label })),
      ...transfers.map((row) => ({ sourceType: 'STOCK_TRANSFER', sourceId: row.id, title: row.label })),
      ...vendorRequests.map((row) => ({ sourceType: 'VENDOR_REQUEST', sourceId: row.id, title: `Vendor staffing request needs closure (${row.committedHeadcount}/${row.requestedHeadcount} committed; ${row.state.toLowerCase()})` })),
    ];
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
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: response as Prisma.InputJsonValue } });
      return response;
    });
  }
}

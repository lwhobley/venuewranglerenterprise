import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IssueState, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Observable, concatMap, exhaustMap, from, map, timer } from 'rxjs';
import { assertAssignable, assertScope, Identity } from './auth';
import { AssignIssueDto, CreateIssueDto, IssueNoteDto } from './issues.dto';
import { PrismaService } from './prisma.service';
import { PushNotificationsService } from './push-notifications.service';

export type StreamIssueEvent = {
  id: string;
  type: 'issue';
  data: { issueId: string; action: string; issue: Prisma.JsonValue };
};
export const issueTransitions: Record<string, IssueState[]> = {
  TRIAGED: [IssueState.REPORTED, IssueState.ESCALATED],
  ASSIGNED: [IssueState.TRIAGED, IssueState.REPORTED, IssueState.ESCALATED, IssueState.ASSIGNED],
  ESCALATED: [IssueState.REPORTED, IssueState.TRIAGED, IssueState.ASSIGNED, IssueState.IN_PROGRESS],
  IN_PROGRESS: [IssueState.ASSIGNED, IssueState.TRIAGED, IssueState.ESCALATED],
  RESOLVED: [IssueState.IN_PROGRESS, IssueState.ASSIGNED, IssueState.ESCALATED],
  VERIFIED: [IssueState.RESOLVED],
  CLOSED: [IssueState.VERIFIED],
};

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  stream(identity: Identity, eventId: string, lastEventId = '0'): Observable<StreamIssueEvent> {
    let cursor = BigInt(lastEventId);
    return timer(0, 1000).pipe(
      exhaustMap(() => this.prisma.withTenant(identity, async (tx) => {
        const visibleIssues = await tx.issue.findMany({
          where: {
            eventId,
            organizationId: identity.tenantId,
            venueId: { in: identity.venueIds },
            OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }],
          },
          select: { id: true },
        });
        return tx.issueDomainEvent.findMany({
          where: { eventId, issueId: { in: visibleIssues.map((issue) => issue.id) }, id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: 100,
        });
      })),
      concatMap((events) => from(events)),
      map((event) => {
        cursor = event.id;
        return {
          id: event.id.toString(),
          type: 'issue' as const,
          data: { issueId: event.issueId, action: event.action, issue: event.payload },
        };
      }),
    );
  }

  async list(identity: Identity, eventId: string) {
    assertScope(identity, 'issue:read', eventId);
    return this.prisma.withTenant(identity, (tx) => tx.issue.findMany({
      where: {
        eventId,
        organizationId: identity.tenantId,
        venueId: { in: identity.venueIds },
        OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }],
      },
      orderBy: [{ severity: 'desc' }, { updatedAt: 'desc' }],
      include: { auditEvents: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }));
  }

  async create(identity: Identity, eventId: string, dto: CreateIssueDto, key: string) {
    assertScope(identity, 'issue:report', eventId, dto.venueId, dto.locationId);
    const fingerprint = this.fingerprint('reported', { actorId: identity.subject, eventId, dto });
    const transaction = await this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${identity.tenantId + key}, 0))`;
      const replay = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (replay) return { response: this.replay(replay.fingerprint, fingerprint, replay.response), notification: null as { id: string; kind: string; recipientSubject: string } | null };
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId } });
      if (!event) throw new NotFoundException('This event is unavailable in the selected venue.');
      if (dto.locationId) {
        const location = await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId } });
        if (!location) throw new NotFoundException('This location is unavailable in the selected venue.');
      }
      const issue = await tx.issue.create({ data: { organizationId: identity.tenantId, eventId, venueId: dto.venueId, locationId: dto.locationId, title: dto.title, description: dto.description, category: dto.category, severity: dto.severity, reporterId: identity.subject } });
      await tx.issueAuditEvent.create({ data: { organizationId: identity.tenantId, issueId: issue.id, actorId: identity.subject, action: 'reported', after: issue as unknown as Prisma.InputJsonValue } });
      const result = { issue, replayed: false };
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action: 'reported', response: result as unknown as Prisma.InputJsonValue } });
      await tx.issueDomainEvent.create({ data: { organizationId: identity.tenantId, eventId, issueId: issue.id, action: 'reported', payload: issue as unknown as Prisma.InputJsonValue } });
      return { response: result, notification: null as { id: string; kind: string; recipientSubject: string } | null };
    });
    return transaction.response;
  }

  async assign(identity: Identity, eventId: string, issueId: string, dto: AssignIssueDto, key: string) {
    assertScope(identity, 'issue:triage', eventId);
    assertAssignable(identity, dto.ownerId);
    return this.command(identity, eventId, issueId, key, 'issue:triage', 'assigned', IssueState.ASSIGNED, dto.reason, { ownerId: dto.ownerId });
  }
  async triage(identity: Identity, eventId: string, issueId: string, dto: IssueNoteDto, key: string) {
    assertScope(identity, 'issue:triage', eventId);
    return this.command(identity, eventId, issueId, key, 'issue:triage', 'triaged', IssueState.TRIAGED, dto.reason, {});
  }
  async escalate(identity: Identity, eventId: string, issueId: string, dto: IssueNoteDto, key: string) {
    assertScope(identity, 'issue:escalate', eventId);
    return this.command(identity, eventId, issueId, key, 'issue:escalate', 'escalated', IssueState.ESCALATED, dto.reason, { escalationNote: dto.reason });
  }
  async resolve(identity: Identity, eventId: string, issueId: string, dto: IssueNoteDto, key: string) {
    assertScope(identity, 'issue:resolve', eventId);
    return this.command(identity, eventId, issueId, key, 'issue:resolve', 'resolved', IssueState.RESOLVED, dto.reason, { resolutionNote: dto.reason });
  }
  async verify(identity: Identity, eventId: string, issueId: string, dto: IssueNoteDto, key: string) {
    assertScope(identity, 'issue:verify', eventId);
    return this.command(identity, eventId, issueId, key, 'issue:verify', 'verified', IssueState.VERIFIED, dto.reason, {});
  }
  async close(identity: Identity, eventId: string, issueId: string, dto: IssueNoteDto, key: string) {
    assertScope(identity, 'issue:close', eventId);
    return this.command(identity, eventId, issueId, key, 'issue:close', 'closed', IssueState.CLOSED, dto.reason, {});
  }

  private async command(identity: Identity, eventId: string, issueId: string, key: string, capability: 'issue:triage' | 'issue:escalate' | 'issue:resolve' | 'issue:verify' | 'issue:close', action: string, state: IssueState, reason: string | undefined, patch: Record<string, string>) {
    const fingerprint = this.fingerprint(action, { actorId: identity.subject, eventId, issueId, reason, patch });
    const transaction = await this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${identity.tenantId + key}, 0))`;
      const replay = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (replay) return { response: this.replay(replay.fingerprint, fingerprint, replay.response), notification: null as { id: string; kind: string; recipientSubject: string } | null };
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`issue:${identity.tenantId}:${issueId}`}, 0))`;
      const issue = await tx.issue.findFirst({ where: { id: issueId, eventId } });
      if (!issue) throw new NotFoundException('Issue not found.');
      assertScope(identity, capability, eventId, issue.venueId, issue.locationId ?? undefined);
      if (!(issueTransitions[state] ?? []).includes(issue.state)) throw new ConflictException(`Cannot ${action} an issue in ${issue.state}. Refresh and review its current state.`);
      const updated = await tx.issue.update({ where: { id: issueId }, data: { ...patch, state } });
      await tx.issueAuditEvent.create({ data: { organizationId: identity.tenantId, issueId, actorId: identity.subject, action, reason, before: issue as unknown as Prisma.InputJsonValue, after: updated as unknown as Prisma.InputJsonValue } });
      const recipientSubject = action === 'assigned' ? updated.ownerId : action === 'resolved' ? issue.reporterId : null;
      let notification: { id: string; kind: string; recipientSubject: string } | null = null;
      if (recipientSubject && recipientSubject !== identity.subject) {
        const createdNotification = await tx.userNotification.create({ data: {
          organizationId: identity.tenantId,
          eventId,
          issueId,
          recipientSubject,
          kind: `issue.${action}`,
          title: action === 'assigned' ? 'Issue assigned to you' : 'Your issue was resolved',
          body: updated.title,
        } });
        notification = { id: createdNotification.id, kind: createdNotification.kind, recipientSubject };
      }
      const result = { issue: updated, replayed: false };
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: result as unknown as Prisma.InputJsonValue } });
      await tx.issueDomainEvent.create({ data: { organizationId: identity.tenantId, eventId, issueId, action, payload: updated as unknown as Prisma.InputJsonValue } });
      return { response: result, notification };
    });
    if (transaction.notification) {
      const pushIdentity: Identity = { ...identity, subject: transaction.notification.recipientSubject };
      void this.push.deliver(pushIdentity, transaction.notification).catch(() => {
        this.logger.warn('Push dispatch failed after the durable in-app notification was committed.');
      });
    }
    return transaction.response;
  }

  private fingerprint(action: string, body: unknown): string {
    return createHash('sha256').update(JSON.stringify({ action, body })).digest('hex');
  }

  private replay(existingFingerprint: string, incomingFingerprint: string, response: Prisma.JsonValue) {
    if (existingFingerprint !== incomingFingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.');
    return { ...(response as Record<string, unknown>), replayed: true };
  }
}

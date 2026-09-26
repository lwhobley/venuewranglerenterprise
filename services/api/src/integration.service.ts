import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OperationalTaskKind, Prisma, type OperationalTask } from '@prisma/client';
import { assertScope, type Identity } from './auth';
import { PrismaService } from './prisma.service';

interface IntegrationProvider {
  id: string;
  organizationSlug: string;
  tenantId: string;
  secret: string;
}

@Injectable()
export class IntegrationService {
  private readonly providers: IntegrationProvider[];

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    let values: unknown;
    try {
      values = JSON.parse(config.get<string>('INTEGRATION_PROVIDERS_JSON') ?? '[]');
    } catch {
      throw new Error('INTEGRATION_PROVIDERS_JSON must be valid JSON.');
    }
    if (!Array.isArray(values)) throw new Error('INTEGRATION_PROVIDERS_JSON must be an array.');
    const ids = new Set<string>();
    this.providers = values.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`Integration provider ${index} must be an object.`);
      const value = entry as Record<string, unknown>;
      const { id, organizationSlug, tenantId, secret } = value;
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)
        || typeof organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(organizationSlug)
        || typeof tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
        || typeof secret !== 'string' || secret.length < 32 || ids.has(id)) {
        throw new Error(`Integration provider ${index} has invalid fields or a duplicate id.`);
      }
      ids.add(id);
      return { id, organizationSlug, tenantId, secret };
    });
  }

  async ingest(providerId: string | undefined, timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined, body: unknown) {
    const provider = this.authenticate(providerId, timestamp, signature, rawBody);
    if (!rawBody || rawBody.length === 0 || rawBody.length > 65536) throw new BadRequestException('Integration event body must be between 1 and 65536 bytes.');
    const envelope = this.envelope(body);
    const identity: Identity = {
      subject: `integration:${provider.id}`,
      tenantId: provider.tenantId,
      organizationSlug: provider.organizationSlug,
      capabilities: [],
      venueIds: [],
      eventIds: [],
      locationIds: [],
      assignableUserIds: [],
    };
    const bodySha256 = createHmac('sha256', 'venue-wrangler-integration-event-fingerprint-v1').update(rawBody).digest('hex');
    try {
      const event = await this.prisma.withTenant(identity, async (tx) => {
        const venueEvent = await tx.event.findFirst({ where: { id: envelope.venueEventId, organizationId: provider.tenantId } });
        if (!venueEvent) throw new BadRequestException('venueEventId must identify an event in the configured tenant.');
        const recordedEvent = await tx.externalIntegrationEvent.create({
          data: {
            organizationId: provider.tenantId,
            eventId: venueEvent.id,
            source: provider.id,
            externalId: envelope.externalId,
            eventType: envelope.eventType,
            occurredAt: envelope.occurredAt,
            payload: envelope.payload as Prisma.InputJsonValue,
            bodySha256,
          },
        });
        const task = envelope.eventType === 'operations.task.upserted'
          ? await this.upsertOperationalTask(tx, identity, provider.id, venueEvent.id, venueEvent.venueId, envelope.payload)
          : null;
        return { event: recordedEvent, task };
      });
      return { ...event, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.withTenant(identity, (tx) => tx.externalIntegrationEvent.findFirst({ where: { organizationId: provider.tenantId, source: provider.id, externalId: envelope.externalId } }));
        if (existing?.bodySha256 === bodySha256) return { event: existing, replayed: true };
        throw new ConflictException('This source and externalId were already used for a different event payload.');
      }
      throw error;
    }
  }

  private async upsertOperationalTask(tx: Prisma.TransactionClient, identity: Identity, source: string, eventId: string, venueId: string, payload: Record<string, unknown>) {
    const snapshot = this.operationalTaskSnapshot(payload);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`task:${identity.tenantId}:${source}:${snapshot.externalTaskId}`}, 0))`;
    if (snapshot.locationId && !await tx.location.findFirst({ where: { id: snapshot.locationId, organizationId: identity.tenantId, venueId } })) {
      throw new BadRequestException('The task location must belong to the mapped venue event.');
    }
    const current = await tx.operationalTask.findFirst({ where: { organizationId: identity.tenantId, externalSource: source, externalTaskId: snapshot.externalTaskId } });
    if (current && current.eventId !== eventId) throw new ConflictException('An external task cannot be moved between Venue Wrangler events.');
    const data = {
      organizationId: identity.tenantId,
      venueId,
      eventId,
      locationId: snapshot.locationId,
      kind: snapshot.kind,
      title: snapshot.title,
      description: snapshot.description,
      dueAt: snapshot.dueAt,
      expectedQuantity: snapshot.expectedQuantity,
      unit: snapshot.unit,
      updatedBy: identity.subject,
    };
    let task: OperationalTask;
    if (current) {
      task = await tx.operationalTask.update({ where: { id: current.id }, data });
      await tx.operationalTaskAudit.create({ data: {
        organizationId: identity.tenantId,
        taskId: task.id,
        actorId: identity.subject,
        action: 'integration.updated',
        before: current as unknown as Prisma.InputJsonValue,
        after: task as unknown as Prisma.InputJsonValue,
      } });
    } else {
      task = await tx.operationalTask.create({ data: {
        ...data,
        state: 'OPEN',
        externalSource: source,
        externalTaskId: snapshot.externalTaskId,
        createdBy: identity.subject,
      } });
      await tx.operationalTaskAudit.create({ data: {
        organizationId: identity.tenantId,
        taskId: task.id,
        actorId: identity.subject,
        action: 'integration.created',
        after: task as unknown as Prisma.InputJsonValue,
      } });
    }
    return task;
  }

  private operationalTaskSnapshot(payload: Record<string, unknown>) {
    const { externalTaskId, kind, title, description, locationId, dueAt, expectedQuantity, unit } = payload;
    if (typeof externalTaskId !== 'string' || !externalTaskId.trim() || externalTaskId.trim().length > 240) throw new BadRequestException('Task upserts require an externalTaskId between 1 and 240 characters.');
    if (typeof kind !== 'string' || !Object.values(OperationalTaskKind).includes(kind as OperationalTaskKind)) throw new BadRequestException('Task upserts require a supported kind: PLAN, STAFFING, SERVICE, or STOCK.');
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160) throw new BadRequestException('Task upserts require a title between 2 and 160 characters.');
    if (description !== undefined && (typeof description !== 'string' || description.length > 4000)) throw new BadRequestException('description must be a string no longer than 4000 characters.');
    if (locationId !== undefined && (typeof locationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(locationId))) throw new BadRequestException('locationId must be a canonical Venue Wrangler UUID.');
    let parsedDueAt: Date | null = null;
    if (dueAt !== undefined) {
      if (typeof dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(dueAt) || !Number.isFinite(Date.parse(dueAt))) throw new BadRequestException('dueAt must be an ISO 8601 timestamp.');
      parsedDueAt = new Date(dueAt);
    }
    if (expectedQuantity !== undefined && (typeof expectedQuantity !== 'number' || !Number.isFinite(expectedQuantity) || expectedQuantity < 0 || expectedQuantity > 999999999)) throw new BadRequestException('expectedQuantity must be a non-negative finite number.');
    if (unit !== undefined && (typeof unit !== 'string' || unit.trim().length < 1 || unit.trim().length > 32)) throw new BadRequestException('unit must be between 1 and 32 characters.');
    return {
      externalTaskId: externalTaskId.trim(),
      kind: kind as OperationalTaskKind,
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      locationId: typeof locationId === 'string' ? locationId : null,
      dueAt: parsedDueAt,
      expectedQuantity: typeof expectedQuantity === 'number' ? expectedQuantity : null,
      unit: typeof unit === 'string' ? unit.trim() : null,
    };
  }

  async list(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.prisma.withTenant(identity, (tx) => tx.externalIntegrationEvent.findMany({
      where: {
        organizationId: identity.tenantId,
        eventId,
        ...(!identity.capabilities.includes('tenant:admin') ? { event: { venueId: { in: identity.venueIds } } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { receivedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        organizationId: true,
        eventId: true,
        source: true,
        externalId: true,
        eventType: true,
        occurredAt: true,
        receivedAt: true,
      },
    }));
  }

  private authenticate(providerId: string | undefined, timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined) {
    const provider = this.providers.find((candidate) => candidate.id === providerId);
    if (!provider || !timestamp || !signature || !rawBody || !/^\d{10}$/.test(timestamp) || !/^[a-f\d]{64}$/i.test(signature)) {
      throw new UnauthorizedException('A valid integration id, timestamp, and signature are required.');
    }
    const sentAt = Number(timestamp);
    if (!Number.isSafeInteger(sentAt) || Math.abs(Math.floor(Date.now() / 1000) - sentAt) > 300) throw new UnauthorizedException('Integration signature timestamp is outside the five-minute acceptance window.');
    const expected = createHmac('sha256', provider.secret).update(timestamp).update('.').update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) throw new UnauthorizedException('The integration signature is invalid.');
    return provider;
  }

  private envelope(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Integration event must be a JSON object.');
    const value = input as Record<string, unknown>;
    if (typeof value.venueEventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.venueEventId)) throw new BadRequestException('venueEventId must be a canonical Venue Wrangler event UUID.');
    if (typeof value.externalId !== 'string' || !value.externalId.trim() || value.externalId.trim().length > 240) throw new BadRequestException('externalId must be 1 to 240 characters.');
    if (typeof value.eventType !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value.eventType)) throw new BadRequestException('eventType must be a short event name.');
    if (typeof value.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.occurredAt) || !Number.isFinite(Date.parse(value.occurredAt))) throw new BadRequestException('occurredAt must be an ISO 8601 timestamp.');
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new BadRequestException('payload must be a JSON object.');
    if (Buffer.byteLength(JSON.stringify(value.payload), 'utf8') > 60000) throw new BadRequestException('payload must be at most 60000 bytes when normalized.');
    return { venueEventId: value.venueEventId, externalId: value.externalId.trim(), eventType: value.eventType, occurredAt: new Date(value.occurredAt), payload: value.payload as Record<string, unknown> };
  }
}

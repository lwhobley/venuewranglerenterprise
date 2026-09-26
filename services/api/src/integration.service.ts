import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { OperationalTaskKind, Prisma, type OperationalTask } from '@prisma/client';
import { assertScope, assertTenantAdmin, type Identity } from './auth';
import { CorrectIntegrationIdentifierDto, PutIntegrationIdentifierDto, SetIntegrationOwnershipDto } from './integration.dto';
import { SaveIntegrationTransformDto } from './integration.dto';
import { transformIntegrationRecord, validateIntegrationTransform } from './integration-transform';
import { PrismaService } from './prisma.service';

interface IntegrationProvider {
  id: string;
  organizationSlug: string;
  tenantId: string;
  secret: string;
  credentialVersion?: string;
  pollUrl?: string;
  pollMinIntervalSeconds: number;
}

export type IntegrationPageFetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

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
      const { id, organizationSlug, tenantId, secret, credentialVersion, pollUrl, pollMinIntervalSeconds } = value;
      const interval = pollMinIntervalSeconds === undefined ? 60 : pollMinIntervalSeconds;
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)
        || typeof organizationSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(organizationSlug)
        || typeof tenantId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
        || typeof secret !== 'string' || secret.length < 32 || ids.has(id)
        || (credentialVersion !== undefined && (typeof credentialVersion !== 'string' || credentialVersion.length > 100))
        || (pollUrl !== undefined && !this.isPollUrl(pollUrl))
        || typeof interval !== 'number' || !Number.isInteger(interval) || interval < 15 || interval > 3600) {
        throw new Error(`Integration provider ${index} has invalid fields or a duplicate id.`);
      }
      ids.add(id);
      return { id, organizationSlug, tenantId, secret, credentialVersion: credentialVersion as string | undefined, pollUrl: pollUrl as string | undefined, pollMinIntervalSeconds: interval };
    });
  }

  async sources(identity: Identity) {
    assertTenantAdmin(identity);
    const providers = this.providers.filter((provider) => provider.tenantId === identity.tenantId);
    return this.prisma.withTenant(identity, async (tx) => Promise.all(providers.map(async (provider) => {
      const [latest, recentCount, transform, checkpoint, openDeadLetters] = await Promise.all([
        tx.externalIntegrationEvent.findFirst({ where: { organizationId: identity.tenantId, source: provider.id }, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true, eventType: true } }),
        tx.externalIntegrationEvent.count({ where: { organizationId: identity.tenantId, source: provider.id, receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        tx.integrationTransformVersion.findFirst({ where: { organizationId: identity.tenantId, source: provider.id }, orderBy: { version: 'desc' }, select: { version: true } }),
        tx.integrationSourceCheckpoint.findUnique({ where: { organizationId_source: { organizationId: identity.tenantId, source: provider.id } } }),
        tx.integrationDeadLetter.count({ where: { organizationId: identity.tenantId, source: provider.id, state: 'OPEN' } }),
      ]);
      return { id: provider.id, organizationSlug: provider.organizationSlug, credentialConfigured: true, credentialVersion: provider.credentialVersion ?? null, lastReceivedAt: latest?.receivedAt ?? null, lastEventType: latest?.eventType ?? null, eventsLast24Hours: recentCount, transformVersion: transform?.version ?? null, pollConfigured: Boolean(provider.pollUrl), pollStatus: checkpoint?.lastStatus ?? 'NEVER', nextPollAt: checkpoint?.nextPollAt ?? null, openDeadLetters: openDeadLetters };
    })));
  }

  async preview(identity: Identity, input: unknown) {
    assertTenantAdmin(identity);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Preview requires a source and event object.');
    const { source, event } = input as Record<string, unknown>;
    const provider = this.providers.find((item) => item.id === source && item.tenantId === identity.tenantId);
    if (!provider) throw new BadRequestException('The source is not configured for this tenant.');
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new BadRequestException('Preview event must be a JSON object.');
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > 65536) throw new BadRequestException('Preview event must be at most 65536 bytes.');
    const envelope = this.envelope(event);
    return this.prisma.withTenant(identity, async (tx) => {
      await this.assertFieldOwner(tx, provider, envelope);
      const venueEvent = await this.resolveEvent(tx, provider, envelope);
      let resolvedLocationId: string | null = null;
      if (envelope.eventType === 'operations.task.upserted') {
        const snapshot = this.operationalTaskSnapshot(envelope.payload);
        resolvedLocationId = await this.resolveLocation(tx, identity, provider.id, venueEvent.venueId, snapshot.locationId, envelope.payload.externalLocationId);
      }
      return {
        accepted: true,
        source: provider.id,
        eventId: venueEvent.id,
        venueId: venueEvent.venueId,
        locationId: resolvedLocationId,
        eventType: envelope.eventType,
        writesPerformed: false,
      };
    });
  }

  async identifiers(identity: Identity) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, (tx) => tx.integrationIdentifier.findMany({
      where: { organizationId: identity.tenantId },
      orderBy: [{ source: 'asc' }, { kind: 'asc' }, { externalId: 'asc' }],
    }));
  }

  async putIdentifier(identity: Identity, dto: PutIntegrationIdentifierDto) {
    assertTenantAdmin(identity);
    if (!this.providers.some((provider) => provider.id === dto.source && provider.tenantId === identity.tenantId)) {
      throw new BadRequestException('The source is not configured for this tenant.');
    }
    return this.prisma.withTenant(identity, async (tx) => {
      const where = { id: dto.internalId, organizationId: identity.tenantId };
      const target = dto.kind === 'VENUE'
        ? await tx.venue.findFirst({ where, select: { id: true } })
        : dto.kind === 'EVENT'
          ? await tx.event.findFirst({ where, select: { id: true } })
          : await tx.location.findFirst({ where, select: { id: true } });
      if (!target) throw new BadRequestException('The identifier target does not exist in this tenant.');
      const unique = { organizationId_source_kind_externalId: {
        organizationId: identity.tenantId, source: dto.source, kind: dto.kind, externalId: dto.externalId,
      } };
      const mapping = await tx.integrationIdentifier.upsert({
        where: unique,
        create: {
          organizationId: identity.tenantId,
          source: dto.source, kind: dto.kind, externalId: dto.externalId,
          internalId: dto.internalId, createdBy: identity.subject, updatedBy: identity.subject,
        },
        update: {},
      });
      if (mapping.internalId !== dto.internalId) {
        throw new ConflictException('This external identifier already maps to another target. Resolve the mapping before changing it.');
      }
      return mapping;
    });
  }

  async identifierImpact(identity: Identity, mappingId: string) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const mapping = await tx.integrationIdentifier.findFirst({ where: { id: mappingId, organizationId: identity.tenantId } });
      if (!mapping) throw new BadRequestException('Identifier mapping not found.');
      return this.mappingImpact(tx, identity, mapping);
    });
  }

  async correctIdentifier(identity: Identity, mappingId: string, dto: CorrectIntegrationIdentifierDto) {
    assertTenantAdmin(identity);
    if (dto.expectedInternalId === dto.newInternalId) throw new BadRequestException('Choose a different target for this correction.');
    if (dto.reason.trim().length < 3) throw new BadRequestException('A correction reason is required.');
    return this.prisma.withTenant(identity, async (tx) => {
      const prior = await tx.integrationIdentifier.findFirst({ where: { id: mappingId, organizationId: identity.tenantId } });
      if (!prior) throw new BadRequestException('Identifier mapping not found.');
      await this.lockIdentifier(tx, identity.tenantId, prior.source, prior.kind, prior.externalId);
      await tx.$queryRaw`SELECT id FROM integration_identifiers WHERE id = ${mappingId}::uuid AND organization_id = ${identity.tenantId}::uuid FOR UPDATE`;
      const mapping = await tx.integrationIdentifier.findFirst({ where: { id: mappingId, organizationId: identity.tenantId } });
      if (!mapping || mapping.internalId !== dto.expectedInternalId) throw new ConflictException('The identifier changed since the preview. Refresh its impact before correcting it.');
      const targetWhere = { id: dto.newInternalId, organizationId: identity.tenantId };
      const target = mapping.kind === 'VENUE' ? await tx.venue.findFirst({ where: targetWhere, select: { id: true } })
        : mapping.kind === 'EVENT' ? await tx.event.findFirst({ where: targetWhere, select: { id: true } })
        : await tx.location.findFirst({ where: targetWhere, select: { id: true } });
      if (!target) throw new BadRequestException('The new target does not exist in this tenant.');
      const impact = await this.mappingImpact(tx, identity, mapping);
      if (impact.observedCount !== dto.observedCount) throw new ConflictException('Integration activity changed since the preview. Refresh its impact before correcting it.');
      const updated = await tx.integrationIdentifier.update({ where: { id: mappingId }, data: { internalId: dto.newInternalId, updatedBy: identity.subject } });
      await tx.integrationIdentifierAudit.create({ data: { organizationId: identity.tenantId, mappingId, actorId: identity.subject, action: 'corrected', beforeTargetId: mapping.internalId, afterTargetId: dto.newInternalId, reason: dto.reason.trim(), observedCount: impact.observedCount } });
      return { mapping: updated, previousTargetId: mapping.internalId, historicalRecordsUnchanged: true, observedCount: impact.observedCount };
    });
  }

  private async mappingImpact(tx: Prisma.TransactionClient, identity: Identity, mapping: { id: string; source: string; kind: string; externalId: string; internalId: string }) {
    const eventCount = mapping.kind === 'EVENT'
      ? await tx.externalIntegrationEvent.count({ where: { organizationId: identity.tenantId, source: mapping.source, eventId: mapping.internalId } })
      : mapping.kind === 'VENUE'
        ? await tx.externalIntegrationEvent.count({ where: { organizationId: identity.tenantId, source: mapping.source, event: { venueId: mapping.internalId } } })
        : 0;
    const taskCount = mapping.kind === 'LOCATION'
      ? await tx.operationalTask.count({ where: { organizationId: identity.tenantId, externalSource: mapping.source, locationId: mapping.internalId } })
      : await tx.operationalTask.count({ where: { organizationId: identity.tenantId, externalSource: mapping.source, ...(mapping.kind === 'EVENT' ? { eventId: mapping.internalId } : { venueId: mapping.internalId }) } });
    return { mappingId: mapping.id, source: mapping.source, kind: mapping.kind, externalId: mapping.externalId, currentInternalId: mapping.internalId, eventCount, taskCount, observedCount: eventCount + taskCount, historicalRecordsUnchanged: true };
  }

  private async lockIdentifier(tx: Prisma.TransactionClient, tenantId: string, source: string, kind: string, externalId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-identifier:${tenantId}:${source}:${kind}:${externalId}`}, 0))`;
  }

  async transforms(identity: Identity) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, (tx) => tx.integrationTransformVersion.findMany({
      where: { organizationId: identity.tenantId }, orderBy: [{ source: 'asc' }, { version: 'desc' }], take: 100,
    }));
  }

  async saveTransform(identity: Identity, dto: SaveIntegrationTransformDto) {
    assertTenantAdmin(identity);
    if (!this.providers.some((provider) => provider.id === dto.source && provider.tenantId === identity.tenantId)) throw new BadRequestException('The source is not configured for this tenant.');
    const definition = validateIntegrationTransform(dto.definition);
    return this.prisma.withTenant(identity, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-transform:${identity.tenantId}:${dto.source}`}, 0))`;
      const latest = await tx.integrationTransformVersion.findFirst({ where: { organizationId: identity.tenantId, source: dto.source }, orderBy: { version: 'desc' } });
      if (latest && JSON.stringify(latest.definition) === JSON.stringify(definition)) return latest;
      return tx.integrationTransformVersion.create({ data: { organizationId: identity.tenantId, source: dto.source, version: (latest?.version ?? 0) + 1, definition: definition as unknown as Prisma.InputJsonValue, createdBy: identity.subject } });
    });
  }

  async previewRaw(identity: Identity, input: unknown) {
    assertTenantAdmin(identity);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Raw preview requires a source and record.');
    const { source, record, definition } = input as Record<string, unknown>;
    if (typeof source !== 'string' || !this.providers.some((provider) => provider.id === source && provider.tenantId === identity.tenantId)) throw new BadRequestException('The source is not configured for this tenant.');
    if (Buffer.byteLength(JSON.stringify(record ?? null), 'utf8') > 65536) throw new BadRequestException('Raw record exceeds 65536 bytes.');
    const saved = definition === undefined ? await this.prisma.withTenant(identity, (tx) => tx.integrationTransformVersion.findFirst({ where: { organizationId: identity.tenantId, source }, orderBy: { version: 'desc' } })) : null;
    if (!saved && definition === undefined) throw new BadRequestException('Configure a transform for this source before previewing raw records.');
    const normalized = transformIntegrationRecord(validateIntegrationTransform(definition ?? saved!.definition), record);
    return { normalized, resolution: await this.preview(identity, { source, event: normalized }), transformVersion: saved?.version ?? null };
  }

  async ingestRaw(providerId: string | undefined, timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined, body: unknown) {
    const provider = this.authenticate(providerId, timestamp, signature, rawBody);
    if (!rawBody || rawBody.length === 0 || rawBody.length > 65536) throw new BadRequestException('Integration event body must be between 1 and 65536 bytes.');
    const identity = this.integrationIdentity(provider);
    const saved = await this.prisma.withTenant(identity, (tx) => tx.integrationTransformVersion.findFirst({ where: { organizationId: provider.tenantId, source: provider.id }, orderBy: { version: 'desc' } }));
    if (!saved) throw new BadRequestException('No transform is configured for this source.');
    const normalized = transformIntegrationRecord(validateIntegrationTransform(saved.definition), body);
    return this.record(provider, rawBody, this.envelope(normalized));
  }

  async ingest(providerId: string | undefined, timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined, body: unknown) {
    const provider = this.authenticate(providerId, timestamp, signature, rawBody);
    if (!rawBody || rawBody.length === 0 || rawBody.length > 65536) throw new BadRequestException('Integration event body must be between 1 and 65536 bytes.');
    try {
      const envelope = this.envelope(body);
      return await this.record(provider, rawBody, envelope);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) await this.rememberFailure(provider, body, error);
      throw error;
    }
  }

  async deadLetters(identity: Identity, source: string) {
    assertTenantAdmin(identity);
    this.requireTenantSource(identity, source);
    return this.prisma.withTenant(identity, (tx) => tx.integrationDeadLetter.findMany({
      where: { organizationId: identity.tenantId, source, state: { in: ['OPEN', 'EXHAUSTED'] } },
      orderBy: { nextAttemptAt: 'asc' },
      select: { id: true, source: true, externalId: true, error: true, attempts: true, state: true, nextAttemptAt: true, createdAt: true },
    }));
  }

  async replayDeadLetter(identity: Identity, letterId: string) {
    assertTenantAdmin(identity);
    const letter = await this.prisma.withTenant(identity, (tx) => tx.integrationDeadLetter.findFirst({ where: { id: letterId, organizationId: identity.tenantId } }));
    if (!letter || letter.state === 'REPLAYED') throw new BadRequestException('No open dead letter exists for this tenant.');
    const provider = this.requireTenantSource(identity, letter.source);
    const raw = Buffer.from(JSON.stringify(letter.payload));
    try {
      let envelope: ReturnType<IntegrationService['envelope']>;
      try {
        envelope = this.envelope(letter.payload);
      } catch (originalError) {
        const transform = await this.prisma.withTenant(identity, (tx) => tx.integrationTransformVersion.findFirst({ where: { organizationId: identity.tenantId, source: letter.source }, orderBy: { version: 'desc' } }));
        if (!transform) throw originalError;
        envelope = this.envelope(transformIntegrationRecord(validateIntegrationTransform(transform.definition), letter.payload));
      }
      const result = await this.record(provider, raw, envelope);
      await this.prisma.withTenant(identity, (tx) => tx.integrationDeadLetter.update({ where: { id: letter.id }, data: { state: 'REPLAYED', error: 'Replayed.' } }));
      return { replayed: true, eventId: result.event.eventId };
    } catch (error) {
      await this.rememberFailure(provider, letter.payload, error);
      throw error;
    }
  }

  async poll(identity: Identity, source: string, fetcher: IntegrationPageFetcher = (url, init) => fetch(url, init)) {
    assertTenantAdmin(identity);
    const provider = this.requireTenantSource(identity, source);
    if (!provider.pollUrl) throw new BadRequestException('This source has no polling endpoint configured.');
    const now = new Date();
    const checkpoint = await this.prisma.withTenant(identity, (tx) => tx.integrationSourceCheckpoint.findUnique({ where: { organizationId_source: { organizationId: identity.tenantId, source } } }));
    if (checkpoint?.nextPollAt && checkpoint.nextPollAt > now) throw new ConflictException('This source is inside its polling interval.');
    const savedTransform = await this.prisma.withTenant(identity, (tx) => tx.integrationTransformVersion.findFirst({ where: { organizationId: identity.tenantId, source }, orderBy: { version: 'desc' } }));
    const transform = savedTransform ? validateIntegrationTransform(savedTransform.definition) : null;
    let cursor = checkpoint?.cursor ?? '';
    let pages = 0;
    let accepted = 0;
    try {
      while (pages < 5) {
        const url = new URL(provider.pollUrl);
        if (cursor) url.searchParams.set('cursor', cursor);
        url.searchParams.set('limit', '50');
        const response = await fetcher(url.toString(), { headers: { authorization: `Bearer ${provider.secret}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (response.status === 429) {
          await this.saveCheckpoint(identity, source, cursor, 'RATE_LIMITED', 'The source asked us to wait.', (checkpoint?.consecutiveFailures ?? 0) + 1);
          throw new ConflictException('The source rate limit deferred this poll.');
        }
        if (!response.ok) throw new BadRequestException('The source page could not be read.');
        const page = await response.json();
        if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray((page as { items?: unknown }).items)) throw new BadRequestException('A poll page must contain an items array.');
        const items = (page as { items: unknown[]; nextCursor?: unknown }).items;
        if (items.length > 50) throw new BadRequestException('A poll page cannot contain more than 50 items.');
        for (const item of items) {
          const raw = Buffer.from(JSON.stringify(item));
          if (raw.length > 65536) throw new BadRequestException('A polled item exceeds 65536 bytes.');
          let normalized: unknown = item;
          try {
            if (transform) normalized = transformIntegrationRecord(transform, item);
            await this.record(provider, raw, this.envelope(normalized));
            accepted += 1;
          } catch (error) {
            await this.rememberFailure(provider, normalized, error);
            throw error;
          }
        }
        pages += 1;
        const nextCursor = (page as { nextCursor?: unknown }).nextCursor;
        if (typeof nextCursor !== 'string' || nextCursor.length === 0 || nextCursor.length > 500) {
          cursor = typeof nextCursor === 'string' ? nextCursor : cursor;
          break;
        }
        cursor = nextCursor;
      }
      await this.saveCheckpoint(identity, source, cursor, 'OK', '', 0);
      return { source, accepted, pages, cursor, complete: pages < 5 };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.saveCheckpoint(identity, source, cursor, 'FAILED', this.safeError(error), (checkpoint?.consecutiveFailures ?? 0) + 1);
      throw error;
    }
  }

  async ownership(identity: Identity) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, (tx) => tx.integrationFieldOwnership.findMany({ where: { organizationId: identity.tenantId }, orderBy: { domain: 'asc' } }));
  }

  async setOwnership(identity: Identity, dto: SetIntegrationOwnershipDto) {
    assertTenantAdmin(identity);
    this.requireTenantSource(identity, dto.source);
    return this.prisma.withTenant(identity, async (tx) => {
      const current = await tx.integrationFieldOwnership.findUnique({ where: { organizationId_domain: { organizationId: identity.tenantId, domain: dto.domain } } });
      if (current?.source === dto.source) return current;
      const saved = current
        ? await tx.integrationFieldOwnership.update({ where: { id: current.id }, data: { source: dto.source, updatedBy: identity.subject } })
        : await tx.integrationFieldOwnership.create({ data: { organizationId: identity.tenantId, domain: dto.domain, source: dto.source, updatedBy: identity.subject } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: current ? 'updated' : 'created', resourceType: 'integration_ownership', resourceId: saved.id, changedFields: ['domain', 'source'] } });
      return saved;
    });
  }

  private async assertFieldOwner(tx: Prisma.TransactionClient, provider: IntegrationProvider, envelope: ReturnType<IntegrationService['envelope']>) {
    const domain = this.ownedDomain(envelope);
    if (!domain) return;
    const owner = await tx.integrationFieldOwnership.findUnique({ where: { organizationId_domain: { organizationId: provider.tenantId, domain } } });
    if (owner && owner.source !== provider.id) throw new ConflictException(`${provider.id} cannot write ${domain} fields. ${owner.source} owns that domain.`);
  }

  private ownedDomain(envelope: ReturnType<IntegrationService['envelope']>) {
    if (envelope.eventType.startsWith('ticketing.')) return 'TICKETING';
    if (envelope.eventType !== 'operations.task.upserted') return null;
    const kind = envelope.payload.kind;
    if (kind === 'STAFFING') return 'LABOR';
    if (kind === 'STOCK') return 'INVENTORY';
    if (kind === 'SERVICE') return 'POS';
    if (kind === 'PLAN') return 'EVENT';
    return null;
  }

  private integrationIdentity(provider: IntegrationProvider): Identity {
    return {
      subject: `integration:${provider.id}`,
      tenantId: provider.tenantId,
      organizationSlug: provider.organizationSlug,
      capabilities: [],
      venueIds: [],
      eventIds: [],
      locationIds: [],
      assignableUserIds: [],
    };
  }

  private async record(provider: IntegrationProvider, rawBody: Buffer, envelope: ReturnType<IntegrationService['envelope']>) {
    const identity = this.integrationIdentity(provider);
    const bodySha256 = createHmac('sha256', 'venue-wrangler-integration-event-fingerprint-v1').update(rawBody).digest('hex');
    try {
      const event = await this.prisma.withTenant(identity, async (tx) => {
      await this.assertFieldOwner(tx, provider, envelope);
      const venueEvent = await this.resolveEvent(tx, provider, envelope);
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

  private async resolveEvent(tx: Prisma.TransactionClient, provider: IntegrationProvider, envelope: ReturnType<IntegrationService['envelope']>) {
    if (envelope.externalEventId) await this.lockIdentifier(tx, provider.tenantId, provider.id, 'EVENT', envelope.externalEventId);
    const mappedEvent = envelope.externalEventId ? await tx.integrationIdentifier.findUnique({
      where: { organizationId_source_kind_externalId: { organizationId: provider.tenantId, source: provider.id, kind: 'EVENT', externalId: envelope.externalEventId } },
    }) : null;
    if (envelope.externalEventId && !mappedEvent) throw new BadRequestException('externalEventId has no configured mapping for this source.');
    const resolvedEventId = mappedEvent?.internalId ?? envelope.venueEventId;
    const venueEvent = await tx.event.findFirst({ where: { id: resolvedEventId, organizationId: provider.tenantId } });
    if (!venueEvent) throw new BadRequestException('The resolved event does not exist in the configured tenant.');
    if (envelope.venueEventId && mappedEvent && envelope.venueEventId !== mappedEvent.internalId) throw new ConflictException('Event identifiers resolve to different events.');
    if (envelope.externalVenueId) {
      await this.lockIdentifier(tx, provider.tenantId, provider.id, 'VENUE', envelope.externalVenueId);
      const mappedVenue = await tx.integrationIdentifier.findUnique({
        where: { organizationId_source_kind_externalId: { organizationId: provider.tenantId, source: provider.id, kind: 'VENUE', externalId: envelope.externalVenueId } },
      });
      if (!mappedVenue || mappedVenue.internalId !== venueEvent.venueId) throw new BadRequestException('externalVenueId does not map to the resolved event venue.');
    }
    return venueEvent;
  }

  private async resolveLocation(tx: Prisma.TransactionClient, identity: Identity, source: string, venueId: string, locationId: string | null, externalLocationId: unknown) {
    if (externalLocationId !== undefined && (typeof externalLocationId !== 'string' || externalLocationId.length < 1 || externalLocationId.length > 240)) {
      throw new BadRequestException('externalLocationId must be 1 to 240 characters.');
    }
    if (typeof externalLocationId === 'string') {
      await this.lockIdentifier(tx, identity.tenantId, source, 'LOCATION', externalLocationId);
      const mapping = await tx.integrationIdentifier.findUnique({
        where: { organizationId_source_kind_externalId: { organizationId: identity.tenantId, source, kind: 'LOCATION', externalId: externalLocationId } },
      });
      if (!mapping) throw new BadRequestException('externalLocationId has no configured mapping for this source.');
      if (locationId && locationId !== mapping.internalId) throw new ConflictException('Location identifiers resolve to different locations.');
      locationId = mapping.internalId;
    }
    if (locationId && !await tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId, venueId } })) {
      throw new BadRequestException('The task location must belong to the mapped venue event.');
    }
    return locationId;
  }

  private async upsertOperationalTask(tx: Prisma.TransactionClient, identity: Identity, source: string, eventId: string, venueId: string, payload: Record<string, unknown>) {
    const snapshot = this.operationalTaskSnapshot(payload);
    snapshot.locationId = await this.resolveLocation(tx, identity, source, venueId, snapshot.locationId, payload.externalLocationId);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`task:${identity.tenantId}:${source}:${snapshot.externalTaskId}`}, 0))`;
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

  private isPollUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > 500) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  private requireTenantSource(identity: Identity, source: string) {
    const provider = this.providers.find((item) => item.id === source && item.tenantId === identity.tenantId);
    if (!provider) throw new BadRequestException('The source is not configured for this tenant.');
    return provider;
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Integration item failed.';
    return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500);
  }

  private async rememberFailure(provider: IntegrationProvider, body: unknown, error: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const value = body as Record<string, unknown>;
    const externalId = typeof value.externalId === 'string' && value.externalId.trim() ? value.externalId.trim().slice(0, 240) : 'unidentified-item';
    const identity = this.integrationIdentity(provider);
    await this.prisma.withTenant(identity, async (tx) => {
      const current = await tx.integrationDeadLetter.findUnique({ where: { organizationId_source_externalId: { organizationId: provider.tenantId, source: provider.id, externalId } }, select: { attempts: true } });
      const attempts = Math.min(8, (current?.attempts ?? 0) + 1);
      const delay = Math.min(3600, 30 * 2 ** Math.min(attempts, 6)) * 1000;
      const data = { payload: value as Prisma.InputJsonValue, error: this.safeError(error), attempts, state: attempts >= 8 ? 'EXHAUSTED' : 'OPEN', nextAttemptAt: new Date(Date.now() + delay) };
      if (current) await tx.integrationDeadLetter.update({ where: { organizationId_source_externalId: { organizationId: provider.tenantId, source: provider.id, externalId } }, data });
      else await tx.integrationDeadLetter.create({ data: { organizationId: provider.tenantId, source: provider.id, externalId, ...data } });
    }).catch(() => undefined);
  }

  private saveCheckpoint(identity: Identity, source: string, cursor: string, status: string, error: string, failures: number) {
    const wait = Math.min(3600, 60 * 2 ** Math.min(failures, 6)) * 1000;
    return this.prisma.withTenant(identity, (tx) => tx.integrationSourceCheckpoint.upsert({
      where: { organizationId_source: { organizationId: identity.tenantId, source } },
      create: { organizationId: identity.tenantId, source, cursor, lastStatus: status, lastError: error.slice(0, 500), consecutiveFailures: failures, lastPolledAt: new Date(), nextPollAt: new Date(Date.now() + wait) },
      update: { cursor, lastStatus: status, lastError: error.slice(0, 500), consecutiveFailures: failures, lastPolledAt: new Date(), nextPollAt: new Date(Date.now() + wait) },
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
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (value.venueEventId !== undefined && (typeof value.venueEventId !== 'string' || !uuid.test(value.venueEventId))) throw new BadRequestException('venueEventId must be a canonical Venue Wrangler event UUID.');
    if (typeof value.externalEventId !== 'string' && value.venueEventId === undefined) throw new BadRequestException('venueEventId or externalEventId is required.');
    for (const field of ['externalEventId', 'externalVenueId']) {
      const identifier = value[field];
      if (identifier !== undefined && (typeof identifier !== 'string' || identifier.length < 1 || identifier.length > 240)) throw new BadRequestException(`${field} must be 1 to 240 characters.`);
    }
    if (typeof value.externalId !== 'string' || !value.externalId.trim() || value.externalId.trim().length > 240) throw new BadRequestException('externalId must be 1 to 240 characters.');
    if (typeof value.eventType !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value.eventType)) throw new BadRequestException('eventType must be a short event name.');
    if (typeof value.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.occurredAt) || !Number.isFinite(Date.parse(value.occurredAt))) throw new BadRequestException('occurredAt must be an ISO 8601 timestamp.');
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new BadRequestException('payload must be a JSON object.');
    if (Buffer.byteLength(JSON.stringify(value.payload), 'utf8') > 60000) throw new BadRequestException('payload must be at most 60000 bytes when normalized.');
    return { venueEventId: value.venueEventId as string | undefined, externalEventId: value.externalEventId as string | undefined, externalVenueId: value.externalVenueId as string | undefined, externalId: value.externalId.trim(), eventType: value.eventType, occurredAt: new Date(value.occurredAt), payload: value.payload as Record<string, unknown> };
  }
}

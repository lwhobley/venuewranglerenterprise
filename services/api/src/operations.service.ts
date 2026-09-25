import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, assertTenantAdmin, Identity } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateOperationalTaskDto, UpsertPersonDto } from './operations.dto';
import { PrismaService } from './prisma.service';
import { GrantPersonQualificationDto } from './qualification.dto';
import { UpdateStaffingPolicyDto } from './staffing-policy.dto';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(identity: Identity, claims: { email?: string; name?: string }) {
    return this.prisma.withTenant(identity, async (tx) => {
      const slug = identity.organizationSlug;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`org-bootstrap:${identity.tenantId}`}, 0))`;
      const previousOrg = await tx.organization.findUnique({ where: { id: identity.tenantId } });
      const org = await tx.organization.upsert({
        where: { id: identity.tenantId },
        create: { id: identity.tenantId, name: slug ? this.title(slug) : 'Venue organization', slug },
        update: slug ? { slug } : {},
      });
      const changedFields = previousOrg
        ? (previousOrg.slug !== org.slug ? ['slug'] : [])
        : ['name', ...(org.slug ? ['slug'] : [])];
      if (changedFields.length > 0) {
        await tx.tenantSetupAuditEvent.create({ data: {
          organizationId: identity.tenantId,
          actorId: identity.subject,
          action: previousOrg ? 'updated' : 'created',
          resourceType: 'organization',
          resourceId: org.id,
          changedFields,
        } });
      }
      const email = claims.email?.trim().toLowerCase();
      if (email && email.length <= 320) {
        await tx.person.upsert({
          where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: identity.subject } },
          create: { organizationId: identity.tenantId, externalSubject: identity.subject, email, displayName: claims.name?.trim().slice(0, 160) || email },
          update: { email, displayName: claims.name?.trim().slice(0, 160) || email, active: true },
        });
      }
      const admin = identity.capabilities.includes('tenant:admin');
      const venues = await tx.venue.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const events = await tx.event.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.eventIds }, venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { startsAt: 'asc' } });
      const locations = await tx.location.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.locationIds }, venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const people = await tx.person.findMany({ where: { organizationId: identity.tenantId, active: true, ...(!admin ? { externalSubject: { in: identity.assignableUserIds } } : {}) }, include: { qualifications: { where: { revokedAt: null }, select: { id: true, code: true, name: true, expiresAt: true, revokedAt: true, ...(admin ? { evidenceStatus: true, evidenceFileName: true, evidenceContentType: true, evidenceSizeBytes: true, evidenceUploadedAt: true, evidenceReviewedAt: true, evidenceReviewReason: true } : {}) }, orderBy: [{ code: 'asc' }] } }, orderBy: { displayName: 'asc' } });
      return { organization: { id: org.id, slug: org.slug, name: org.name }, identity: { subject: identity.subject, capabilities: identity.capabilities, assignableUserIds: identity.assignableUserIds }, venues, events, locations, people };
    });
  }

  async createVenue(identity: Identity, dto: CreateVenueDto, key: string) {
    assertTenantAdmin(identity);
    const input = { name: dto.name.trim() };
    return this.command(identity, key, 'venue.create', input, async (tx) => {
      const venue = await tx.venue.create({ data: { organizationId: identity.tenantId, ...input } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'created',
        resourceType: 'venue',
        resourceId: venue.id,
        changedFields: ['name'],
      } });
      return venue;
    });
  }

  async createLocation(identity: Identity, dto: CreateLocationDto, key: string) {
    assertTenantAdmin(identity);
    const input = { venueId: dto.venueId, name: dto.name.trim() };
    return this.command(identity, key, 'location.create', input, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: dto.venueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const location = await tx.location.create({ data: { organizationId: identity.tenantId, venueId: venue.id, name: dto.name.trim() } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'created',
        resourceType: 'location',
        resourceId: location.id,
        changedFields: ['name', 'venue_id'],
      } });
      return location;
    });
  }

  async createEvent(identity: Identity, dto: CreateEventDto, key: string) {
    assertTenantAdmin(identity);
    const input = { venueId: dto.venueId, name: dto.name.trim(), startsAt: new Date(dto.startsAt).toISOString() };
    return this.command(identity, key, 'event.create', input, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: dto.venueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const event = await tx.event.create({ data: { organizationId: identity.tenantId, venueId: venue.id, name: dto.name.trim(), startsAt: new Date(input.startsAt) } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'created',
        resourceType: 'event',
        resourceId: event.id,
        eventId: event.id,
        changedFields: ['name', 'starts_at', 'venue_id'],
      } });
      return event;
    });
  }

  async upsertPerson(identity: Identity, dto: UpsertPersonDto, key: string) {
    assertTenantAdmin(identity);
    const input = { externalSubject: dto.externalSubject, email: dto.email.trim().toLowerCase(), displayName: dto.displayName.trim() };
    return this.command(identity, key, 'person.upsert', input, (tx) => tx.person.upsert({
      where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: dto.externalSubject } },
      create: { organizationId: identity.tenantId, ...input },
      update: { email: input.email, displayName: input.displayName, active: true },
    }));
  }

  async personQualifications(identity: Identity, personId: string) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const person = await tx.person.findFirst({ where: { id: personId, organizationId: identity.tenantId } });
      if (!person) throw new NotFoundException('Person not found in this organization.');
      return tx.personQualification.findMany({ where: { personId, organizationId: identity.tenantId }, select: { id: true, code: true, name: true, expiresAt: true, revokedAt: true, evidenceStatus: true, evidenceFileName: true, evidenceContentType: true, evidenceSizeBytes: true, evidenceUploadedAt: true, evidenceReviewedBy: true, evidenceReviewedAt: true, evidenceReviewReason: true }, orderBy: [{ code: 'asc' }] });
    });
  }

  async grantPersonQualification(identity: Identity, personId: string, dto: GrantPersonQualificationDto, key: string) {
    assertTenantAdmin(identity);
    const input = { personId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), expiresAt: dto.expiresAt ? new Date(`${dto.expiresAt.slice(0, 10)}T00:00:00.000Z`).toISOString() : null };
    return this.command(identity, key, 'person-qualification.grant', input, async (tx) => {
      const person = await tx.person.findFirst({ where: { id: personId, organizationId: identity.tenantId, active: true }, select: { id: true, externalSubject: true } });
      if (!person) throw new NotFoundException('An active person in this organization is required.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${identity.tenantId}:${person.externalSubject}`}, 0))`;
      const existing = await tx.personQualification.findUnique({ where: { organizationId_personId_code: { organizationId: identity.tenantId, personId, code: input.code } } });
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      const qualification = existing
        ? await tx.personQualification.update({ where: { id: existing.id }, data: { name: input.name, expiresAt, revokedAt: null } })
        : await tx.personQualification.create({ data: { organizationId: identity.tenantId, personId, code: input.code, name: input.name, expiresAt, createdBy: identity.subject } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: existing ? 'updated' : 'created', resourceType: 'qualification', resourceId: qualification.id, changedFields: ['qualification_code', 'qualification_name', 'expires_at', 'revoked_at'] } });
      return qualification;
    });
  }

  async revokePersonQualification(identity: Identity, qualificationId: string, key: string) {
    assertTenantAdmin(identity);
    return this.command(identity, key, 'person-qualification.revoke', { qualificationId }, async (tx) => {
      const current = await tx.personQualification.findFirst({ where: { id: qualificationId, organizationId: identity.tenantId, revokedAt: null }, include: { person: { select: { externalSubject: true } } } });
      if (!current) throw new NotFoundException('Active qualification not found in this organization.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${identity.tenantId}:${current.person.externalSubject}`}, 0))`;
      const revoked = await tx.personQualification.update({ where: { id: qualificationId }, data: { revokedAt: new Date() } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'qualification', resourceId: revoked.id, changedFields: ['revoked_at'] } });
      return revoked;
    });
  }

  async staffingPolicy(identity: Identity) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: identity.tenantId }, select: { minimumRestMinutes: true } });
      if (!organization) throw new NotFoundException('Organization setup is required before configuring staffing policy.');
      return { minimumRestMinutes: organization.minimumRestMinutes };
    });
  }

  async updateStaffingPolicy(identity: Identity, dto: UpdateStaffingPolicyDto, key: string) {
    assertTenantAdmin(identity);
    const input = { minimumRestMinutes: dto.minimumRestMinutes };
    return this.command(identity, key, 'staffing-policy.update', input, async (tx) => {
      const [organization] = await tx.$queryRaw<Array<{ id: string; minimum_rest_minutes: number | null }>>`
        SELECT id, minimum_rest_minutes FROM organizations WHERE id = ${identity.tenantId}::uuid FOR UPDATE
      `;
      if (!organization) throw new NotFoundException('Organization setup is required before configuring staffing policy.');
      const changed = organization.minimum_rest_minutes !== input.minimumRestMinutes;
      if (!changed) return { minimumRestMinutes: organization.minimum_rest_minutes };
      if (input.minimumRestMinutes > 0) {
        const [conflict] = await tx.$queryRaw<Array<{ shift_id: string }>>`
          SELECT earlier.id AS shift_id
          FROM staff_shifts earlier
          JOIN staff_shifts later
            ON later.organization_id = earlier.organization_id
           AND later.assigned_subject = earlier.assigned_subject
           AND (later.starts_at > earlier.starts_at OR (later.starts_at = earlier.starts_at AND later.id > earlier.id))
           AND later.state = 'PUBLISHED'
          WHERE earlier.organization_id = ${identity.tenantId}::uuid
            AND earlier.assigned_subject IS NOT NULL
            AND earlier.state = 'PUBLISHED'
            AND later.starts_at > now()
            AND earlier.ends_at + (${input.minimumRestMinutes} * interval '1 minute') > later.starts_at
          LIMIT 1
        `;
        if (conflict) throw new ConflictException('The new rest rule conflicts with an already published upcoming schedule. Resolve those shifts before raising the minimum rest period.');
      }
      const updated = await tx.organization.update({ where: { id: identity.tenantId }, data: { minimumRestMinutes: input.minimumRestMinutes }, select: { id: true, minimumRestMinutes: true } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'staffing_policy', resourceId: updated.id, changedFields: ['minimum_rest_minutes'] } });
      return { minimumRestMinutes: updated.minimumRestMinutes };
    });
  }

  async listTasks(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.prisma.withTenant(identity, (tx) => tx.operationalTask.findMany({
      where: {
        eventId,
        organizationId: identity.tenantId,
        ...(!identity.capabilities.includes('tenant:admin') ? {
          venueId: { in: identity.venueIds },
          OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }],
        } : {}),
      },
      orderBy: [{ state: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    }));
  }

  async createTask(identity: Identity, eventId: string, dto: CreateOperationalTaskDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    const input = { eventId, ...dto, title: dto.title.trim(), description: dto.description?.trim() ?? '' };
    return this.command(identity, key, 'task.create', input, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in the selected venue.');
      if (dto.ownerId && !identity.assignableUserIds.includes(dto.ownerId)) throw new NotFoundException('The selected person is not assignable to you.');
      const task = await tx.operationalTask.create({ data: { organizationId: identity.tenantId, venueId: dto.venueId, eventId, locationId: dto.locationId, kind: dto.kind, title: dto.title.trim(), description: dto.description?.trim() ?? '', ownerId: dto.ownerId, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined, expectedQuantity: dto.expectedQuantity, unit: dto.unit, createdBy: identity.subject, updatedBy: identity.subject } });
      await tx.operationalTaskAudit.create({ data: { organizationId: identity.tenantId, taskId: task.id, actorId: identity.subject, action: 'created', after: task as unknown as Prisma.InputJsonValue } });
      return task;
    });
  }

  async updateTask(identity: Identity, eventId: string, taskId: string, dto: UpdateOperationalTaskDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const input = { eventId, taskId, patch: dto };
    return this.command(identity, key, 'task.update', input, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`task:${identity.tenantId}:${taskId}`}, 0))`;
      const current = await tx.operationalTask.findFirst({ where: { id: taskId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Task not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (dto.ownerId && !identity.assignableUserIds.includes(dto.ownerId)) throw new NotFoundException('The selected person is not assignable to you.');
      if (current.state === 'DONE' && dto.state && dto.state !== 'DONE' && !identity.capabilities.includes('tenant:admin')) throw new ConflictException('Reopening a completed task requires a tenant administrator.');
      const patch = { ...dto, title: dto.title?.trim(), description: dto.description?.trim(), updatedBy: identity.subject };
      const updated = await tx.operationalTask.update({ where: { id: taskId }, data: patch });
      await tx.operationalTaskAudit.create({ data: { organizationId: identity.tenantId, taskId, actorId: identity.subject, action: 'updated', before: current as unknown as Prisma.InputJsonValue, after: updated as unknown as Prisma.InputJsonValue } });
      return updated;
    });
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
      await tx.commandReceipt.create({ data: {
        organizationId: identity.tenantId,
        key,
        fingerprint,
        action,
        response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue,
      } });
      return response;
    });
  }

  private title(slug: string) { return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, assertTenantAdmin, Identity } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateEventDto, UpdateLocationDto, UpdateOperationalTaskDto, UpdateVenueDto, UpsertPersonDto } from './operations.dto';
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
        const previousPerson = await tx.person.findUnique({
          where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: identity.subject } },
        });
        const person = await tx.person.upsert({
          where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: identity.subject } },
          create: { organizationId: identity.tenantId, externalSubject: identity.subject, email, displayName: claims.name?.trim().slice(0, 160) || email, provisioningSource: 'sso' },
          update: { email, displayName: claims.name?.trim().slice(0, 160) || email },
        });
        const changedFields = previousPerson
          ? [
              ...(previousPerson.email !== person.email ? ['email'] : []),
              ...(previousPerson.displayName !== person.displayName ? ['display_name'] : []),
              ...(previousPerson.active !== person.active ? ['active'] : []),
            ]
          : ['external_subject', 'email', 'display_name', 'active', 'provisioning_source'];
        await this.auditPersonMutation(tx, identity, person.id, previousPerson ? 'updated' : 'created', changedFields);
      }
      const admin = identity.capabilities.includes('tenant:admin');
      const venues = await tx.venue.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const events = await tx.event.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.eventIds }, venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, include: { closeout: { select: { state: true } } }, orderBy: { startsAt: 'asc' } });
      const locations = await tx.location.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.locationIds }, venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const people = await tx.person.findMany({ where: { organizationId: identity.tenantId, ...(!admin ? { active: true, externalSubject: { in: identity.assignableUserIds } } : {}) }, include: { qualifications: { where: { revokedAt: null }, select: { id: true, code: true, name: true, expiresAt: true, revokedAt: true, ...(admin ? { evidenceStatus: true, evidenceFileName: true, evidenceContentType: true, evidenceSizeBytes: true, evidenceUploadedAt: true, evidenceReviewedAt: true, evidenceReviewReason: true } : {}) }, orderBy: [{ code: 'asc' }] } }, orderBy: { displayName: 'asc' } });
      const directory = people.map(({ provisioningSource, ...person }) => admin ? { ...person, provisioningSource } : person);
      return { organization: { id: org.id, slug: org.slug, name: org.name }, identity: { subject: identity.subject, capabilities: identity.capabilities, assignableUserIds: identity.assignableUserIds }, venues, events, locations, people: directory };
    });
  }

  async updateOrganization(identity: Identity, name: string, key: string) {
    assertTenantAdmin(identity);
    const input = { name: name.trim() };
    if (input.name.length < 2) throw new BadRequestException('Organization name must contain at least two non-space characters.');
    return this.command(identity, key, 'organization.update', input, async (tx) => {
      const current = await tx.organization.findUnique({ where: { id: identity.tenantId } });
      if (!current) throw new NotFoundException('Organization setup is required before changing its display name.');
      if (current.name === input.name) return current;
      const updated = await tx.organization.update({ where: { id: identity.tenantId }, data: { name: input.name } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'updated',
        resourceType: 'organization',
        resourceId: identity.tenantId,
        changedFields: ['name'],
      } });
      return updated;
    });
  }

  async createVenue(identity: Identity, dto: CreateVenueDto, key: string) {
    assertTenantAdmin(identity);
    const input = { name: dto.name.trim(), timeZone: this.requireTimeZone(dto.timeZone) };
    return this.command(identity, key, 'venue.create', input, async (tx) => {
      const venue = await tx.venue.create({ data: { organizationId: identity.tenantId, ...input } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'created',
        resourceType: 'venue',
        resourceId: venue.id,
        changedFields: ['name', 'time_zone', 'lifecycle_state'],
      } });
      return venue;
    });
  }

  async updateVenue(identity: Identity, venueId: string, dto: UpdateVenueDto, key: string) {
    assertTenantAdmin(identity);
    const input = this.setupPatch({ name: dto.name?.trim(), timeZone: dto.timeZone?.trim() });
    if (input.timeZone !== undefined) this.requireTimeZone(input.timeZone);
    return this.command(identity, key, 'venue.update', { venueId, ...input }, async (tx) => {
      const current = await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Venue not found in this organization.');
      const changedFields = [
        ...(input.name !== undefined && current.name !== input.name ? ['name'] : []),
        ...(input.timeZone !== undefined && current.timeZone !== input.timeZone ? ['time_zone'] : []),
      ];
      if (changedFields.length === 0) return current;
      const updated = await tx.venue.update({ where: { id: venueId }, data: input });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'venue', resourceId: venueId, changedFields } });
      return updated;
    });
  }

  async venueReadiness(identity: Identity, venueId: string) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({
        where: { id: venueId, organizationId: identity.tenantId },
        include: { _count: { select: { locations: true } } },
      });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      return this.venueReadinessResult(venue);
    });
  }

  async updateVenueLifecycle(identity: Identity, venueId: string, action: 'activate' | 'suspend', key: string) {
    assertTenantAdmin(identity);
    return this.command(identity, key, `venue.${action}`, { venueId, action }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM venues WHERE id = ${venueId}::uuid AND organization_id = ${identity.tenantId}::uuid FOR UPDATE`;
      const venue = await tx.venue.findFirst({
        where: { id: venueId, organizationId: identity.tenantId },
        include: { _count: { select: { locations: true } } },
      });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const nextState = action === 'activate' ? 'ACTIVE' : 'SUSPENDED';
      if (venue.lifecycleState === nextState) return venue;
      if (action === 'suspend' && venue.lifecycleState !== 'ACTIVE') {
        throw new ConflictException('Only an active venue can be suspended.');
      }
      if (action === 'activate') {
        const readiness = this.venueReadinessResult(venue);
        const blockers = readiness.checks.filter((check) => !check.passed).map((check) => check.label);
        if (blockers.length > 0) throw new ConflictException(`Venue is not ready to activate: ${blockers.join('; ')}.`);
      }
      const updated = await tx.venue.update({
        where: { id: venueId },
        data: action === 'activate'
          ? { lifecycleState: nextState, activatedAt: new Date(), activatedBy: identity.subject }
          : { lifecycleState: nextState, activatedAt: null, activatedBy: null },
      });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: action === 'activate' ? 'activated' : 'suspended',
        resourceType: 'venue',
        resourceId: venueId,
        changedFields: ['lifecycle_state', 'activated_at', 'activated_by'],
      } });
      return updated;
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

  async updateLocation(identity: Identity, locationId: string, dto: UpdateLocationDto, key: string) {
    assertTenantAdmin(identity);
    const input = this.setupPatch({ name: dto.name?.trim() });
    return this.command(identity, key, 'location.update', { locationId, ...input }, async (tx) => {
      const current = await tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Location not found in this organization.');
      const changedFields = Object.keys(input).filter((field) => current[field as keyof typeof current] !== input[field as keyof typeof input]);
      if (changedFields.length === 0) return current;
      const updated = await tx.location.update({ where: { id: locationId }, data: input });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'location', resourceId: locationId, changedFields } });
      return updated;
    });
  }

  async createEvent(identity: Identity, dto: CreateEventDto, key: string) {
    assertTenantAdmin(identity);
    const input = { venueId: dto.venueId, name: dto.name.trim(), startsAt: new Date(dto.startsAt).toISOString() };
    return this.command(identity, key, 'event.create', input, async (tx) => {
      const venue = await tx.venue.findFirst({
        where: { id: dto.venueId, organizationId: identity.tenantId },
        include: { _count: { select: { locations: true } } },
      });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      if (venue.lifecycleState !== 'ACTIVE' || !this.isValidTimeZone(venue.timeZone) || venue._count.locations === 0) {
        throw new ConflictException('Activate this venue after adding a location and setting a valid time zone before creating events.');
      }
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

  async updateEvent(identity: Identity, eventId: string, dto: UpdateEventDto, key: string) {
    assertTenantAdmin(identity);
    const input = this.setupPatch({ name: dto.name?.trim(), startsAt: dto.startsAt ? new Date(dto.startsAt).toISOString() : undefined });
    return this.command(identity, key, 'event.update', { eventId, ...input }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId}::uuid AND organization_id = ${identity.tenantId}::uuid FOR UPDATE`;
      const current = await tx.event.findFirst({
        where: { id: eventId, organizationId: identity.tenantId },
        include: { closeout: { select: { state: true } } },
      });
      if (!current) throw new NotFoundException('Event not found in this organization.');
      if (current.closeout?.state === 'CLOSED') throw new ConflictException('A finalized event cannot be edited. Add a post-close correction instead.');
      const changedFields = [
        ...(input.name !== undefined && current.name !== input.name ? ['name'] : []),
        ...(input.startsAt !== undefined && current.startsAt.toISOString() !== input.startsAt ? ['starts_at'] : []),
      ];
      if (changedFields.length === 0) return current;
      const updated = await tx.event.update({ where: { id: eventId }, data: { name: input.name, startsAt: input.startsAt ? new Date(input.startsAt) : undefined } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'event', resourceId: eventId, eventId, changedFields } });
      return updated;
    });
  }

  async upsertPerson(identity: Identity, dto: UpsertPersonDto, key: string) {
    assertTenantAdmin(identity);
    const input = { externalSubject: dto.externalSubject, email: dto.email.trim().toLowerCase(), displayName: dto.displayName.trim() };
    return this.command(identity, key, 'person.upsert', input, async (tx) => {
      const previousPerson = await tx.person.findUnique({
        where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: dto.externalSubject } },
      });
      if (previousPerson?.provisioningSource === 'scim') throw new ConflictException('This roster record is managed by SCIM. Update it through the identity provider.');
      if (previousPerson?.provisioningSource === 'unknown') throw new ConflictException('This roster record predates source tracking. Reconcile its provisioning source before editing it.');
      if (previousPerson?.provisioningSource === 'sso') throw new ConflictException('This profile is maintained by SSO claims. Edit the identity-provider record instead.');
      const person = await tx.person.upsert({
        where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: dto.externalSubject } },
        create: { organizationId: identity.tenantId, ...input, provisioningSource: 'admin' },
        update: { email: input.email, displayName: input.displayName, active: true, provisioningSource: 'admin' },
      });
      const changedFields = previousPerson
        ? [
            ...(previousPerson.email !== person.email ? ['email'] : []),
            ...(previousPerson.displayName !== person.displayName ? ['display_name'] : []),
            ...(previousPerson.active !== person.active ? ['active'] : []),
            ...(previousPerson.provisioningSource !== person.provisioningSource ? ['provisioning_source'] : []),
          ]
        : ['external_subject', 'email', 'display_name', 'active', 'provisioning_source'];
      await this.auditPersonMutation(tx, identity, person.id, previousPerson ? 'updated' : 'created', changedFields);
      return person;
    });
  }

  async setPersonActive(identity: Identity, personId: string, active: boolean, key: string) {
    assertTenantAdmin(identity);
    return this.command(identity, key, `person.${active ? 'activate' : 'deactivate'}`, { personId, active }, async (tx) => {
      const current = await tx.person.findFirst({ where: { id: personId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Person not found in this organization.');
      if (current.provisioningSource === 'scim') throw new ConflictException('This roster record is managed by SCIM. Change its status through the identity provider.');
      if (current.provisioningSource === 'unknown') throw new ConflictException('This roster record predates source tracking. Reconcile its provisioning source before changing its status.');
      if (!active && current.externalSubject === identity.subject) throw new ForbiddenException('Ask another tenant administrator to deactivate your account.');
      if (current.active === active) return current;
      const updated = await tx.person.update({ where: { id: personId }, data: { active } });
      await this.auditPersonMutation(tx, identity, personId, active ? 'reactivated' : 'deactivated', ['active']);
      return updated;
    });
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

  private setupPatch<T extends Record<string, string | undefined>>(patch: T): Partial<Record<keyof T, string>> {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Record<keyof T, string>>;
    if (Object.keys(defined).length === 0) throw new ConflictException('Provide at least one field to update.');
    if (Object.values(defined).some((value) => value!.length === 0)) throw new ConflictException('Updated names cannot be blank.');
    return defined;
  }

  private async auditPersonMutation(tx: Prisma.TransactionClient, identity: Identity, personId: string, action: string, changedFields: string[]) {
    if (changedFields.length === 0) return;
    await tx.personAuditEvent.create({
      data: {
        organizationId: identity.tenantId,
        personId,
        actorId: identity.subject,
        action,
        changedFields,
      },
    });
  }

  private isValidTimeZone(timeZone: string | null | undefined): boolean {
    if (!timeZone?.trim()) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
      return true;
    } catch {
      return false;
    }
  }

  private requireTimeZone(timeZone: string): string {
    const value = timeZone.trim();
    if (!this.isValidTimeZone(value)) {
      throw new BadRequestException('Enter a valid IANA time zone, such as America/Chicago.');
    }
    return value;
  }

  private venueReadinessResult(venue: {
    id: string;
    timeZone: string | null;
    lifecycleState: string;
    _count: { locations: number };
  }) {
    const validTimeZone = this.isValidTimeZone(venue.timeZone);
    const hasLocation = venue._count.locations > 0;
    const checks = [
      {
        key: 'time_zone',
        label: 'Venue time zone is valid',
        passed: validTimeZone,
        detail: validTimeZone ? venue.timeZone : 'Set a valid IANA time zone, such as America/Chicago.',
      },
      {
        key: 'location',
        label: 'At least one operational location exists',
        passed: hasLocation,
        detail: hasLocation ? `${venue._count.locations} location(s) configured.` : 'Add a location such as a concourse, kitchen, or suite level.',
      },
    ];
    return {
      venueId: venue.id,
      lifecycleState: venue.lifecycleState,
      timeZone: venue.timeZone,
      locationsCount: venue._count.locations,
      checks,
      ready: checks.every((check) => check.passed),
    };
  }

  private title(slug: string) { return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
}

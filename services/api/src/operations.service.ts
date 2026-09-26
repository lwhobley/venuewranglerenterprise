import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { formatVenueLocal, isAbsoluteInstant, venueLocalToUtc } from './venue-time';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, assertTenantAdmin, assertVenueAdmin, Identity } from './auth';
import { CaptureVenueTemplateDto, CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDepartmentDto, CreateVenueServiceAreaDto, CreateVenueDto, PreviewVenueEventDto, SetLocationServiceAreaDto, UpdateEventDto, UpdateLocationDto, UpdateOperationalTaskDto, UpdateVenueDto, UpsertPersonDto } from './operations.dto';
import { PrismaService } from './prisma.service';
import { GrantPersonQualificationDto } from './qualification.dto';
import { UpdateStaffingPolicyDto } from './staffing-policy.dto';

interface VenueTemplateStructure {
  departments: Array<{ code: string; name: string }>;
  serviceAreas: Array<{ code: string; name: string; departmentCode: string | null }>;
  locations: Array<{ name: string; serviceAreaCode: string | null }>;
  defaultEventStartLocal: string | null;
}

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
      const venueAdmin = identity.capabilities.includes('venue:admin');
      const venues = await tx.venue.findMany({ where: admin ? { organizationId: identity.tenantId } : { id: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const events = (await tx.event.findMany({ where: admin ? { organizationId: identity.tenantId } : { ...(venueAdmin ? {} : { id: { in: identity.eventIds } }), venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, include: { closeout: { select: { state: true } } }, orderBy: { startsAt: 'asc' } })).map((event) => this.presentEvent(event, venues.find((venue) => venue.id === event.venueId)?.timeZone));
      const locations = await tx.location.findMany({ where: admin ? { organizationId: identity.tenantId } : { ...(venueAdmin ? {} : { id: { in: identity.locationIds } }), venueId: { in: identity.venueIds }, organizationId: identity.tenantId }, orderBy: { name: 'asc' } });
      const serviceAreas = await tx.venueServiceArea.findMany({ where: admin ? { organizationId: identity.tenantId } : { organizationId: identity.tenantId, venueId: { in: identity.venueIds } }, orderBy: { name: 'asc' }, select: { id: true, venueId: true, departmentId: true, name: true, code: true } });
      const people = await tx.person.findMany({ where: { organizationId: identity.tenantId, ...(!admin ? { active: true, externalSubject: { in: identity.assignableUserIds } } : {}) }, include: { qualifications: { where: { revokedAt: null }, select: { id: true, code: true, name: true, expiresAt: true, revokedAt: true, ...(admin ? { evidenceStatus: true, evidenceFileName: true, evidenceContentType: true, evidenceSizeBytes: true, evidenceUploadedAt: true, evidenceReviewedAt: true, evidenceReviewReason: true } : {}) }, orderBy: [{ code: 'asc' }] } }, orderBy: { displayName: 'asc' } });
      const directory = people.map(({ provisioningSource, ...person }) => admin ? { ...person, provisioningSource } : person);
      return { organization: { id: org.id, slug: org.slug, name: org.name }, identity: { subject: identity.subject, capabilities: identity.capabilities, assignableUserIds: identity.assignableUserIds }, venues, events, locations, serviceAreas, people: directory };
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
    assertVenueAdmin(identity, venueId);
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
    assertVenueAdmin(identity, venueId);
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
      if (action === 'activate') await this.notifyVenueRecipients(tx, identity, venueId, 'venue.activated', 'Venue activated', `${updated.name} is active. Confirm the venue clock, locations, and first event before event day.`);
      return updated;
    });
  }

  async assignVenueNoticeRecipient(identity: Identity, venueId: string, subject: string, key: string) {
    assertVenueAdmin(identity, venueId);
    const input = { venueId, subject: subject.trim() };
    return this.command(identity, key, 'venue-notice-recipient.assign', input, async (tx) => {
      const person = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: input.subject, active: true }, select: { externalSubject: true } });
      if (!person) throw new NotFoundException('The notice recipient must be an active person in this organization.');
      const existing = await tx.venueNoticeRecipient.findUnique({ where: { organizationId_venueId_subject: { organizationId: identity.tenantId, venueId, subject: input.subject } } });
      if (existing) return existing;
      const created = await tx.venueNoticeRecipient.create({ data: { organizationId: identity.tenantId, venueId, subject: input.subject, assignedBy: identity.subject } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'venue_notice_recipient', resourceId: created.id, changedFields: ['subject'] } });
      return created;
    });
  }

  private async notifyVenueRecipients(tx: Prisma.TransactionClient, identity: Identity, venueId: string, kind: string, title: string, body: string) {
    const recipients = await tx.venueNoticeRecipient.findMany({ where: { organizationId: identity.tenantId, venueId }, select: { subject: true } });
    for (const recipient of recipients) {
      if (recipient.subject === identity.subject) continue;
      await tx.venueNotice.create({ data: { organizationId: identity.tenantId, venueId, recipientSubject: recipient.subject, kind, title, body } });
    }
  }

  async createLocation(identity: Identity, dto: CreateLocationDto, key: string) {
    assertVenueAdmin(identity, dto.venueId);
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
    const scopedLocation = await this.prisma.withTenant(identity, (tx) =>
      tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId }, select: { venueId: true } }));
    if (!scopedLocation) throw new NotFoundException('Location not found in this organization.');
    assertVenueAdmin(identity, scopedLocation.venueId);
    const input = this.setupPatch({ name: dto.name?.trim() });
    return this.command(identity, key, 'location.update', { locationId, ...input }, async (tx) => {
      const current = await tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Location not found in this organization.');
      assertVenueAdmin(identity, current.venueId);
      const changedFields = Object.keys(input).filter((field) => current[field as keyof typeof current] !== input[field as keyof typeof input]);
      if (changedFields.length === 0) return current;
      const updated = await tx.location.update({ where: { id: locationId }, data: input });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'location', resourceId: locationId, changedFields } });
      return updated;
    });
  }

  async venueStructure(identity: Identity, venueId: string) {
    assertVenueAdmin(identity, venueId);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId }, select: { id: true, name: true } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const [departments, serviceAreas, locations] = await Promise.all([
        tx.venueDepartment.findMany({ where: { organizationId: identity.tenantId, venueId }, orderBy: { name: 'asc' } }),
        tx.venueServiceArea.findMany({ where: { organizationId: identity.tenantId, venueId }, orderBy: { name: 'asc' } }),
        tx.location.findMany({ where: { organizationId: identity.tenantId, venueId }, orderBy: { name: 'asc' }, select: { id: true, name: true, serviceAreaId: true } }),
      ]);
      return { venue, departments, serviceAreas, locations };
    });
  }

  async venueOnboarding(identity: Identity, venueId: string) {
    assertVenueAdmin(identity, venueId);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId }, include: { _count: { select: { locations: true, events: true, departments: true, serviceAreas: true } } } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const assignedLocations = await tx.location.count({ where: { organizationId: identity.tenantId, venueId, serviceAreaId: { not: null } } });
      const checks = [
        { key: 'time_zone', label: 'Valid venue time zone', passed: this.isValidTimeZone(venue.timeZone), requiredForActivation: true },
        { key: 'location', label: 'At least one operational location', passed: venue._count.locations > 0, requiredForActivation: true },
        { key: 'department', label: 'Departments configured', passed: venue._count.departments > 0, requiredForActivation: false },
        { key: 'service_area', label: 'Service areas configured', passed: venue._count.serviceAreas > 0, requiredForActivation: false },
        { key: 'location_assignment', label: 'Locations assigned to service areas', passed: venue._count.locations > 0 && assignedLocations === venue._count.locations, requiredForActivation: false },
        { key: 'identity_scope', label: 'This account has venue scope in its signed claims', passed: identity.capabilities.includes('tenant:admin') || identity.venueIds.includes(venueId), requiredForActivation: false },
        { key: 'sample_event', label: 'A first event exists after activation', passed: venue._count.events > 0, requiredForActivation: false },
      ];
      return { venueId, lifecycleState: venue.lifecycleState, counts: { ...venue._count, assignedLocations }, checks, activationReady: checks.filter((item) => item.requiredForActivation).every((item) => item.passed) };
    });
  }

  async previewVenueEvent(identity: Identity, venueId: string, dto: PreviewVenueEventDto) {
    assertVenueAdmin(identity, venueId);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId }, select: { timeZone: true } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      const startsAt = this.resolveEventStart(dto, venue.timeZone ?? '');
      return { venueId, startsAtLocal: dto.startsAtLocal, timeZone: venue.timeZone, startsAt: startsAt.toISOString(), writesPerformed: false };
    });
  }

  async createVenueDepartment(identity: Identity, venueId: string, dto: CreateVenueDepartmentDto, key: string) {
    assertVenueAdmin(identity, venueId);
    const input = { venueId, code: dto.code.trim().toUpperCase(), name: dto.name.trim() };
    return this.command(identity, key, 'venue-department.create', input, async (tx) => {
      if (!await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Venue not found in this organization.');
      if (await tx.venueDepartment.findFirst({ where: { organizationId: identity.tenantId, venueId, code: input.code } })) throw new ConflictException('This department code already exists in the venue.');
      const department = await tx.venueDepartment.create({ data: { organizationId: identity.tenantId, ...input } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'department', resourceId: department.id, changedFields: ['code', 'name', 'venue_id'] } });
      return department;
    });
  }

  async createVenueServiceArea(identity: Identity, venueId: string, dto: CreateVenueServiceAreaDto, key: string) {
    assertVenueAdmin(identity, venueId);
    const input = { venueId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), departmentId: dto.departmentId ?? null };
    return this.command(identity, key, 'venue-service-area.create', input, async (tx) => {
      if (!await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Venue not found in this organization.');
      if (input.departmentId && !await tx.venueDepartment.findFirst({ where: { id: input.departmentId, venueId, organizationId: identity.tenantId } })) throw new BadRequestException('Department must belong to the selected venue.');
      if (await tx.venueServiceArea.findFirst({ where: { organizationId: identity.tenantId, venueId, code: input.code } })) throw new ConflictException('This service area code already exists in the venue.');
      const area = await tx.venueServiceArea.create({ data: { organizationId: identity.tenantId, ...input } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'service_area', resourceId: area.id, changedFields: ['code', 'name', 'department_id', 'venue_id'] } });
      return area;
    });
  }

  async setLocationServiceArea(identity: Identity, locationId: string, dto: SetLocationServiceAreaDto, key: string) {
    const location = await this.prisma.withTenant(identity, (tx) => tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId }, select: { venueId: true } }));
    if (!location) throw new NotFoundException('Location not found in this organization.');
    assertVenueAdmin(identity, location.venueId);
    const input = { locationId, serviceAreaId: dto.serviceAreaId ?? null };
    return this.command(identity, key, 'location.service-area.set', input, async (tx) => {
      const current = await tx.location.findFirst({ where: { id: locationId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Location not found in this organization.');
      assertVenueAdmin(identity, current.venueId);
      if (input.serviceAreaId && !await tx.venueServiceArea.findFirst({ where: { id: input.serviceAreaId, venueId: current.venueId, organizationId: identity.tenantId } })) throw new BadRequestException('Service area must belong to the location venue.');
      if (current.serviceAreaId === input.serviceAreaId) return current;
      const updated = await tx.location.update({ where: { id: locationId }, data: { serviceAreaId: input.serviceAreaId } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'location', resourceId: locationId, changedFields: ['service_area_id'] } });
      return updated;
    });
  }

  async venueTemplates(identity: Identity) {
    if (!identity.capabilities.includes('tenant:admin') && !identity.capabilities.includes('venue:admin')) throw new ForbiddenException('Venue administrator access is required.');
    return this.prisma.withTenant(identity, (tx) => tx.venueTemplate.findMany({
      where: { organizationId: identity.tenantId },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      select: { id: true, code: true, name: true, version: true, createdAt: true, createdBy: true },
      take: 200,
    }));
  }

  async captureVenueTemplate(identity: Identity, dto: CaptureVenueTemplateDto, key: string) {
    assertTenantAdmin(identity);
    const input = { sourceVenueId: dto.sourceVenueId, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), defaultEventStartLocal: dto.defaultEventStartLocal ?? null };
    return this.command(identity, key, 'venue-template.capture', input, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`venue-template:${identity.tenantId}:${input.code}`}, 0))`;
      const venue = await tx.venue.findFirst({ where: { id: input.sourceVenueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Source venue not found in this organization.');
      const [departments, areas, locations, latest] = await Promise.all([
        tx.venueDepartment.findMany({ where: { organizationId: identity.tenantId, venueId: venue.id }, orderBy: { code: 'asc' } }),
        tx.venueServiceArea.findMany({ where: { organizationId: identity.tenantId, venueId: venue.id }, orderBy: { code: 'asc' } }),
        tx.location.findMany({ where: { organizationId: identity.tenantId, venueId: venue.id }, orderBy: { name: 'asc' } }),
        tx.venueTemplate.findFirst({ where: { organizationId: identity.tenantId, code: input.code }, orderBy: { version: 'desc' } }),
      ]);
      const names = locations.map((item) => item.name.trim().toLocaleLowerCase());
      if (locations.length === 0) throw new ConflictException('Add at least one location before capturing a venue template.');
      if (new Set(names).size !== names.length) throw new ConflictException('This venue has duplicate location names. Resolve them before capturing a template.');
      const structure: VenueTemplateStructure = {
        departments: departments.map((item) => ({ code: item.code, name: item.name })),
        serviceAreas: areas.map((item) => ({ code: item.code, name: item.name, departmentCode: departments.find((department) => department.id === item.departmentId)?.code ?? null })),
        locations: locations.map((item) => ({ name: item.name, serviceAreaCode: areas.find((area) => area.id === item.serviceAreaId)?.code ?? null })),
        defaultEventStartLocal: input.defaultEventStartLocal,
      };
      const template = await tx.venueTemplate.create({ data: { organizationId: identity.tenantId, code: input.code, name: input.name, version: (latest?.version ?? 0) + 1, structure: structure as unknown as Prisma.InputJsonValue, createdBy: identity.subject } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'venue_template', resourceId: template.id, changedFields: ['code', 'version', 'structure'] } });
      return { id: template.id, code: template.code, name: template.name, version: template.version, createdAt: template.createdAt };
    });
  }

  async previewVenueTemplate(identity: Identity, templateId: string, venueId: string) {
    assertVenueAdmin(identity, venueId);
    return this.prisma.withTenant(identity, (tx) => this.venueTemplatePlan(tx, identity, templateId, venueId));
  }

  async applyVenueTemplate(identity: Identity, templateId: string, venueId: string, key: string) {
    assertVenueAdmin(identity, venueId);
    return this.command(identity, key, 'venue-template.apply', { templateId, venueId }, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`venue-template-apply:${identity.tenantId}:${venueId}`}, 0))`;
      const plan = await this.venueTemplatePlan(tx, identity, templateId, venueId);
      if (plan.conflicts.length > 0) throw new ConflictException(`Resolve template conflicts before applying: ${plan.conflicts.join('; ')}`);
      const departmentIds = new Map(plan.currentDepartments.map((item) => [item.code, item.id]));
      for (const item of plan.addDepartments) {
        const created = await tx.venueDepartment.create({ data: { organizationId: identity.tenantId, venueId, code: item.code, name: item.name } });
        departmentIds.set(item.code, created.id);
        await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'department', resourceId: created.id, changedFields: ['code', 'name', 'venue_id'] } });
      }
      const areaIds = new Map(plan.currentAreas.map((item) => [item.code, item.id]));
      for (const item of plan.addServiceAreas) {
        const created = await tx.venueServiceArea.create({ data: { organizationId: identity.tenantId, venueId, code: item.code, name: item.name, departmentId: item.departmentCode ? departmentIds.get(item.departmentCode) : null } });
        areaIds.set(item.code, created.id);
        await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'service_area', resourceId: created.id, changedFields: ['code', 'name', 'department_id', 'venue_id'] } });
      }
      for (const item of plan.addLocations) {
        const created = await tx.location.create({ data: { organizationId: identity.tenantId, venueId, name: item.name, serviceAreaId: item.serviceAreaCode ? areaIds.get(item.serviceAreaCode) : null } });
        await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'created', resourceType: 'location', resourceId: created.id, changedFields: ['name', 'venue_id', 'service_area_id'] } });
      }
      return { venueId, templateId, version: plan.version, departmentsCreated: plan.addDepartments.length, serviceAreasCreated: plan.addServiceAreas.length, locationsCreated: plan.addLocations.length, defaultEventStartLocal: plan.defaultEventStartLocal };
    });
  }

  private async venueTemplatePlan(tx: Prisma.TransactionClient, identity: Identity, templateId: string, venueId: string) {
    const [template, venue, currentDepartments, currentAreas, currentLocations] = await Promise.all([
      tx.venueTemplate.findFirst({ where: { id: templateId, organizationId: identity.tenantId } }),
      tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId }, select: { id: true } }),
      tx.venueDepartment.findMany({ where: { organizationId: identity.tenantId, venueId } }),
      tx.venueServiceArea.findMany({ where: { organizationId: identity.tenantId, venueId } }),
      tx.location.findMany({ where: { organizationId: identity.tenantId, venueId } }),
    ]);
    if (!template || !venue) throw new NotFoundException('Template or target venue not found in this organization.');
    const structure = this.parseVenueTemplate(template.structure);
    const conflicts: string[] = [];
    const departmentByCode = new Map(currentDepartments.map((item) => [item.code, item]));
    const areaByCode = new Map(currentAreas.map((item) => [item.code, item]));
    const locationByName = new Map(currentLocations.map((item) => [item.name.trim().toLocaleLowerCase(), item]));
    const addDepartments = structure.departments.filter((item) => !departmentByCode.has(item.code));
    const addServiceAreas = structure.serviceAreas.filter((item) => !areaByCode.has(item.code));
    const addLocations = structure.locations.filter((item) => !locationByName.has(item.name.trim().toLocaleLowerCase()));
    for (const item of structure.departments) {
      const current = departmentByCode.get(item.code);
      if (current && current.name !== item.name) conflicts.push(`Department ${item.code} has a different name`);
    }
    for (const item of structure.serviceAreas) {
      const current = areaByCode.get(item.code);
      if (!current) continue;
      const departmentCode = currentDepartments.find((department) => department.id === current.departmentId)?.code ?? null;
      if (current.name !== item.name || departmentCode !== item.departmentCode) conflicts.push(`Service area ${item.code} differs`);
    }
    for (const item of structure.locations) {
      const current = locationByName.get(item.name.trim().toLocaleLowerCase());
      if (!current) continue;
      const areaCode = currentAreas.find((area) => area.id === current.serviceAreaId)?.code ?? null;
      if (areaCode !== item.serviceAreaCode) conflicts.push(`Location ${item.name} belongs to a different area`);
    }
    return { templateId, venueId, version: template.version, defaultEventStartLocal: structure.defaultEventStartLocal, addDepartments, addServiceAreas, addLocations, conflicts, currentDepartments, currentAreas };
  }

  private parseVenueTemplate(raw: Prisma.JsonValue): VenueTemplateStructure {
    const value = raw as unknown as VenueTemplateStructure;
    if (!value || !Array.isArray(value.departments) || !Array.isArray(value.serviceAreas) || !Array.isArray(value.locations)) throw new ConflictException('The template structure is invalid.');
    return value;
  }

  async createEvent(identity: Identity, dto: CreateEventDto, key: string) {
    assertVenueAdmin(identity, dto.venueId);
    const input = { venueId: dto.venueId, name: dto.name.trim(), startsAt: dto.startsAt, startsAtLocal: dto.startsAtLocal };
    return this.command(identity, key, 'event.create', input, async (tx) => {
      const venue = await tx.venue.findFirst({
        where: { id: dto.venueId, organizationId: identity.tenantId },
        include: { _count: { select: { locations: true } } },
      });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      if (venue.lifecycleState !== 'ACTIVE' || !this.isValidTimeZone(venue.timeZone) || venue._count.locations === 0) {
        throw new ConflictException('Activate this venue after adding a location and setting a valid time zone before creating events.');
      }
      const startsAt = this.resolveEventStart(dto, venue.timeZone!);
      const event = await tx.event.create({ data: { organizationId: identity.tenantId, venueId: venue.id, name: dto.name.trim(), startsAt } });
      await tx.tenantSetupAuditEvent.create({ data: {
        organizationId: identity.tenantId,
        actorId: identity.subject,
        action: 'created',
        resourceType: 'event',
        resourceId: event.id,
        eventId: event.id,
        changedFields: ['name', 'starts_at', 'venue_id'],
      } });
      return this.presentEvent(event, venue.timeZone);
    });
  }

  async updateEvent(identity: Identity, eventId: string, dto: UpdateEventDto, key: string) {
    const scopedEvent = await this.prisma.withTenant(identity, (tx) =>
      tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId }, select: { venueId: true } }));
    if (!scopedEvent) throw new NotFoundException('Event not found in this organization.');
    assertVenueAdmin(identity, scopedEvent.venueId);
    const input = this.setupPatch({ name: dto.name?.trim(), startsAt: dto.startsAt, startsAtLocal: dto.startsAtLocal });
    return this.command(identity, key, 'event.update', { eventId, ...input }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId}::uuid AND organization_id = ${identity.tenantId}::uuid FOR UPDATE`;
      const current = await tx.event.findFirst({
        where: { id: eventId, organizationId: identity.tenantId },
        include: { closeout: { select: { state: true } } },
      });
      if (!current) throw new NotFoundException('Event not found in this organization.');
      assertVenueAdmin(identity, current.venueId);
      if (current.closeout?.state === 'CLOSED') throw new ConflictException('A finalized event cannot be edited. Add a post-close correction instead.');
      const venue = await tx.venue.findFirst({ where: { id: current.venueId, organizationId: identity.tenantId }, select: { timeZone: true } });
      const startsAt = dto.startsAt !== undefined || dto.startsAtLocal !== undefined ? this.resolveEventStart(dto, venue?.timeZone ?? '') : undefined;
      const changedFields = [
        ...(input.name !== undefined && current.name !== input.name ? ['name'] : []),
        ...(startsAt !== undefined && current.startsAt.toISOString() !== startsAt.toISOString() ? ['starts_at'] : []),
      ];
      if (changedFields.length === 0) return this.presentEvent(current, venue?.timeZone);
      const updated = await tx.event.update({ where: { id: eventId }, data: { name: input.name, startsAt } });
      await tx.tenantSetupAuditEvent.create({ data: { organizationId: identity.tenantId, actorId: identity.subject, action: 'updated', resourceType: 'event', resourceId: eventId, eventId, changedFields } });
      return this.presentEvent(updated, venue?.timeZone);
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

  private resolveEventStart(dto: { startsAt?: string; startsAtLocal?: string }, timeZone: string): Date {
    const hasInstant = dto.startsAt !== undefined;
    const hasLocal = dto.startsAtLocal !== undefined;
    if (hasInstant === hasLocal) throw new BadRequestException('Provide either an absolute startsAt instant or a venue-local startsAtLocal time, not both.');
    if (hasLocal) {
      if (!this.isValidTimeZone(timeZone)) throw new ConflictException('Set a valid venue time zone before scheduling an event.');
      try {
        return venueLocalToUtc(dto.startsAtLocal!, timeZone);
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : 'That event time is not valid in the venue time zone.');
      }
    }
    if (!isAbsoluteInstant(dto.startsAt!)) throw new BadRequestException('startsAt must include a UTC Z or numeric offset. Send startsAtLocal for a time on the venue clock.');
    return new Date(dto.startsAt!);
  }

  private presentEvent<T extends { startsAt: Date }>(event: T, timeZone: string | null | undefined) {
    return { ...event, timeZone: timeZone ?? null, startsAtLocal: this.isValidTimeZone(timeZone) ? formatVenueLocal(event.startsAt, timeZone!) : null };
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

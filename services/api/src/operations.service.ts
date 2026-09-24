import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertScope, assertTenantAdmin, Identity } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateOperationalTaskDto, UpsertPersonDto } from './operations.dto';
import { PrismaService } from './prisma.service';

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async bootstrap(identity: Identity, claims: { email?: string; name?: string }) {
    return this.prisma.withTenant(identity, async (tx) => {
      const slug = identity.organizationSlug;
      const org = await tx.organization.upsert({
        where: { id: identity.tenantId },
        create: { id: identity.tenantId, name: slug ? this.title(slug) : 'Venue organization', slug },
        update: slug ? { slug } : {},
      });
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
      const people = await tx.person.findMany({ where: { organizationId: identity.tenantId, active: true, ...(!admin ? { externalSubject: { in: identity.assignableUserIds } } : {}) }, orderBy: { displayName: 'asc' } });
      return { organization: { id: org.id, slug: org.slug, name: org.name }, identity: { subject: identity.subject, capabilities: identity.capabilities, assignableUserIds: identity.assignableUserIds }, venues, events, locations, people };
    });
  }

  async createVenue(identity: Identity, dto: CreateVenueDto) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, (tx) => tx.venue.create({ data: { organizationId: identity.tenantId, name: dto.name.trim() } }));
  }

  async createLocation(identity: Identity, dto: CreateLocationDto) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: dto.venueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      return tx.location.create({ data: { organizationId: identity.tenantId, venueId: venue.id, name: dto.name.trim() } });
    });
  }

  async createEvent(identity: Identity, dto: CreateEventDto) {
    assertTenantAdmin(identity);
    return this.prisma.withTenant(identity, async (tx) => {
      const venue = await tx.venue.findFirst({ where: { id: dto.venueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Venue not found in this organization.');
      return tx.event.create({ data: { organizationId: identity.tenantId, venueId: venue.id, name: dto.name.trim(), startsAt: new Date(dto.startsAt) } });
    });
  }

  async upsertPerson(identity: Identity, dto: UpsertPersonDto) {
    assertTenantAdmin(identity);
    const email = dto.email.trim().toLowerCase();
    return this.prisma.withTenant(identity, (tx) => tx.person.upsert({
      where: { organizationId_externalSubject: { organizationId: identity.tenantId, externalSubject: dto.externalSubject } },
      create: { organizationId: identity.tenantId, externalSubject: dto.externalSubject, email, displayName: dto.displayName.trim() },
      update: { email, displayName: dto.displayName.trim(), active: true },
    }));
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

  async createTask(identity: Identity, eventId: string, dto: CreateOperationalTaskDto) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in the selected venue.');
      if (dto.ownerId && !identity.assignableUserIds.includes(dto.ownerId)) throw new NotFoundException('The selected person is not assignable to you.');
      const task = await tx.operationalTask.create({ data: { organizationId: identity.tenantId, venueId: dto.venueId, eventId, locationId: dto.locationId, kind: dto.kind, title: dto.title.trim(), description: dto.description?.trim() ?? '', ownerId: dto.ownerId, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined, expectedQuantity: dto.expectedQuantity, unit: dto.unit, createdBy: identity.subject, updatedBy: identity.subject } });
      await tx.operationalTaskAudit.create({ data: { organizationId: identity.tenantId, taskId: task.id, actorId: identity.subject, action: 'created', after: task as unknown as Prisma.InputJsonValue } });
      return task;
    });
  }

  async updateTask(identity: Identity, eventId: string, taskId: string, dto: UpdateOperationalTaskDto) {
    assertScope(identity, 'operations:write', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
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

  private title(slug: string) { return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '); }
}

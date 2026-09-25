import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertCapability, type Identity } from './auth';
import { PrismaService } from './prisma.service';
import { CreateUnavailabilityDto } from './staff-availability.dto';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class StaffAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: Identity) {
    assertCapability(identity, 'operations:read');
    return this.prisma.withTenant(identity, (tx) => tx.staffUnavailability.findMany({
      where: { organizationId: identity.tenantId, subject: identity.subject, deletedAt: null },
      orderBy: { startsAt: 'asc' },
    }));
  }

  async create(identity: Identity, dto: CreateUnavailabilityDto, key: string) {
    assertCapability(identity, 'operations:read');
    const startsAt = new Date(dto.startsAt); const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new ConflictException('Unavailability end must be later than its start.');
    const input = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note: dto.note?.trim() ?? '' };
    return this.command(identity, key, 'staff-unavailability.create', input, async (tx) => {
      const person = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: identity.subject, active: true }, select: { id: true } });
      if (!person) throw new ForbiddenException('An active organization roster record is required to set availability.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${identity.tenantId}:${identity.subject}`}, 0))`;
      const assignedShift = await tx.staffShift.findFirst({ where: {
        organizationId: identity.tenantId,
        assignedSubject: identity.subject,
        state: 'PUBLISHED',
        attendance: { not: 'CHECKED_OUT' },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      }, select: { id: true } });
      if (assignedShift) throw new ConflictException('A published shift overlaps this time. Contact the scheduler to correct your schedule before blocking it.');
      const row = await tx.staffUnavailability.create({ data: { organizationId: identity.tenantId, subject: identity.subject, startsAt, endsAt, note: input.note } });
      await tx.staffUnavailabilityAudit.create({ data: { organizationId: identity.tenantId, unavailabilityId: row.id, actorId: identity.subject, action: 'created' } });
      return row;
    });
  }

  async remove(identity: Identity, id: string, key: string) {
    assertCapability(identity, 'operations:read');
    return this.command(identity, key, 'staff-unavailability.delete', { id }, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${identity.tenantId}:${identity.subject}`}, 0))`;
      const row = await tx.staffUnavailability.findFirst({ where: { id, organizationId: identity.tenantId, subject: identity.subject, deletedAt: null } });
      if (!row) throw new NotFoundException('Unavailability entry not found.');
      await tx.staffUnavailabilityAudit.create({ data: { organizationId: identity.tenantId, unavailabilityId: row.id, actorId: identity.subject, action: 'deleted' } });
      await tx.staffUnavailability.update({ where: { id }, data: { deletedAt: new Date() } });
      return { deleted: true };
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
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue } });
      return response;
    });
  }
}

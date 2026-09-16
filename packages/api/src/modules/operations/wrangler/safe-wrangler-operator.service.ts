import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { canManageVenue } from '../../../auth/roles';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReservationMutationService } from '../../reservations/reservation-mutation.service';
import { WranglerOperatorService } from './wrangler-operator.service';

@Injectable()
export class SafeWranglerOperatorService {
  private readonly parser: WranglerOperatorService;
  private readonly logger = new Logger(SafeWranglerOperatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationMutationService,
  ) {
    this.parser = new WranglerOperatorService(prisma);
  }

  async plan(input: any): Promise<any> {
    const result: any = await this.parser.plan(input);
    if (result?.status === 'confirmation_required' && result?.tool === 'CORRECT_PUNCH') {
      const entryId = result?.plan?.args?.entryId;
      if (entryId) {
        const entry = await this.prisma.timeEntry.findFirst({ where: { id: String(entryId), venueId: input.venueId }, select: { updatedAt: true } });
        if (entry) result.plan.args.expectedUpdatedAt = entry.updatedAt.toISOString();
      }
    }
    return result;
  }

  async execute(input: any): Promise<any> {
    if (!canManageVenue(input?.actor?.role, input?.actor?.allAccess)) {
      throw new ForbiddenException('Manager access required for Wrangler operator actions');
    }
    const tool = String(input.plan?.tool ?? '');
    if (!['CREATE_RESERVATION', 'UPDATE_RESERVATION', 'CORRECT_PUNCH'].includes(tool)) {
      return this.parser.execute(input);
    }
    const args = { ...(input.plan?.args ?? {}) };
    let result: any;

    if (tool === 'CREATE_RESERVATION') {
      const saved = await this.reservations.saveReservation({
        venueId: input.venueId,
        guestName: this.text(args.guestName, 'Guest name is required'),
        partySize: this.positiveInt(args.partySize, 'partySize'),
        reservationTime: this.date(args.reservationTime, 'Reservation time is required').toISOString(),
        durationMinutes: args.durationMinutes == null ? 90 : this.positiveInt(args.durationMinutes, 'durationMinutes'),
        notes: typeof args.notes === 'string' ? args.notes : undefined,
        status: 'confirmed', source: 'direct',
      });
      result = saved.reservation;
    } else if (tool === 'UPDATE_RESERVATION') {
      const id = this.text(args.reservationId, 'reservationId is required');
      const old = await this.prisma.reservation.findFirst({ where: { id, venueId: input.venueId, deletedAt: null } });
      if (!old) throw new NotFoundException('Reservation no longer exists');
      const status = args.status == null ? old.status : this.reservationStatus(args.status);
      const saved = await this.reservations.saveReservation({
        venueId: input.venueId, reservationId: old.id, guestName: old.guestName,
        partySize: args.partySize == null ? old.partySize : this.positiveInt(args.partySize, 'partySize'),
        reservationTime: args.reservationTime == null ? old.reservationTime.toISOString() : this.date(args.reservationTime, 'Invalid reservation time').toISOString(),
        durationMinutes: old.durationMinutes, status, notes: args.notes == null ? old.notes ?? undefined : String(args.notes), source: old.source,
        tags: old.tags, specialRequests: old.specialRequests ?? undefined, phone: old.guestPhone ?? undefined, email: old.guestEmail ?? undefined,
      });
      result = saved.reservation;
    } else if (tool === 'CORRECT_PUNCH') {
      const entryId = this.text(args.entryId, 'entryId is required');
      const expectedUpdatedAt = this.date(args.expectedUpdatedAt, 'Punch changed since preview. Review the latest timecard before correcting it.');
      const old = await this.prisma.timeEntry.findFirst({ where: { id: entryId, venueId: input.venueId } });
      if (!old) throw new NotFoundException('Time entry no longer exists');
      const clockInAt = args.clockInAt == null ? old.clockInAt : this.date(args.clockInAt, 'Invalid clock-in');
      const clockOutAt = args.clockOutAt == null ? old.clockOutAt : this.date(args.clockOutAt, 'Invalid clock-out');
      if (clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('Clock-out must be after clock-in');
      const changed = await this.prisma.timeEntry.updateMany({ where: { id: old.id, venueId: input.venueId, updatedAt: expectedUpdatedAt }, data: { clockInAt, clockOutAt, isOpen: clockOutAt == null } });
      if (!changed.count) throw new ConflictException('Punch changed since Wrangler reviewed it. Review the latest timecard before correcting it.');
      result = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: old.id } });
    }

    try {
      await this.prisma.auditLog.create({ data: { venueId: input.venueId, actorProfileId: input.actor.profileId, actorName: input.actor.fullName,
        actorRole: input.actor.role, entityType: 'wrangler_operator', entityId: String(result?.id ?? tool), action: `wrangler_operator_${tool.toLowerCase()}`,
        summary: String(input.plan?.summary ?? tool), metadata: { tool, safeDomainService: true } as any } });
    } catch (error) {
      // Do not make a completed operation look failed and invite a retry.
      this.logger.error(`Wrangler operator audit failed for ${tool}`, error);
    }
    return { ok: true, tool, risk: tool === 'CORRECT_PUNCH' ? 'sensitive_write' : 'operational_write', result };
  }

  private text(value: unknown, message: string) { const v = typeof value === 'string' ? value.trim() : ''; if (!v) throw new BadRequestException(message); return v; }
  private positiveInt(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${field} must be a positive whole number`); return n; }
  private minute(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 1440) throw new BadRequestException(`${field} must be between 0 and 1440`); return n; }
  private date(value: unknown, message: string) { const d = new Date(String(value ?? '')); if (Number.isNaN(d.getTime())) throw new BadRequestException(message); return d; }
  private reservationStatus(value: unknown) {
    const status = this.text(value, 'Invalid reservation status');
    if (!['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'].includes(status)) {
      throw new BadRequestException('Invalid reservation status');
    }
    return status;
  }
}

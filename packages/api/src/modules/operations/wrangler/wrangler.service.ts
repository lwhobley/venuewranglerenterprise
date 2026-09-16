import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { weekStartFor } from '../../../common/pay-period';
import { withSerializableRetry } from '../../../common/tx-retry';
import { zonedDayBounds, zonedDayOfWeek, zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildDailyBriefPriorityActions, type DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import { buildWranglerFloorActions } from './wrangler-floor-rules';
import { buildWranglerPatterns, buildWranglerRecap, answerWranglerQuestion, type WranglerSummary } from './wrangler-intelligence';
import { sortWranglerPrioritiesForPhase } from './wrangler-phase-priority';
import { buildWranglerRuleActions } from './wrangler-rules';
import { deriveWranglerServicePhase, phaseLabel, type WranglerServicePhase } from './wrangler-service-phase';

@Injectable()
export class WranglerService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(venueId: string, timezone?: string | null) {
    const now = new Date();
    const nowMs = now.getTime();
    const today = zonedIsoDate(timezone, nowMs);
    const bounds = zonedDayBounds(timezone, 0);
    const todayStart = new Date(bounds.start);
    const todayEnd = new Date(bounds.end);
    const weekStart = weekStartFor(today);
    const dayIndex = zonedDayOfWeek(timezone, nowMs);
    const fourHoursFromNow = new Date(nowMs + 4 * 60 * 60_000);
    const thirtyMinutesFromNowMs = nowMs + 30 * 60_000;

    const [
      reservations,
      pendingRequests,
      barItems,
      prepItems,
      events,
      tableStates,
      futureAssignments,
      waitlistEntries,
      posConnections,
      resConnections,
      posChecks,
    ] = await Promise.all([
      this.prisma.reservation?.findMany
        ? this.prisma.reservation.findMany({ where: { venueId, reservationTime: { gte: todayStart, lt: todayEnd }, status: { notIn: ['cancelled', 'no_show'] } }, orderBy: { reservationTime: 'asc' }, take: 200 })
        : Promise.resolve([]),
      this.prisma.staffRequest?.findMany
        ? this.prisma.staffRequest.findMany({ where: { venueId, status: 'pending' }, select: { id: true }, take: 100 })
        : Promise.resolve([]),
      this.prisma.barInventoryItem?.findMany
        ? this.prisma.barInventoryItem.findMany({ where: { venueId }, orderBy: { name: 'asc' }, take: 300 })
        : Promise.resolve([]),
      this.prisma.prepBoardItem?.findMany
        ? this.prisma.prepBoardItem.findMany({ where: { venueId, status: 'open', OR: [{ dueDate: null }, { dueDate: { lte: today } }] }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }], take: 100 })
        : Promise.resolve([]),
      this.prisma.venueEvent?.findMany
        ? this.prisma.venueEvent.findMany({ where: { venueId, startsAt: { gte: todayStart, lt: todayEnd } }, orderBy: { startsAt: 'asc' }, take: 20 })
        : Promise.resolve([]),
      this.prisma.tableState?.findMany
        ? this.prisma.tableState.findMany({ where: { venueId }, include: { table: { select: { id: true, label: true, seats: true, section: true, isReservable: true } } }, take: 300 })
        : Promise.resolve([]),
      this.prisma.tableAssignment?.findMany
        ? this.prisma.tableAssignment.findMany({ where: { venueId, releasedAt: null, endsAt: { gt: now }, startsAt: { lt: fourHoursFromNow } }, include: { table: { select: { id: true, label: true, section: true } }, reservation: { select: { id: true, guestName: true, partySize: true, tags: true, status: true } } }, orderBy: { startsAt: 'asc' }, take: 300 })
        : Promise.resolve([]),
      this.prisma.waitlist?.findMany
        ? this.prisma.waitlist.findMany({ where: { venueId, status: 'waiting' }, take: 100 })
        : Promise.resolve([]),
      this.prisma.posConnection?.findMany
        ? this.prisma.posConnection.findMany({ where: { venueId } })
        : Promise.resolve([]),
      this.prisma.reservationConnection?.findMany
        ? this.prisma.reservationConnection.findMany({ where: { venueId } })
        : Promise.resolve([]),
      this.prisma.posCheck?.findMany
        ? this.prisma.posCheck.findMany({ where: { venueId, openedAt: { gte: todayStart, lt: todayEnd } }, take: 200 })
        : Promise.resolve([]),
    ]);

    const lowStockItems = barItems.filter((item) => item.onHand <= item.parLevel);
    const eightySixCount = prepItems.filter((item) => item.kind === 'eighty_six').length;
    const seatedTables = tableStates.filter((table) => table.status === 'seated').length;
    const servicePhase = deriveWranglerServicePhase({ now: nowMs, reservations: reservations.map((reservation) => ({ reservationTime: reservation.reservationTime.getTime(), durationMinutes: reservation.durationMinutes, status: reservation.status })), seatedTables });

    const eventPriorities = buildDailyBriefPriorityActions({ pendingRequestCount: pendingRequests.length, lowStockCount: lowStockItems.length, eightySixCount, events: events.map((event) => ({ title: event.title, startsAt: event.startsAt.getTime(), expectedGuests: event.expectedGuests, reservationGuestName: null, reservationPartySize: null, notes: event.notes })) });
    const rulePriorities = buildWranglerRuleActions({ now: nowMs, reservations: reservations.map((reservation) => ({ id: reservation.id, guestName: reservation.guestName, partySize: reservation.partySize, reservationTime: reservation.reservationTime.getTime(), tags: reservation.tags })), lowStockCount: lowStockItems.length, eightySixCount });
    const upcomingAssignments = futureAssignments.filter((assignment) => assignment.startsAt.getTime() >= nowMs && assignment.startsAt.getTime() <= thirtyMinutesFromNowMs && assignment.reservation && !['cancelled', 'no_show', 'completed'].includes(assignment.reservation.status));
    const floorPriorities = buildWranglerFloorActions({ now: nowMs, tables: tableStates.map((tableState) => ({ tableId: tableState.tableId, label: tableState.table.label, status: tableState.status, seatedAt: tableState.seatedAt?.getTime() ?? null })), upcomingAssignments: upcomingAssignments.map((assignment) => { const alternate = this.findAlternateTable({ assignment, tableStates, futureAssignments }); return { assignmentId: assignment.id, tableId: assignment.tableId, tableLabel: assignment.table.label, startsAt: assignment.startsAt.getTime(), endsAt: assignment.endsAt.getTime(), reservationId: assignment.reservation?.id ?? null, guestName: assignment.reservation?.guestName ?? null, partySize: assignment.reservation?.partySize ?? null, tags: assignment.reservation?.tags ?? [], alternateTableId: alternate?.tableId ?? null, alternateTableLabel: alternate?.label ?? null }; }) });

    const priorities = this.mergePriorities([...floorPriorities, ...rulePriorities, ...eventPriorities], servicePhase);
    
    const allConnections = [...posConnections, ...resConnections];
    const connectedCount = allConnections.filter((c) => c.status === 'connected').length;
    const disconnectedCount = allConnections.filter((c) => c.status !== 'connected').length;
    const totalSalesCents = posChecks.reduce((sum, c) => sum + (c.totalCents ?? 0), 0);
    const openChecksCount = posChecks.filter((c) => c.status === 'open').length;

    const summary: WranglerSummary = {
      covers: reservations.reduce((sum, reservation) => sum + reservation.partySize, 0),
      reservations: reservations.length,
      vipArrivals: reservations.filter((reservation) => reservation.tags.some((tag) => tag.toLowerCase().includes('vip'))).length,
      lowStockItems: lowStockItems.length,
      eightySixItems: eightySixCount,
      pendingStaffRequests: pendingRequests.length,
      seatedTables,
      activeWaitlist: waitlistEntries.length,
      totalSalesCents,
      openChecksCount,
      connectedIntegrationsCount: connectedCount,
      disconnectedIntegrationsCount: disconnectedCount,
    };

    return {
      generatedAt: nowMs,
      date: today,
      servicePhase,
      servicePhaseLabel: phaseLabel(servicePhase),
      summary,
      status: priorities.some((item) => item.severity === 'critical') ? 'critical' : priorities.some((item) => item.severity === 'warning') ? 'attention' : priorities.some((item) => item.severity === 'watch') ? 'watch' : 'clear',
      priorities,
      recap: buildWranglerRecap({ phase: servicePhase, summary, priorities }),
      patterns: buildWranglerPatterns({ summary, priorities }),
    };
  }

  async ask(venueId: string, timezone: string | null | undefined, question: string) {
    const snapshot = await this.getSnapshot(venueId, timezone);
    return answerWranglerQuestion(question, { phaseLabel: snapshot.servicePhaseLabel, summary: snapshot.summary, priorities: snapshot.priorities });
  }

  async executeAction(venueId: string, input: { type: 'REASSIGN_RESERVATION'; reservationId?: string; tableId?: string }) {
    if (input.type !== 'REASSIGN_RESERVATION') throw new BadRequestException('Unsupported Wrangler action');
    if (!input.reservationId || !input.tableId) throw new BadRequestException('reservationId and tableId are required');
    const reservationId = input.reservationId;
    const tableId = input.tableId;
    const reassignment = await withSerializableRetry(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservation-holds:${venueId}`}))`;
      const reservation = await tx.reservation.findFirst({
        where: { id: reservationId, venueId, deletedAt: null, status: { notIn: ['cancelled', 'no_show', 'completed'] } },
        select: { id: true, partySize: true, reservationTime: true, durationMinutes: true },
      });
      if (!reservation) throw new ConflictException('Reservation is no longer active');
      const table = await tx.floorTable.findFirst({
        where: { id: tableId, floorPlan: { venueId, isActive: true }, isReservable: true, seats: { gte: reservation.partySize } },
        select: { id: true, label: true },
      });
      if (!table) throw new ConflictException('Recommended table is no longer eligible');
      const startsAt = reservation.reservationTime;
      const endsAt = new Date(startsAt.getTime() + reservation.durationMinutes * 60_000);
      const currentState = await tx.tableState.findFirst({ where: { venueId, tableId: table.id }, select: { status: true } });
      if (!currentState || currentState.status !== 'available') throw new ConflictException(`${table.label} is no longer available`);
      const conflict = await tx.tableAssignment.findFirst({ where: { venueId, tableId: table.id, releasedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, NOT: { reservationId: reservation.id } }, select: { id: true } });
      if (conflict) throw new ConflictException(`${table.label} is already booked for this time window`);
      await tx.tableAssignment.updateMany({ where: { venueId, reservationId: reservation.id, releasedAt: null }, data: { releasedAt: new Date(), releasedReason: 'wrangler_reassigned' } });
      await tx.tableAssignment.create({ data: { venueId, reservationId: reservation.id, tableId: table.id, holdType: 'reserved', startsAt, endsAt } });
      await tx.tableState.updateMany({ where: { venueId, tableId: table.id }, data: { status: 'reserved', partySize: reservation.partySize, seatedAt: null, lastActivityAt: new Date() } });
      return { reservation, table };
    });
    return { ok: true, type: input.type, reservationId: reassignment.reservation.id, tableId: reassignment.table.id, tableLabel: reassignment.table.label };
  }

  private findAlternateTable(args: { assignment: { id: string; tableId: string; startsAt: Date; endsAt: Date; table: { section: string }; reservation: { partySize: number } | null }; tableStates: Array<{ tableId: string; status: string; table: { label: string; seats: number; section: string; isReservable: boolean } }>; futureAssignments: Array<{ tableId: string; startsAt: Date; endsAt: Date; releasedAt: Date | null }> }) {
    const partySize = args.assignment.reservation?.partySize ?? 0;
    const candidates = args.tableStates.filter((state) => state.tableId !== args.assignment.tableId && state.status === 'available' && state.table.isReservable && state.table.seats >= partySize).filter((state) => !args.futureAssignments.some((other) => other.tableId === state.tableId && other.releasedAt == null && other.startsAt < args.assignment.endsAt && other.endsAt > args.assignment.startsAt)).sort((a, b) => { const aSameSection = a.table.section === args.assignment.table.section ? 0 : 1; const bSameSection = b.table.section === args.assignment.table.section ? 0 : 1; if (aSameSection !== bSameSection) return aSameSection - bSameSection; const aExtraSeats = a.table.seats - partySize; const bExtraSeats = b.table.seats - partySize; if (aExtraSeats !== bExtraSeats) return aExtraSeats - bExtraSeats; return a.table.label.localeCompare(b.table.label); });
    const best = candidates[0];
    return best ? { tableId: best.tableId, label: best.table.label } : null;
  }

  private mergePriorities(items: DailyBriefPriorityAction[], phase: WranglerServicePhase) {
    const seen = new Set<string>();
    return sortWranglerPrioritiesForPhase(items, phase).filter((item) => { const key = item.kind === 'event' ? `event:${item.id}` : item.kind; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 6);
  }
}

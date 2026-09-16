import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth.guard';
import { isAdminRole } from '../../auth/roles';
import { Public } from '../../auth/public.decorator';
import { SkipVenueScope } from '../../venue/skip-venue-scope.decorator';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { parseTimeBreaks } from '../../common/break-duration';
import { ALLOWED_IMAGE_MIME, assertAllowedImageBytes } from '../../common/image-bytes';
import { isActiveMembership } from '../../common/membership';
import { todayInZone, weekStartFor } from '../../common/pay-period';
import { zonedDayBounds, zonedDayOfWeek, zonedIsoDate } from '../../common/venue-time';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessService } from '../chat/media-access.service';
import { S3ImageService } from '../chat/s3-image.service';
import { buildDailyBriefAlerts } from './daily-brief-alerts';
import { buildDailyBriefPriorityActions } from './daily-brief-priority-actions';
import { buildDailyBriefProfitabilityPulse } from './daily-brief-profitability';
import { ExecutionAutopilotService } from './execution-autopilot.service';

const GOAL_PERIODS = ['day', 'week'] as const;
const GOAL_STATUSES = ['open', 'done', 'cancelled'] as const;
const LOGBOOK_CATEGORIES = ['handoff', 'incident', 'maintenance', 'general'] as const;
const CHECKLIST_KINDS = ['opening', 'closing'] as const;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type ManagerGoalPeriod = (typeof GOAL_PERIODS)[number];
type ManagerGoalStatus = (typeof GOAL_STATUSES)[number];

class UpsertManagerGoalDto {
  @IsString()
  @IsOptional()
  goalId?: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  details?: string;

  @IsIn(GOAL_PERIODS)
  period!: ManagerGoalPeriod;

  @IsString()
  targetDate!: string;

  @IsIn(GOAL_STATUSES)
  status!: ManagerGoalStatus;
}

class LogbookEntryDto {
  @IsString()
  category!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

class ChecklistTemplateItemDto {
  @IsIn(CHECKLIST_KINDS)
  kind!: (typeof CHECKLIST_KINDS)[number];

  @IsString()
  title!: string;

  @IsOptional()
  @IsBoolean()
  requiresPhoto?: boolean;
}

class CompleteChecklistItemDto {
  @IsOptional()
  @IsString()
  photoBase64?: string;

  @IsOptional()
  @IsIn([...ALLOWED_IMAGE_MIME])
  photoMimeType?: string;
}

class UpdateExecutionTaskDto {
  @IsIn(['open', 'done'])
  status!: 'open' | 'done';
}

class UpdateExecutionTimelineDto {
  @IsIn(['pending', 'done'])
  status!: 'pending' | 'done';
}

class UpdateExecutionVendorDto {
  @IsIn(['unconfirmed', 'confirmed', 'arrived'])
  status!: 'unconfirmed' | 'confirmed' | 'arrived';
}

class UpdateExecutionIncidentDto {
  @IsIn(['open', 'resolved'])
  status!: 'open' | 'resolved';
}

class CreateExecutionIncidentDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsIn(['low', 'high'])
  severity?: string;

  @IsOptional()
  @IsBoolean()
  blocksReadiness?: boolean;
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function mapGoal(goal: {
  id: string;
  venueId: string;
  title: string;
  details: string | null;
  period: string;
  targetDate: string;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: goal.id,
    venueId: goal.venueId,
    title: goal.title,
    details: goal.details ?? null,
    period: goal.period,
    targetDate: goal.targetDate,
    status: goal.status,
    completedAt: toMs(goal.completedAt),
    createdAt: goal.createdAt.getTime(),
    updatedAt: goal.updatedAt.getTime(),
  };
}

function mapEvent(
  event: {
    id: string;
    venueId: string;
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    expectedGuests: number | null;
    notes: string | null;
    reservationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  reservation: {
    notes: string | null;
    specialRequests: string | null;
    guestName: string;
    partySize: number;
  } | null,
) {
  return {
    _id: event.id,
    venueId: event.venueId,
    title: event.title,
    startsAt: event.startsAt.getTime(),
    endsAt: toMs(event.endsAt),
    expectedGuests: event.expectedGuests ?? null,
    notes: event.notes ?? null,
    reservationId: event.reservationId ?? null,
    reservationNotes: reservation?.notes ?? reservation?.specialRequests ?? null,
    reservationGuestName: reservation?.guestName ?? null,
    reservationPartySize: reservation?.partySize ?? null,
    createdAt: event.createdAt.getTime(),
    updatedAt: event.updatedAt.getTime(),
  };
}

function mapLogbookEntry(entry: {
  id: string;
  authorProfileId: string;
  authorName: string;
  category: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: entry.id,
    authorProfileId: entry.authorProfileId,
    authorName: entry.authorName,
    category: entry.category,
    body: entry.body,
    pinned: entry.pinned,
    createdAt: entry.createdAt.getTime(),
    updatedAt: entry.updatedAt.getTime(),
  };
}

function mapChecklistItem(item: { id: string; kind: string; title: string; sortOrder: number; requiresPhoto: boolean }) {
  return {
    _id: item.id,
    kind: item.kind,
    title: item.title,
    sortOrder: item.sortOrder,
    requiresPhoto: item.requiresPhoto,
  };
}

@Controller('v1/operations')
@UseGuards(AuthGuard)
export class OperationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaAccess: MediaAccessService,
    private readonly s3ImageService: S3ImageService,
    @Optional() private readonly executionAutopilot?: ExecutionAutopilotService,
  ) {}

  @RequireSubscription('active')
  @Get('manager-dashboard')
  async getManagerDashboard(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const timezone = profile.venue?.timezone;
    const today = zonedIsoDate(timezone, now.getTime());
    const todayBounds = zonedDayBounds(timezone, 0);
    const todayStart = new Date(todayBounds.start);
    const todayEnd = new Date(todayBounds.end);
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [reservations, goals, venueEvents] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { venueId },
        take: 500,
        orderBy: { reservationTime: 'desc' },
      }),
      this.prisma.managerGoal.findMany({
        where: { venueId },
        take: 50,
        orderBy: { targetDate: 'desc' },
      }),
      this.prisma.venueEvent.findMany({
        where: {
          venueId,
          startsAt: { gte: todayStart, lte: weekEnd },
        },
        take: 50,
        orderBy: { startsAt: 'asc' },
      }),
    ]);

    const upcomingReservations = reservations.filter(
      (r) =>
        r.reservationTime >= now &&
        r.reservationTime <= weekEnd &&
        r.status !== 'cancelled',
    );

    const vipOrLargeReservations = upcomingReservations
      .filter(
        (r) =>
          r.partySize >= 8 ||
          r.tags.some((tag) => tag.toLowerCase().includes('vip')),
      )
      .sort((a, b) => a.reservationTime.getTime() - b.reservationTime.getTime())
      .slice(0, 8)
      .map((r) => ({
        _id: r.id,
        guestName: r.guestName,
        partySize: r.partySize,
        reservationTime: r.reservationTime.getTime(),
        tags: r.tags,
        notes: r.notes ?? r.specialRequests ?? null,
      }));

    const todayReservations = reservations.filter(
      (r) =>
        r.reservationTime >= todayStart && r.reservationTime < todayEnd,
    ).length;

    const filteredGoals = goals
      .filter((g) => g.status === 'open' || g.targetDate >= today)
      .slice(0, 8)
      .map(mapGoal);

    const visibleEvents = venueEvents.slice(0, 8);
    const reservationIds = visibleEvents
      .map((event) => event.reservationId)
      .filter((id): id is string => Boolean(id));
    const reservationsById = reservationIds.length
      ? new Map(
          (
            await this.prisma.reservation.findMany({
              where: { id: { in: reservationIds } },
              select: {
                id: true,
                notes: true,
                specialRequests: true,
                guestName: true,
                partySize: true,
              },
            })
          ).map((reservation) => [reservation.id, reservation]),
        )
      : new Map<string, { id: string; notes: string | null; specialRequests: string | null; guestName: string; partySize: number }>();

    const eventRows = visibleEvents.map((event) => mapEvent(event, event.reservationId ? reservationsById.get(event.reservationId) ?? null : null));

    return {
      totalReservations: reservations.length,
      todayReservations,
      vipOrLargeReservations,
      goals: filteredGoals,
      events: eventRows,
    };
  }

  @RequireSubscription('active')
  @Get('daily-brief')
  async getDailyBrief(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const timezone = profile.venue?.timezone;
    const today = zonedIsoDate(timezone, now.getTime());
    const weekStart = weekStartFor(today);
    const todayBounds = zonedDayBounds(timezone, 0);
    const tomorrowBounds = zonedDayBounds(timezone, 1);
    const todayStart = new Date(todayBounds.start);
    const todayEnd = new Date(todayBounds.end);
    const tomorrowEnd = new Date(tomorrowBounds.end);

    const [
      reservations,
      openTimeEntries,
      timeEntriesToday,
      pendingRequests,
      barItems,
      prepItems,
      goals,
      events,
      posChecks,
      openChecksCount,
    ] = await Promise.all([
      this.prisma.reservation.findMany({
        where: {
          venueId,
          reservationTime: { gte: todayStart, lt: todayEnd },
          status: { notIn: ['cancelled', 'no_show'] },
        },
        orderBy: { reservationTime: 'asc' },
        take: 100,
      }),
      this.prisma.timeEntry.findMany({
        where: { venueId, isOpen: true },
        select: { id: true },
        take: 200,
      }),
      this.prisma.timeEntry.findMany({
        where: {
          venueId,
          clockInAt: { lt: tomorrowEnd },
          OR: [{ clockOutAt: null }, { clockOutAt: { gte: todayStart } }],
        },
        select: { clockInAt: true, clockOutAt: true, breaks: true, isOpen: true },
      }),
      this.prisma.staffRequest.findMany({
        where: { venueId, status: 'pending' },
        select: { id: true },
        take: 100,
      }),
      this.prisma.barInventoryItem.findMany({
        where: { venueId },
        orderBy: { name: 'asc' },
        take: 300,
      }),
      this.prisma.prepBoardItem.findMany({
        where: {
          venueId,
          status: 'open',
          OR: [{ dueDate: null }, { dueDate: { lte: today } }],
        },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        take: 50,
      }),
      this.prisma.managerGoal.findMany({
        where: { venueId, status: 'open', targetDate: today },
        orderBy: { createdAt: 'asc' },
        take: 8,
      }),
      this.prisma.venueEvent.findMany({
        where: { venueId, startsAt: { gte: todayStart, lt: tomorrowEnd } },
        orderBy: { startsAt: 'asc' },
        take: 8,
      }),
      this.prisma.posCheck.findMany({
        where: { venueId, openedAt: { gte: todayStart, lt: todayEnd }, status: { not: 'void' } },
        select: { totalCents: true, guestCount: true },
        take: 1000,
      }),
      this.prisma.posCheck.count({ where: { venueId, status: 'open' } }),
    ]);

    const lowStockItems = barItems.filter((item) => item.onHand <= item.parLevel).slice(0, 8);
    const reservationsById = new Map(reservations.map((reservation) => [reservation.id, reservation]));
    const covers = reservations.reduce((sum, row) => sum + row.partySize, 0);
    const posCovers = posChecks.reduce((sum, row) => sum + (row.guestCount ?? 0), 0);
    const salesCents = posChecks.reduce((sum, row) => sum + row.totalCents, 0);
    const prepOpenCount = prepItems.filter((item) => item.kind === 'prep').length;
    const eightySixCount = prepItems.filter((item) => item.kind === 'eighty_six').length;

    const alerts = buildDailyBriefAlerts({
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
    });
    const priorityActions = buildDailyBriefPriorityActions({
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
      events: events.map((event) => {
        const reservation = event.reservationId ? reservationsById.get(event.reservationId) ?? null : null;
        return {
          title: event.title,
          startsAt: event.startsAt.getTime(),
          expectedGuests: event.expectedGuests,
          reservationGuestName: reservation?.guestName ?? null,
          reservationPartySize: reservation?.partySize ?? null,
          notes: event.notes ?? reservation?.notes ?? reservation?.specialRequests ?? null,
        };
      }),
    });
    const laborHours = Math.round(
      timeEntriesToday.reduce((sum, entry) => {
        const startMs = todayStart.getTime();
        const endMs = Math.min(entry.clockOutAt?.getTime() ?? now.getTime(), todayEnd.getTime());
        if (endMs <= startMs || entry.clockInAt.getTime() >= todayEnd.getTime()) return sum;
        const entryStart = Math.max(entry.clockInAt.getTime(), startMs);
        let durationMs = Math.max(0, endMs - entryStart);
        for (const rawBreak of parseTimeBreaks(entry.breaks)) {
          if (rawBreak?.type !== 'unpaid' || rawBreak.startAt == null || rawBreak.endAt == null) continue;
          const breakStart = Math.max(Number(rawBreak.startAt), entryStart, startMs);
          const breakEnd = Math.min(Number(rawBreak.endAt), endMs);
          if (Number.isFinite(breakStart) && Number.isFinite(breakEnd) && breakEnd > breakStart) {
            durationMs -= breakEnd - breakStart;
          }
        }
        return sum + Math.max(0, durationMs) / 3600000;
      }, 0) * 10,
    ) / 10;
    const profitabilityPulse = buildDailyBriefProfitabilityPulse({
      salesCents,
      laborHours,
      openChecks: openChecksCount,
      activeClocks: openTimeEntries.length,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      eightySixCount,
    });

    return {
      date: today,
      covers,
      posCovers,
      salesCents,
      clockedInCount: openTimeEntries.length,
      pendingRequestCount: pendingRequests.length,
      lowStockCount: lowStockItems.length,
      prepOpenCount,
      eightySixCount,
      alerts,
      reservations: reservations.slice(0, 6).map((reservation) => ({
        _id: reservation.id,
        guestName: reservation.guestName,
        partySize: reservation.partySize,
        reservationTime: reservation.reservationTime.getTime(),
        tags: reservation.tags,
        notes: reservation.notes ?? reservation.specialRequests ?? null,
      })),
      prepItems: prepItems.slice(0, 8).map((item) => ({
        _id: item.id,
        kind: item.kind,
        title: item.title,
        quantity: item.quantity,
        unit: item.unit,
        station: item.station,
        dueDate: item.dueDate,
      })),
      lowStockItems: lowStockItems.map((item) => ({
        _id: item.id,
        name: item.name,
        onHand: item.onHand,
        parLevel: item.parLevel,
        unit: item.unit,
      })),
      goals: goals.map(mapGoal),
      events: events.map((event) => ({
        _id: event.id,
        title: event.title,
        startsAt: event.startsAt.getTime(),
        expectedGuests: event.expectedGuests,
      })),
      priorityActions,
      profitabilityPulse,
    };
  }

  @RequireSubscription('active')
  @Get('command-center')
  async getCommandCenter(@CurrentUser() user: AuthUser) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const timezone = profile.venue?.timezone;
    const now = new Date();
    const today = zonedIsoDate(timezone, now.getTime());
    const weekStart = weekStartFor(today);
    const bounds = zonedDayBounds(timezone, 0);
    const todayStart = new Date(bounds.start);
    const todayEnd = new Date(bounds.end);
    const dayIndex = zonedDayOfWeek(timezone, now.getTime());
    const [events, reservations, checklistItems, checklistCompletions, floorPlan, beos] = await Promise.all([
      this.prisma.venueEvent.findMany({ where: { venueId, startsAt: { gte: todayStart, lt: todayEnd } }, orderBy: { startsAt: 'asc' }, take: 50 }),
      this.prisma.reservation.findMany({
        where: { venueId, reservationTime: { gte: todayStart, lt: todayEnd }, status: { notIn: ['cancelled', 'no_show'] } },
        include: { tableAssignments: { where: { releasedAt: null }, select: { id: true } } },
        orderBy: { reservationTime: 'asc' }, take: 200,
      }),
      this.prisma.checklistTemplateItem.findMany({ where: { venueId, kind: 'opening', active: true }, orderBy: { sortOrder: 'asc' }, take: 100 }),
      this.prisma.checklistCompletion.findMany({ where: { venueId, date: today }, select: { templateItemId: true, status: true } }),
      this.prisma.floorPlan.findFirst({ where: { venueId, isActive: true }, include: { tables: { select: { id: true, label: true, section: true } } } }),
      this.prisma.crmBeo.findMany({ where: { venueId, eventDate: { gte: todayStart, lt: todayEnd }, status: { not: 'cancelled' } }, orderBy: { eventDate: 'asc' }, take: 50 }),
    ]);

    const prepItems = await this.prisma.prepBoardItem.findMany({
      where: { venueId, status: 'open', kind: { not: 'event_execution' }, OR: [{ dueDate: null }, { dueDate: { lte: today } }] },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    const executionSources = [
      ...events.map((event) => ({ sourceType: 'venue-event', sourceId: event.id })),
      ...reservations.filter((reservation) => reservation.isPrivateEvent).map((reservation) => ({ sourceType: 'reservation', sourceId: reservation.id })),
      ...beos.map((beo) => ({ sourceType: 'beo', sourceId: beo.id })),
    ];
    const executionWorkspaces = executionSources.length === 0 ? [] : await this.prisma.eventExecutionWorkspace.findMany({
      where: { venueId, OR: executionSources },
      include: {
        tasks: true,
        timeline: true,
        vendors: true,
        incidents: true,
      },
      take: 150,
    });
    const dueExecutionTimeline = executionWorkspaces.flatMap((workspace) => workspace.timeline).filter((item) => item.status !== 'done' && item.startsAt <= now);
    const openExecutionTasks = executionWorkspaces.flatMap((workspace) => workspace.tasks).filter((task) => task.status !== 'done');
    const unreadyExecutionVendors = executionWorkspaces.flatMap((workspace) => workspace.vendors).filter((vendor) => vendor.status !== 'arrived');
    const blockingExecutionIncidents = executionWorkspaces.flatMap((workspace) => workspace.incidents).filter((incident) => incident.status === 'open' && incident.blocksReadiness);
    const executionItemCount = executionWorkspaces.reduce((total, workspace) => total
      + workspace.tasks.length
      + workspace.timeline.filter((item) => item.startsAt <= now).length
      + workspace.vendors.length
      + workspace.incidents.filter((incident) => incident.blocksReadiness).length, 0);
    const openExecutionItemCount = openExecutionTasks.length + dueExecutionTimeline.length + unreadyExecutionVendors.length + blockingExecutionIncidents.length;
    const executionScore = executionItemCount === 0 ? 1 : Math.max(0, 1 - openExecutionItemCount / executionItemCount);
    const workspaceBySource = new Map(executionWorkspaces.map((workspace) => [`${workspace.sourceType}:${workspace.sourceId}`, workspace]));
    const workspaceHasBlockers = (workspace: (typeof executionWorkspaces)[number] | undefined) => workspace ? workspace.tasks.some((task) => task.status !== 'done')
      || workspace.timeline.some((item) => item.status !== 'done' && item.startsAt <= now)
      || workspace.vendors.some((vendor) => vendor.status !== 'arrived')
      || workspace.incidents.some((incident) => incident.status === 'open' && incident.blocksReadiness) : false;

    const incompleteChecklist = checklistItems.filter((item) => checklistCompletions.find((completion) => completion.templateItemId === item.id)?.status !== 'done');
    const unassignedReservations = reservations.filter((reservation) => reservation.tableAssignments.length === 0);
    const unconfirmedBeos = beos.filter((beo) => beo.status !== 'confirmed');
    const setupOpen = prepItems.length + incompleteChecklist.length;
    const setupTotal = checklistItems.length + setupOpen;
    const setupScore = setupOpen === 0 ? 1 : Math.max(0, 1 - setupOpen / Math.max(1, setupTotal));
    const floorScore = reservations.length === 0 ? 1 : (reservations.length - unassignedReservations.length) / reservations.length;
    const approvalScore = beos.length === 0 ? 1 : (beos.length - unconfirmedBeos.length) / beos.length;
    // Staffing carried 25 points before the schedule was removed; the rest
    // are scaled up proportionally so the score still reads out of 100.
    const score = Math.round(setupScore * 27 + floorScore * 20 + approvalScore * 13 + executionScore * 40);
    const blockers = [
      ...prepItems.slice(0, 8).map((item) => ({ code: 'OPEN_PREP', severity: 'blocker', title: item.title, detail: `${item.station || 'Operations'} prep is still open.`, targetId: item.id })),
      ...incompleteChecklist.slice(0, 8).map((item) => ({ code: 'OPEN_CHECKLIST', severity: 'blocker', title: item.title, detail: 'Opening checklist item is incomplete.', targetId: item.id })),
      ...unassignedReservations.slice(0, 8).map((reservation) => ({ code: 'UNASSIGNED_TABLE', severity: 'warning', title: `${reservation.guestName} needs a table`, detail: `${reservation.partySize} covers are not assigned on the floor plan.`, targetId: reservation.id })),
      ...unconfirmedBeos.slice(0, 8).map((beo) => ({ code: 'BEO_NOT_CONFIRMED', severity: 'warning', title: `${beo.eventName} is not confirmed`, detail: 'Review the CRM event brief before service.', targetId: beo.id })),
      ...openExecutionTasks.slice(0, 8).map((task) => ({ code: 'OPEN_EXECUTION_TASK', severity: 'blocker', title: task.title, detail: `${task.department || 'Operations'} task is incomplete.`, targetId: task.id })),
      ...dueExecutionTimeline.slice(0, 8).map((item) => ({ code: 'TIMELINE_LATE', severity: 'blocker', title: item.title, detail: 'Run-of-show milestone is behind.', targetId: item.id })),
      ...unreadyExecutionVendors.slice(0, 8).map((vendor) => ({ code: 'VENDOR_NOT_READY', severity: 'blocker', title: `${vendor.name} is not ready`, detail: 'Confirm and mark the vendor arrived.', targetId: vendor.id })),
      ...blockingExecutionIncidents.slice(0, 8).map((incident) => ({ code: 'BLOCKING_INCIDENT', severity: 'blocker', title: incident.title, detail: 'Resolve the blocking incident.', targetId: incident.id })),
    ];
    const status = blockers.some((item) => item.severity === 'blocker') ? 'blocked' : blockers.length ? 'at-risk' : 'on-track';
    const reservationById = new Map(reservations.map((reservation) => [reservation.id, reservation]));
    const eventRows = [
      ...events.map((event) => {
        const workspace = workspaceBySource.get(`venue-event:${event.id}`) ?? (event.reservationId ? workspaceBySource.get(`reservation:${event.reservationId}`) : undefined);
        const floorReady = Boolean(event.reservationId && reservationById.get(event.reservationId)?.tableAssignments.length);
        return { _id: event.id, title: event.title, startsAt: event.startsAt.getTime(), endsAt: toMs(event.endsAt), expectedGuests: event.expectedGuests, reservationId: event.reservationId, readiness: workspace ? (!workspaceHasBlockers(workspace) && (!event.reservationId || floorReady) ? 'ready' : 'watch') : (floorReady ? 'ready' : 'watch') };
      }),
      ...reservations.filter((reservation) => reservation.isPrivateEvent && !events.some((event) => event.reservationId === reservation.id)).map((reservation) => ({ _id: reservation.id, title: reservation.eventName || 'Private event', startsAt: reservation.reservationTime.getTime(), endsAt: reservation.reservationTime.getTime() + reservation.durationMinutes * 60_000, expectedGuests: reservation.partySize, reservationId: reservation.id, readiness: reservation.tableAssignments.length && !workspaceHasBlockers(workspaceBySource.get(`reservation:${reservation.id}`)) ? 'ready' : 'watch' })),
    ];

    return {
      date: today,
      readiness: { score, status, categories: { setup: Math.round(setupScore * 100), floor: Math.round(floorScore * 100), approvals: Math.round(approvalScore * 100), execution: Math.round(executionScore * 100) } },
      blockers,
      events: eventRows,
      setup: { prepOpen: prepItems.length, checklistOpen: incompleteChecklist.length },
      floor: { tableCount: floorPlan?.tables.length ?? 0, unassignedReservations: unassignedReservations.length },
      approvals: { open: unconfirmedBeos.length, total: beos.length },
    };
  }

  @RequireSubscription('active')
  @Patch('command-center/tasks/:taskId')
  async updateExecutionTask(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string, @Body() body: UpdateExecutionTaskDto) {
    const profile = await this.requireManagerProfile(user);
    const executionTask = await this.prisma.eventExecutionTask.findFirst({ where: { id: taskId, venueId: profile.venueId! } });
    if (executionTask) {
      const updated = await this.prisma.eventExecutionTask.update({ where: { id: executionTask.id }, data: { status: body.status, completedBy: body.status === 'done' ? profile.id : null, completedAt: body.status === 'done' ? new Date() : null } });
      await this.prisma.auditLog.create({ data: { venueId: profile.venueId!, actorProfileId: profile.id, actorName: profile.fullName, actorRole: profile.role, entityType: 'event_execution_task', entityId: executionTask.id, action: body.status === 'done' ? 'execution_task_completed' : 'execution_task_reopened', summary: `${body.status === 'done' ? 'Completed' : 'Reopened'} event task: ${executionTask.title}` } });
      return { _id: updated.id, title: updated.title, status: updated.status, completedAt: toMs(updated.completedAt) };
    }
    throw new NotFoundException('Execution task not found');
  }

  @RequireSubscription('active')
  @Patch('command-center/timeline/:itemId')
  async updateExecutionTimeline(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string, @Body() body: UpdateExecutionTimelineDto) {
    const profile = await this.requireManagerProfile(user);
    const item = await this.prisma.eventExecutionTimelineItem.findFirst({ where: { id: itemId, venueId: profile.venueId! } });
    if (!item) throw new NotFoundException('Timeline item not found');
    const updated = await this.prisma.eventExecutionTimelineItem.update({ where: { id: item.id }, data: { status: body.status, completedAt: body.status === 'done' ? new Date() : null } });
    await this.prisma.auditLog.create({ data: { venueId: profile.venueId!, actorProfileId: profile.id, actorName: profile.fullName, actorRole: profile.role, entityType: 'event_execution_timeline', entityId: item.id, action: body.status === 'done' ? 'timeline_item_completed' : 'timeline_item_reopened', summary: `${body.status === 'done' ? 'Completed' : 'Reopened'} timeline item: ${item.title}` } });
    return { _id: updated.id, status: updated.status, completedAt: toMs(updated.completedAt) };
  }

  @RequireSubscription('active')
  @Patch('command-center/vendors/:vendorId')
  async updateExecutionVendor(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() body: UpdateExecutionVendorDto) {
    const profile = await this.requireManagerProfile(user);
    const vendor = await this.prisma.eventExecutionVendor.findFirst({ where: { id: vendorId, venueId: profile.venueId! } });
    if (!vendor) throw new NotFoundException('Execution vendor not found');
    const now = new Date();
    const updated = await this.prisma.eventExecutionVendor.update({ where: { id: vendor.id }, data: { status: body.status, ...(body.status === 'confirmed' ? { confirmedAt: now } : {}), ...(body.status === 'arrived' ? { confirmedAt: vendor.confirmedAt ?? now, arrivedAt: now } : {}) } });
    await this.prisma.auditLog.create({ data: { venueId: profile.venueId!, actorProfileId: profile.id, actorName: profile.fullName, actorRole: profile.role, entityType: 'event_execution_vendor', entityId: vendor.id, action: 'vendor_status_updated', summary: `${vendor.name} marked ${body.status}` } });
    return { _id: updated.id, name: updated.name, status: updated.status, arrivedAt: toMs(updated.arrivedAt) };
  }

  @RequireSubscription('active')
  @Post('command-center/events/:eventId/incidents')
  async createExecutionIncident(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string, @Body() body: CreateExecutionIncidentDto) {
    const profile = await this.requireManagerProfile(user);
    const source = await this.getExecutionSource(profile.venueId!, eventId);
    if (!source) throw new NotFoundException('Event not found');
    const workspace = await this.prisma.eventExecutionWorkspace.findFirst({ where: { venueId: profile.venueId!, sourceType: source.input.sourceType, sourceId: source.input.sourceId } });
    if (!workspace) throw new NotFoundException('Execution workspace not found');
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Incident title is required');
    const incident = await this.prisma.eventExecutionIncident.create({ data: { venueId: profile.venueId!, workspaceId: workspace.id, title, severity: body.severity ?? 'high', blocksReadiness: body.blocksReadiness ?? true, createdBy: profile.id } });
    await this.prisma.auditLog.create({ data: { venueId: profile.venueId!, actorProfileId: profile.id, actorName: profile.fullName, actorRole: profile.role, entityType: 'event_execution_incident', entityId: incident.id, action: 'incident_created', summary: `Created incident: ${incident.title}` } });
    return { _id: incident.id, title: incident.title, status: incident.status, blocksReadiness: incident.blocksReadiness };
  }

  @RequireSubscription('active')
  @Patch('command-center/incidents/:incidentId')
  async resolveExecutionIncident(@CurrentUser() user: AuthUser, @Param('incidentId') incidentId: string, @Body() body: UpdateExecutionIncidentDto) {
    const profile = await this.requireManagerProfile(user);
    const incident = await this.prisma.eventExecutionIncident.findFirst({ where: { id: incidentId, venueId: profile.venueId! } });
    if (!incident) throw new NotFoundException('Execution incident not found');
    const resolved = body.status === 'resolved';
    const updated = await this.prisma.eventExecutionIncident.update({ where: { id: incident.id }, data: { status: body.status, resolvedBy: resolved ? profile.id : null, resolvedAt: resolved ? new Date() : null } });
    await this.prisma.auditLog.create({ data: { venueId: profile.venueId!, actorProfileId: profile.id, actorName: profile.fullName, actorRole: profile.role, entityType: 'event_execution_incident', entityId: incident.id, action: resolved ? 'incident_resolved' : 'incident_reopened', summary: `${resolved ? 'Resolved' : 'Reopened'} incident: ${incident.title}` } });
    return { _id: updated.id, status: updated.status, resolvedAt: toMs(updated.resolvedAt) };
  }

  @RequireSubscription('active')
  @Post('command-center/events/:eventId/generate')
  async generateCommandCenterEvent(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    const profile = await this.requireManagerProfile(user);
    if (!this.executionAutopilot) throw new BadRequestException('Execution workspace generator is unavailable');
    const source = await this.getExecutionSource(profile.venueId!, eventId);
    if (!source) throw new NotFoundException('Event not found');
    const workspace = await this.executionAutopilot.ensureWorkspace(source.input);
    return { workspaceId: workspace.id };
  }

  @RequireSubscription('active')
  @Get('command-center/events/:eventId')
  async getCommandCenterEvent(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const source = await this.getExecutionSource(venueId, eventId);
    if (!source) throw new NotFoundException('Event not found');
    const { venueEvent, reservation, beo, input } = source;
    const start = input.startsAt;
    const workspace = await this.prisma.eventExecutionWorkspace.findFirst({ where: { venueId, sourceType: input.sourceType, sourceId: input.sourceId }, include: { tasks: { orderBy: { createdAt: 'asc' } }, timeline: { orderBy: { startsAt: 'asc' } }, vendors: { orderBy: { createdAt: 'asc' } }, incidents: { orderBy: { createdAt: 'desc' } } } });
    if (!workspace) throw new NotFoundException('Execution workspace not found');
    const tasks = workspace.tasks;
    const eventWeekStart = weekStartFor(zonedIsoDate(profile.venue?.timezone, start.getTime()));
    const openTasks = tasks.filter((task) => task.status !== 'done');
    const hasFloorAssignment = reservation ? reservation.tableAssignments.length > 0 : true;
    const taskScore = tasks.length === 0 ? 1 : (tasks.length - openTasks.length) / tasks.length;
    const floorScore = hasFloorAssignment ? 1 : 0;
    const approvalScore = beo ? (beo.status === 'confirmed' ? 1 : 0) : 1;
    const dueTimeline = workspace.timeline.filter((item) => item.startsAt <= new Date());
    const timelineScore = dueTimeline.length === 0 ? 1 : dueTimeline.filter((item) => item.status === 'done').length / dueTimeline.length;
    const vendorScore = workspace.vendors.length === 0 ? 1 : workspace.vendors.filter((vendor) => vendor.status === 'arrived').length / workspace.vendors.length;
    const incidentScore = workspace.incidents.filter((incident) => incident.status === 'open' && incident.blocksReadiness).length === 0 ? 1 : 0;
    // Staffing carried 20 points before the schedule was removed; the rest
    // are scaled up proportionally so the score still reads out of 100.
    const score = Math.round(taskScore * 50 + floorScore * 13 + approvalScore * 12 + timelineScore * 6 + vendorScore * 13 + incidentScore * 6);
    const blockers = [
      ...openTasks.map((task) => ({ code: 'OPEN_EXECUTION_TASK', title: task.title, detail: `${task.department || 'Operations'} task is incomplete.`, targetId: task.id })),
      ...(!hasFloorAssignment ? [{ code: 'UNASSIGNED_TABLE', title: 'Floor assignment missing', detail: 'Assign this booking to the floor plan before service.', targetId: reservation?.id }] : []),
      ...(beo && beo.status !== 'confirmed' ? [{ code: 'BEO_NOT_CONFIRMED', title: 'Event brief is not confirmed', detail: 'Review and confirm the CRM event brief.', targetId: beo.id }] : []),
      ...workspace.timeline.filter((item) => item.status !== 'done' && item.startsAt <= new Date()).map((item) => ({ code: 'TIMELINE_LATE', title: item.title, detail: 'Run-of-show milestone is behind.', targetId: item.id })),
      ...workspace.vendors.filter((vendor) => vendor.status !== 'arrived').map((vendor) => ({ code: 'VENDOR_NOT_READY', title: `${vendor.name} is not ready`, detail: 'Confirm and mark the vendor arrived.', targetId: vendor.id })),
      ...workspace.incidents.filter((incident) => incident.status === 'open' && incident.blocksReadiness).map((incident) => ({ code: 'BLOCKING_INCIDENT', title: incident.title, detail: 'Resolve the blocking incident.', targetId: incident.id })),
    ];
    return {
      workspaceId: workspace.id,
      event: {
        _id: eventId,
        title: venueEvent?.title ?? reservation?.eventName ?? beo?.eventName ?? 'Event',
        startsAt: start.getTime(),
        endsAt: venueEvent?.endsAt?.getTime() ?? (reservation ? reservation.reservationTime.getTime() + reservation.durationMinutes * 60_000 : null),
        expectedGuests: venueEvent?.expectedGuests ?? reservation?.partySize ?? beo?.guestCount ?? null,
        space: reservation?.eventSpace ?? beo?.venueSpace ?? null,
        setupStyle: reservation?.setupStyle ?? beo?.setupStyle ?? null,
        reservationId: reservation?.id ?? venueEvent?.reservationId ?? null,
        beoId: beo?.id ?? null,
      },
      readiness: { score, status: blockers.length ? 'blocked' : 'on-track', categories: { tasks: Math.round(taskScore * 100), floor: Math.round(floorScore * 100), approvals: Math.round(approvalScore * 100), timeline: Math.round(timelineScore * 100), vendors: Math.round(vendorScore * 100), incidents: Math.round(incidentScore * 100) } },
      blockers,
      tasks: tasks.map((task) => ({ _id: task.id, title: task.title, station: task.department, status: task.status, completedAt: toMs(task.completedAt) })),
      timeline: workspace.timeline.map((item) => ({ _id: item.id, title: item.title, startsAt: item.startsAt.getTime(), status: item.status, completedAt: toMs(item.completedAt) })),
      vendors: workspace.vendors.map((vendor) => ({ _id: vendor.id, name: vendor.name, status: vendor.status, dueAt: toMs(vendor.dueAt), ownerId: vendor.ownerId })),
      incidents: workspace.incidents.map((incident) => ({ _id: incident.id, title: incident.title, severity: incident.severity, status: incident.status, blocksReadiness: incident.blocksReadiness })),
      floor: { assigned: hasFloorAssignment, tableIds: reservation?.tableAssignments.map((assignment) => assignment.tableId) ?? [] },
    };
  }

  @RequireSubscription('active')
  @Patch('manager-goal')
  async upsertManagerGoal(@CurrentUser() user: AuthUser, @Body() body: UpsertManagerGoalDto) {
    const profile = await this.requireManagerProfile(user);
    const venueId = profile.venueId!;
    const now = new Date();
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Goal title is required');
    const payload = {
      venueId,
      title,
      details: cleanText(body.details) ?? null,
      period: body.period,
      targetDate: body.targetDate,
      status: body.status,
      completedAt: body.status === 'done' ? now : null,
      updatedAt: now,
    };
    if (body.goalId) {
      const existing = await this.prisma.managerGoal.findFirst({
        where: { id: body.goalId, venueId },
      });
      if (!existing) throw new NotFoundException('Goal not found');
      const updated = await this.prisma.managerGoal.update({
        where: { id: existing.id },
        data: payload,
      });
      return mapGoal(updated);
    }
    const created = await this.prisma.managerGoal.create({
      data: { ...payload, createdBy: profile.id, createdAt: now },
    });
    return mapGoal(created);
  }

  // ─── Manager logbook: shift handoff notes shared across the whole team ────

  @RequireSubscription('active')
  @Get('logbook')
  async listLogbook(@CurrentUser() user: AuthUser, @Query('limit') limitRaw?: string) {
    const profile = await this.requireVenueProfile(user);
    const limit = Math.min(200, Math.max(1, Number(limitRaw) || 50));
    const entries = await this.prisma.logbookEntry.findMany({
      where: { venueId: profile.venueId! },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return { entries: entries.map(mapLogbookEntry) };
  }

  @RequireSubscription('active')
  @Post('logbook')
  async addLogbookEntry(@CurrentUser() user: AuthUser, @Body() body: LogbookEntryDto) {
    const profile = await this.requireVenueProfile(user);
    const text = body.body.trim();
    if (!text) throw new BadRequestException('Entry text is required');
    const category = LOGBOOK_CATEGORIES.includes(body.category as (typeof LOGBOOK_CATEGORIES)[number])
      ? body.category
      : 'general';
    const created = await this.prisma.logbookEntry.create({
      data: {
        venueId: profile.venueId!,
        authorProfileId: profile.id,
        authorName: profile.fullName,
        category,
        body: text,
        // Only managers/admins can pin an entry to the top of the feed.
        pinned: Boolean(body.pinned) && isAdminRole(profile.role),
      },
    });
    return mapLogbookEntry(created);
  }

  @RequireSubscription('active')
  @Delete('logbook/:id')
  async deleteLogbookEntry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const profile = await this.requireVenueProfile(user);
    const entry = await this.prisma.logbookEntry.findFirst({ where: { id, venueId: profile.venueId! } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.authorProfileId !== profile.id && !isAdminRole(profile.role)) {
      throw new ForbiddenException('You can only remove your own entries');
    }
    await this.prisma.logbookEntry.delete({ where: { id: entry.id } });
    return { ok: true };
  }

  // ─── Opening/closing task checklists with photo proof ─────────────────────

  @RequireSubscription('active')
  @Get('checklist')
  async getChecklist(@CurrentUser() user: AuthUser, @Query('kind') kind: string, @Query('date') dateParam?: string) {
    const profile = await this.requireVenueProfile(user);
    if (!CHECKLIST_KINDS.includes(kind as (typeof CHECKLIST_KINDS)[number])) {
      throw new BadRequestException('kind must be "opening" or "closing"');
    }
    const venueId = profile.venueId!;
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInZone(profile.venue?.timezone);
    const items = await this.prisma.checklistTemplateItem.findMany({
      where: { venueId, kind, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (items.length === 0) return { date, kind, items: [] };
    await this.ensureChecklistCompletions(venueId, items.map((item) => item.id), date);
    const completions = await this.prisma.checklistCompletion.findMany({
      where: { venueId, date, templateItemId: { in: items.map((item) => item.id) } },
    });
    const completionByItem = new Map(completions.map((completion) => [completion.templateItemId, completion]));
    return {
      date,
      kind,
      items: await Promise.all(items.map(async (item) => {
        const completion = completionByItem.get(item.id);
        return {
          _id: item.id,
          title: item.title,
          requiresPhoto: item.requiresPhoto,
          sortOrder: item.sortOrder,
          completionId: completion?.id ?? null,
          status: completion?.status ?? 'pending',
          completedByName: completion?.completedByName ?? null,
          completedAt: toMs(completion?.completedAt),
          hasPhoto: Boolean(completion?.photoKey),
          photoUrl: completion?.photoKey
            ? await this.mediaAccess.createPath(
                'checklist-photo',
                completion.id,
                venueId,
                `/v1/operations/checklist/photo/${completion.id}`,
              )
            : null,
        };
      })),
    };
  }

  @RequireSubscription('active')
  @Post('checklist/items')
  async addChecklistItem(@CurrentUser() user: AuthUser, @Body() body: ChecklistTemplateItemDto) {
    const profile = await this.requireManagerProfile(user);
    const title = body.title.trim();
    if (!title) throw new BadRequestException('Title is required');
    const sortOrder = await this.prisma.checklistTemplateItem.count({
      where: { venueId: profile.venueId!, kind: body.kind, active: true },
    });
    const created = await this.prisma.checklistTemplateItem.create({
      data: {
        venueId: profile.venueId!,
        kind: body.kind,
        title,
        requiresPhoto: Boolean(body.requiresPhoto),
        sortOrder,
      },
    });
    return mapChecklistItem(created);
  }

  @RequireSubscription('active')
  @Delete('checklist/items/:id')
  async removeChecklistItem(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const profile = await this.requireManagerProfile(user);
    const item = await this.prisma.checklistTemplateItem.findFirst({ where: { id, venueId: profile.venueId! } });
    if (!item) throw new NotFoundException('Checklist item not found');
    // Soft-deactivate rather than delete so past completions (with photo proof) stay intact.
    await this.prisma.checklistTemplateItem.update({ where: { id: item.id }, data: { active: false } });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Post('checklist/complete/:completionId')
  async completeChecklistItem(
    @CurrentUser() user: AuthUser,
    @Param('completionId') completionId: string,
    @Body() body: CompleteChecklistItemDto,
  ) {
    const profile = await this.requireVenueProfile(user);
    const venueId = profile.venueId!;
    const completion = await this.prisma.checklistCompletion.findFirst({
      where: { id: completionId, venueId },
      include: { templateItem: true },
    });
    if (!completion) throw new NotFoundException('Checklist item not found');
    if (completion.status === 'done') {
      throw new BadRequestException('This task is already marked done for today');
    }
    if (completion.templateItem.requiresPhoto && !body.photoBase64) {
      throw new BadRequestException('This task requires a photo before it can be marked done');
    }
    let photoKey: string | undefined;
    if (body.photoBase64) {
      const data = Buffer.from(body.photoBase64, 'base64');
      if (data.length === 0) throw new BadRequestException('Photo is empty');
      if (data.length > MAX_PHOTO_BYTES) throw new BadRequestException('Photo is too large (max 5MB)');
      const mime = assertAllowedImageBytes(data, body.photoMimeType);
      photoKey = await this.s3ImageService.upload(data, mime, venueId);
    }
    const completedAt = new Date();
    try {
      const result = await this.prisma.checklistCompletion.updateMany({
        where: { id: completion.id, venueId, status: completion.status },
        data: {
          status: 'done',
          completedBy: profile.id,
          completedByName: profile.fullName,
          completedAt,
          ...(photoKey ? { photoKey } : {}),
        },
      });
      if (result.count !== 1) {
        throw new BadRequestException('This task is already marked done for today');
      }
    } catch (error) {
      if (photoKey) await this.s3ImageService.delete(photoKey).catch(() => undefined);
      throw error;
    }
    return {
      _id: completion.id,
      status: 'done',
      completedByName: profile.fullName,
      completedAt: completedAt.getTime(),
      hasPhoto: Boolean(photoKey),
    };
  }

  // Short-lived token allows React Native <Image> to load without a bearer
  // header while keeping the permanent completion id from granting access.
  @Public()
  @SkipVenueScope()
  @Get('checklist/photo/:completionId')
  async getChecklistPhoto(
    @Param('completionId') completionId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ) {
    const completion = await this.prisma.checklistCompletion.findUnique({ where: { id: completionId } });
    if (!completion?.photoKey) throw new NotFoundException('Photo not found');
    await this.mediaAccess.assertToken(token, 'checklist-photo', completionId, completion.venueId);
    const url = await this.s3ImageService.getPresignedUrl(completion.photoKey);
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, url);
  }

  private async ensureChecklistCompletions(venueId: string, templateItemIds: string[], date: string) {
    const existing = await this.prisma.checklistCompletion.findMany({
      where: { venueId, date, templateItemId: { in: templateItemIds } },
      select: { templateItemId: true },
    });
    const seen = new Set(existing.map((row) => row.templateItemId));
    const missing = templateItemIds.filter((id) => !seen.has(id));
    if (missing.length === 0) return;
    await this.prisma.checklistCompletion.createMany({
      data: missing.map((templateItemId) => ({ venueId, templateItemId, date, status: 'pending' })),
      skipDuplicates: true,
    });
  }

  private async getProfile(user: AuthUser) {
    return this.prisma.profile.findFirst({
      where: { userId: user.sub, ...(user.venueId ? { venueId: user.venueId } : {}) },
      include: { venue: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getExecutionSource(venueId: string, eventId: string) {
    const [venueEvent, initialReservation, beo] = await Promise.all([
      this.prisma.venueEvent.findFirst({ where: { id: eventId, venueId } }),
      this.prisma.reservation.findFirst({ where: { id: eventId, venueId }, include: { tableAssignments: { where: { releasedAt: null }, select: { id: true, tableId: true } } } }),
      this.prisma.crmBeo.findFirst({ where: { id: eventId, venueId } }),
    ]);
    const reservation = initialReservation ?? (venueEvent?.reservationId
      ? await this.prisma.reservation.findFirst({ where: { id: venueEvent.reservationId, venueId }, include: { tableAssignments: { where: { releasedAt: null }, select: { id: true, tableId: true } } } })
      : null);
    if (!venueEvent && !reservation && !beo) return null;
    const startsAt = venueEvent?.startsAt ?? reservation?.reservationTime ?? beo!.eventDate!;
    if (!startsAt) return null;
    const endsAt = venueEvent?.endsAt ?? (reservation
      ? new Date(reservation.reservationTime.getTime() + reservation.durationMinutes * 60_000)
      : new Date(startsAt.getTime() + 4 * 60 * 60_000));
    return {
      venueEvent,
      reservation,
      beo,
      input: {
        venueId,
        sourceType: venueEvent ? 'venue-event' as const : reservation ? 'reservation' as const : 'beo' as const,
        sourceId: eventId,
        title: venueEvent?.title ?? reservation?.eventName ?? beo?.eventName ?? 'Event',
        startsAt,
        endsAt,
        setupStyle: reservation?.setupStyle ?? beo?.setupStyle ?? reservation?.eventSpace ?? beo?.venueSpace,
      },
    };
  }

  private async requireManagerProfile(user: AuthUser) {
    const profile = await this.requireVenueProfile(user);
    if (!isAdminRole(profile.role)) throw new ForbiddenException('Not authorized');
    return profile;
  }

  private async requireVenueProfile(user: AuthUser) {
    const profile = await this.getProfile(user);
    if (!profile?.venueId) throw new ForbiddenException('Profile is not initialized');
    if (!isActiveMembership(profile.membershipStatus)) {
      throw new ForbiddenException('Profile is not active for this venue');
    }
    return profile;
  }
}

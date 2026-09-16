import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma, BeoStatus, ReservationSource, ReservationStatus } from '@prisma/client';
import { canManageVenue } from '../../auth/roles';
import { ACTIVE_MEMBERSHIP } from '../../common/membership';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { SkipTenantTransaction } from '../../prisma/skip-tenant-transaction.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { randomUUID } from 'crypto';
import { ExecutionAutopilotService } from '../operations/execution-autopilot.service';

type Scope = VenueScopedRequest['venueScope'];

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'unqualified', 'on_hold'] as const;
const BEO_STATUSES = ['draft', 'sent', 'reviewed', 'confirmed', 'amended', 'cancelled'] as const;
const CONTRACT_STATUSES = ['draft', 'sent', 'viewed', 'partially_signed', 'fully_signed', 'expired', 'cancelled', 'disputed'] as const;
const BEO_EMAIL_MANAGER_LIMIT_MAX = 20;
const BEO_EMAIL_MANAGER_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const BEO_EMAIL_VENUE_LIMIT_MAX = 100;
const BEO_EMAIL_VENUE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

class SaveBeoDto {
  @IsString()
  @IsOptional()
  beoId?: string;

  @IsString()
  eventName!: string;

  @IsNumber()
  @IsOptional()
  eventDate?: number;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  guestCount?: number;

  @IsString()
  @IsOptional()
  venueSpace?: string;

  @IsString()
  @IsOptional()
  setupStyle?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  fbMinimumCents?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  depositCents?: number;

  @IsNumber()
  @IsOptional()
  depositDueDate?: number;

  @IsString()
  @IsOptional()
  menuAppetizers?: string;

  @IsString()
  @IsOptional()
  menuEntrees?: string;

  @IsString()
  @IsOptional()
  menuDesserts?: string;

  @IsString()
  @IsOptional()
  menuBarPackage?: string;

  @IsString()
  @IsOptional()
  specialRequirements?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  assignedRepId?: string;

  @IsString()
  @IsIn(BEO_STATUSES)
  @IsOptional()
  status?: string;
}

class CrmListQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsOptional()
  limit?: number;
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !canManageVenue(scope.role, scope.allAccess)) throw new ForbiddenException('Not authorized');
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function makeContractNumber(): string {
  // Use a UUID-derived suffix for collision resistance. The previous
  // Date.now() approach could collide within the same millisecond.
  const uuid = randomUUID().replace(/-/g, '');
  return `C-${uuid.slice(0, 9).toUpperCase()}`;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEventDate(date: Date | null): string {
  return date
    ? date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'TBD';
}

function formatMoneyCents(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'TBD';
}

type BeoRenderInput = {
  eventName: string;
  eventDate: Date | null;
  eventType: string | null;
  guestCount: number | null;
  venueSpace: string | null;
  setupStyle: string | null;
  fbMinimumCents: number | null;
  depositCents: number | null;
  depositDueDate: Date | null;
  menuAppetizers: string | null;
  menuEntrees: string | null;
  menuDesserts: string | null;
  menuBarPackage: string | null;
  specialRequirements: string | null;
  lead?: { fullName: string; email: string | null } | null;
};

function renderBeoText(beo: BeoRenderInput, venueName: string, message?: string): string {
  const rows: string[][] = [
    ['Event', beo.eventName],
    ['Date / Time', formatEventDate(beo.eventDate)],
    ['Guest count', String(beo.guestCount ?? 'TBD')],
    ['Space', beo.venueSpace ?? 'TBD'],
    ['Setup', beo.setupStyle ?? 'TBD'],
    ['F&B minimum', formatMoneyCents(beo.fbMinimumCents)],
    ['Deposit', formatMoneyCents(beo.depositCents)],
    ['Deposit due', beo.depositDueDate ? beo.depositDueDate.toLocaleDateString('en-US') : 'TBD'],
    ['Appetizers', beo.menuAppetizers ?? '-'],
    ['Entrees', beo.menuEntrees ?? '-'],
    ['Desserts', beo.menuDesserts ?? '-'],
    ['Bar', beo.menuBarPackage ?? '-'],
    ['Special requirements', beo.specialRequirements ?? '-'],
  ];
  const greeting = beo.lead?.fullName ? `Hi ${beo.lead.fullName.split(' ')[0]},\n\n` : '';
  const intro = message ? `${message}\n\n` : `Please review the event details below for ${venueName}.\n\n`;
  const tableHeader = `Event Details\nDetail\tInfo\n`;
  const lines = rows.map(([k, v]) => `${k}\t${v}`).join('\n');
  return `${greeting}${intro}${tableHeader}${lines}\n\nThank you,\n${venueName}\n`;
}

function renderBeoHtml(beo: BeoRenderInput, venueName: string, message?: string): string {
  const rows: Array<[string, string]> = [
    ['Event', beo.eventName],
    ['Date / Time', formatEventDate(beo.eventDate)],
    ['Guest count', String(beo.guestCount ?? 'TBD')],
    ['Space', beo.venueSpace ?? 'TBD'],
    ['Setup', beo.setupStyle ?? 'TBD'],
    ['F&B minimum', formatMoneyCents(beo.fbMinimumCents)],
    ['Deposit', formatMoneyCents(beo.depositCents)],
    ['Deposit due', beo.depositDueDate ? beo.depositDueDate.toLocaleDateString('en-US') : 'TBD'],
    ['Appetizers', beo.menuAppetizers ?? '-'],
    ['Entrees', beo.menuEntrees ?? '-'],
    ['Desserts', beo.menuDesserts ?? '-'],
    ['Bar', beo.menuBarPackage ?? '-'],
    ['Special requirements', beo.specialRequirements ?? '-'],
  ];
  const tableRows = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#6F6A5F;border-bottom:1px solid #eee;font-weight:600;">${htmlEscape(k)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${htmlEscape(v)}</td></tr>`)
    .join('');
  const greeting = beo.lead?.fullName ? `<p>Hi ${htmlEscape(beo.lead.fullName.split(' ')[0])},</p>` : '';
  const intro = message ? `<p>${htmlEscape(message)}</p>` : `<p>Please review the event details below for <strong>${htmlEscape(venueName)}</strong>.</p>`;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#23241F;max-width:600px;margin:0 auto;padding:24px;">
<h2 style="color:#2F7D46;margin:0 0 16px;">${htmlEscape(venueName)} - Banquet Event Order</h2>
${greeting}
${intro}
<table style="width:100%;border-collapse:collapse;margin:16px 0;">${tableRows}</table>
<p style="color:#6F6A5F;font-size:13px;">Thank you,<br/>${htmlEscape(venueName)}</p>
</body></html>`;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/crm')
export class CrmController {
  private readonly logger = new Logger(CrmController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly executionAutopilot?: ExecutionAutopilotService,
  ) {}

  @RequireSubscription('active')
  @Get('beos')
  async listBeos(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);

    const beos = await this.prisma.crmBeo.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      // Operational suite orders raised against this sales BEO, so a reader
      // can see what service has actually booked off it.
      include: { _count: { select: { suiteOrders: true } } },
    });

    return beos.map((b) => ({
      ...this.mapBeo(b),
      suiteOrderCount: b._count.suiteOrders,
    }));
  }

  @RequireSubscription('active')
  @Post('beos')
  async saveBeo(@VenueScope() scope: Scope, @Body() body: SaveBeoDto) {
    requireManager(scope);
    const now = new Date();
    const assignedRepId = await this.resolveVenueMemberId(scope.venueId, body.assignedRepId, 'Assigned representative');

    const fields = {
      eventName: body.eventName,
      eventDate: body.eventDate ? new Date(body.eventDate) : null,
      eventType: body.eventType ?? null,
      guestCount: body.guestCount ?? null,
      venueSpace: body.venueSpace ?? null,
      setupStyle: body.setupStyle ?? null,
      fbMinimumCents: body.fbMinimumCents ?? null,
      depositCents: body.depositCents ?? null,
      depositDueDate: body.depositDueDate ? new Date(body.depositDueDate) : null,
      menuAppetizers: body.menuAppetizers ?? null,
      menuEntrees: body.menuEntrees ?? null,
      menuDesserts: body.menuDesserts ?? null,
      menuBarPackage: body.menuBarPackage ?? null,
      specialRequirements: body.specialRequirements ?? null,
      internalNotes: body.internalNotes ?? null,
      assignedRepId: assignedRepId ?? null,
      updatedAt: now,
    };

    if (body.beoId) {
      const existing = await this.prisma.crmBeo.findFirst({
        where: { id: body.beoId, venueId: scope.venueId },
      });
      if (!existing) throw new NotFoundException('BEO not found');

      const patch: Record<string, any> = { ...fields };
      if (body.status !== undefined) patch.status = body.status as BeoStatus;
      // Update the BEO and sync its reservation atomically. A hold conflict
      // throws inside syncBeoToReservation, which rolls back the BEO update so
      // we never leave a confirmed BEO without its blocking reservation.
      const updated = await withTenantTransaction(this.prisma, async (tx) => {
        const u = await tx.crmBeo.update({ where: { id: body.beoId }, data: patch });
        // Sync confirmed BEOs to a reservation so private events block the
        // floor plan instead of letting another booking overlap the same space.
        // Only re-sync when the status just flipped to confirmed OR when a
        // reservation-relevant field actually changed on an already-confirmed BEO.
        const becameConfirmed = body.status === 'confirmed' && existing.status !== 'confirmed';
        const relevantFieldChanged =
          u.status === 'confirmed' &&
          (body.eventDate !== undefined ||
           body.guestCount !== undefined ||
           body.venueSpace !== undefined);
        if ((becameConfirmed || relevantFieldChanged) && u.eventDate) {
          await this.syncBeoToReservation(tx, scope.venueId, u);
        }
        if (u.status === 'confirmed' && u.eventDate) {
          await this.ensureBeoExecutionWorkspace(tx, scope.venueId, u);
        }
        return u;
      }, { venueId: scope.venueId });
      return { beoId: body.beoId };
    }

    // Create the BEO and (if confirmed) its blocking reservation atomically so
    // a hold conflict can't leave an orphaned confirmed BEO behind.
    const beo = await withTenantTransaction(this.prisma, async (tx) => {
      const created = await tx.crmBeo.create({
        data: {
          ...fields,
          venueId: scope.venueId,
          status: (body.status ?? 'draft') as BeoStatus,
          createdAt: now,
        },
      });
      if (created.status === 'confirmed' && created.eventDate) {
        await this.syncBeoToReservation(tx, scope.venueId, created);
        await this.ensureBeoExecutionWorkspace(tx, scope.venueId, created);
      }
      return created;
    }, { venueId: scope.venueId });

    return { beoId: beo.id };
  }

  // ============================================================
  // Pipeline forecast - weighted by stage probability.
  // ============================================================
  // ============================================================
  // Lead source ROI: counts, won-rate, and revenue by source.
  // ============================================================
  // ============================================================
  // Stale leads: active-stage leads with no activity for N days.
  // ============================================================
  // ============================================================
  // Activity timeline for a lead.
  // ============================================================
  // ============================================================
  // Email BEO to a recipient with the rendered event details.
  // ============================================================
  @RequireSubscription('active')
  // Awaits EmailService.sendOrThrow (blocking) — must not hold the request
  // transaction open for that external call. See TenantRequestTransactionInterceptor's doc.
  // ============================================================
  // Email templates: CRUD + render with substitution.
  // ============================================================
  // Render a template's subject + body against lead/BEO context. Used by the
  // UI to preview what an email will look like before sending.
  // ============================================================
  // Helpers
  // ============================================================
  private async resolveVenueMemberId(
    venueId: string,
    rawProfileId: string | undefined,
    label: string,
  ): Promise<string | null | undefined> {
    if (rawProfileId === undefined) return undefined;
    const profileId = rawProfileId.trim();
    if (!profileId) return null;
    const member = await this.prisma.profile.findFirst({
      where: { id: profileId, venueId, OR: ACTIVE_MEMBERSHIP },
      select: { id: true },
    });
    if (!member) throw new BadRequestException(`${label} must be an active member of this venue.`);
    return member.id;
  }

  private async ensureBeoExecutionWorkspace(db: Prisma.TransactionClient, venueId: string, beo: {
    id: string;
    eventName: string;
    eventDate: Date | null;
    setupStyle: string | null;
    venueSpace: string | null;
  }) {
    if (!this.executionAutopilot || !beo.eventDate) return;
    await this.executionAutopilot.ensureWorkspace({
      venueId,
      sourceType: 'beo',
      sourceId: beo.id,
      title: beo.eventName,
      startsAt: beo.eventDate,
      endsAt: new Date(beo.eventDate.getTime() + 4 * 60 * 60_000),
      setupStyle: beo.setupStyle ?? beo.venueSpace,
    }, db);
  }

  private async syncBeoToReservation(db: Prisma.TransactionClient, venueId: string, beo: {
    id: string;
    eventName: string;
    eventDate: Date | null;
    guestCount: number | null;
    venueSpace: string | null;
    setupStyle: string | null;
    menuAppetizers: string | null;
    menuEntrees: string | null;
  }) {
    if (!beo.eventDate) return;

    // Block BEO-to-reservation sync if the event window overlaps a
    // manager-imposed hold - same guard that saveReservation uses.
    const eventDurationMs = 240 * 60 * 1000; // 4 hours, same as durationMinutes below
    const eventEnd = new Date(beo.eventDate.getTime() + eventDurationMs);
    const hold = await db.reservationHold.findFirst({
      where: {
        venueId,
        startsAt: { lt: eventEnd },
        endsAt: { gt: beo.eventDate },
      },
      select: { reason: true },
    });
    if (hold) {
      throw new BadRequestException(
        `Cannot sync BEO to reservation - time conflicts with a hold: ${hold.reason}`,
      );
    }

    // We tag the reservation with the BEO id so subsequent edits update the
    // same row instead of creating duplicates. Uses tags[] since there's no
    // dedicated FK column.
    const beoTag = `beo:${beo.id}`;
    const existing = await db.reservation.findFirst({
      where: { venueId, deletedAt: null, tags: { has: beoTag } },
    });
    const menuNotes = [beo.menuAppetizers, beo.menuEntrees].filter(Boolean).join(' / ') || null;
    const data = {
      venueId,
      guestName: beo.eventName,
      guestPhone: null,
      guestEmail: null,
      guestCompany: null,
      partySize: beo.guestCount ?? 1,
      reservationTime: beo.eventDate,
      durationMinutes: 240,
      source: ReservationSource.direct,
      status: ReservationStatus.confirmed,
      isPrivateEvent: true,
      eventName: beo.eventName,
      eventStatus: 'confirmed',
      eventSpace: beo.venueSpace,
      setupStyle: beo.setupStyle,
      menuNotes,
      tags: [beoTag, 'private_event'],
    };
    if (existing) {
      await db.reservation.update({ where: { id: existing.id }, data });
    } else {
      await db.reservation.create({ data });
    }
  }


  private mapBeo(b: {
    id: string;
    venueId: string;
    eventName: string;
    eventDate: Date | null;
    eventType: string | null;
    guestCount: number | null;
    venueSpace: string | null;
    setupStyle: string | null;
    fbMinimumCents: number | null;
    depositCents: number | null;
    depositDueDate: Date | null;
    menuAppetizers: string | null;
    menuEntrees: string | null;
    menuDesserts: string | null;
    menuBarPackage: string | null;
    specialRequirements: string | null;
    internalNotes: string | null;
    assignedRepId: string | null;
    status: BeoStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: b.id,
      id: b.id,
      venueId: b.venueId,
      eventName: b.eventName,
      eventDate: toMs(b.eventDate),
      eventType: b.eventType ?? null,
      guestCount: b.guestCount ?? null,
      venueSpace: b.venueSpace ?? null,
      setupStyle: b.setupStyle ?? null,
      fbMinimumCents: b.fbMinimumCents ?? null,
      depositCents: b.depositCents ?? null,
      depositDueDate: toMs(b.depositDueDate),
      menuAppetizers: b.menuAppetizers ?? null,
      menuEntrees: b.menuEntrees ?? null,
      menuDesserts: b.menuDesserts ?? null,
      menuBarPackage: b.menuBarPackage ?? null,
      specialRequirements: b.specialRequirements ?? null,
      internalNotes: b.internalNotes ?? null,
      assignedRepId: b.assignedRepId ?? null,
      status: b.status,
      createdAt: b.createdAt.getTime(),
      updatedAt: b.updatedAt.getTime(),
    };
  }
}

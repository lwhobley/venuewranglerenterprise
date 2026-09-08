import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { canManageVenue } from '../../auth/roles';
import { canAccessAllDepartments } from '../../auth/department-auth.helper';
import { secretsMatch } from '../../common/webhook-auth';
import { getClientIp } from '../../common/http';
import { assertWithinSharedRateLimit } from '../../common/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { S3DocumentService } from '../documents/s3-document.service';
import { DailyRosterService } from '../stadium/daily-roster.service';
import type { CanonicalBeoInput, DepartmentSlices } from './adapters/canonical-beo.types';
import { parseGenericJsonPayload } from './adapters/generic-json';
import { parseUngerboeckPayload } from './adapters/ungerboeck';
import { extractFromUploadedDocument } from './adapters/upload-parser';
import { BeoIngestService } from './beo-ingest.service';

type Scope = VenueScopedRequest['venueScope'];

export class IngestWebhookDto {
  venueId?: string;
  [key: string]: any;
}

export class CreateManualBeoDto {
  eventName!: string;
  serviceDate!: string; // YYYY-MM-DD
  serviceStartAt!: string; // ISO or parseable
  serviceEndAt!: string;
  loadInAt?: string;
  loadOutAt?: string;
  venueSpace?: string;
  spaceId?: string;
  eventId?: string;
  guestCount?: number;
  departmentSlices?: DepartmentSlices;
  specialRequirements?: string;
  internalNotes?: string;
}

export class UpdateBeoDto {
  eventName?: string;
  serviceDate?: string;
  serviceStartAt?: string;
  serviceEndAt?: string;
  loadInAt?: string;
  loadOutAt?: string;
  venueSpace?: string;
  spaceId?: string;
  eventId?: string;
  guestCount?: number;
  status?: string;
  departmentSlices?: DepartmentSlices;
  layoutJson?: Record<string, unknown>;
  specialRequirements?: string;
  internalNotes?: string;
}

export class UploadDocumentDto {
  fileName!: string;
  mimeType!: string;
  dataBase64!: string;
}

const DEPT_CODE_TO_SLICES: Record<string, string[]> = {
  CULINARY: ['kitchen'],
  BANQUET_CATERING: ['banquetFloor', 'banquet_floor', 'staffing'],
  BEVERAGE: ['bars'],
  SUITES: ['suites'],
  CONCESSIONS: ['concessions', 'concourse'],
};

const SLICE_KEY_TO_DEPT: Record<string, string> = {
  kitchen: 'CULINARY',
  banquet_floor: 'BANQUET_CATERING',
  banquetFloor: 'BANQUET_CATERING',
  staffing: 'BANQUET_CATERING',
  bars: 'BEVERAGE',
  suites: 'SUITES',
  concessions: 'CONCESSIONS',
  concourse: 'CONCESSIONS',
};

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/beo-hub')
export class BeoHubController {
  private readonly logger = new Logger(BeoHubController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly beoIngestService: BeoIngestService,
    private readonly dailyRosterService: DailyRosterService,
    @Optional() private readonly s3DocumentService?: S3DocumentService,
  ) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !canManageVenue(scope.role, scope.allAccess)) {
      throw new ForbiddenException('Only venue managers can perform this action');
    }
  }

  private requireScope(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !scope.venueId) {
      throw new ForbiddenException('No active venue scope');
    }
  }

  /**
   * Public webhook endpoint for automated BEO delivery.
   * Fails closed if webhook secret is missing in production.
   */
  @Public()
  @Post('ingest/:source')
  @HttpCode(HttpStatus.OK)
  async handleWebhookIngest(
    @Param('source') source: string,
    @Query('venueId') queryVenueId: string | undefined,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Headers('x-beo-hub-secret') hubSecretHeader: string | undefined,
    @Body() body: any,
    @Req() req?: Request,
  ) {
    const venueId = queryVenueId ?? (typeof body?.venueId === 'string' ? body.venueId : undefined);
    if (!venueId) {
      throw new BadRequestException('venueId is required either as a query parameter or in the payload');
    }

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, leadsWebhookSecret: true },
    });
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);

    const providedSecret = secretHeader ?? hubSecretHeader;
    if (!venue.leadsWebhookSecret || !secretsMatch(providedSecret, venue.leadsWebhookSecret)) {
      throw new UnauthorizedException('Invalid or missing webhook authorization secret.');
    }

    await assertWithinSharedRateLimit(
      this.prisma,
      `beo-hub-webhook:${venueId}:${getClientIp(req ?? ({} as Request))}`,
      60,
      60_000,
      'Too many webhook requests.',
    );

    if (body && typeof body === 'object' && 'secret' in body) {
      delete body.secret;
    }

    let canonical: CanonicalBeoInput;
    switch (source.toLowerCase()) {
      case 'generic-json':
      case 'json':
        canonical = parseGenericJsonPayload(body);
        break;
      case 'ungerboeck':
        canonical = parseUngerboeckPayload(body);
        break;
      default:
        throw new BadRequestException(`Unknown BEO source adapter: "${source}"`);
    }

    const result = await this.beoIngestService.ingestCanonicalBeo(venueId, canonical);
    return {
      ok: true,
      id: result.id,
      duplicate: result.isDuplicate,
      status: result.status,
      needsReview: result.needsReview,
      eventId: result.eventId,
    };
  }

  /**
   * Manager upload of PDF/DOCX/CSV/JSON BEO files.
   */
  @Post('uploads')
  async uploadBeo(
    @VenueScope() scope: Scope,
    @Body() body: UploadDocumentDto,
  ) {
    this.requireManager(scope);

    if (!body?.fileName || !body?.dataBase64) {
      throw new BadRequestException('fileName and dataBase64 are required');
    }

    const buffer = Buffer.from(body.dataBase64, 'base64');
    let sourceFileUrl: string | null = null;

    if (this.s3DocumentService) {
      try {
        const key = await this.s3DocumentService.upload(buffer, body.mimeType || 'application/octet-stream', scope.venueId);
        sourceFileUrl = key;
      } catch (err) {
        this.logger.warn(`S3 upload skipped or failed for BEO file ${body.fileName}: ${(err as Error).message}`);
      }
    }

    const extraction = extractFromUploadedDocument(body.fileName, body.mimeType || '', buffer);
    if (sourceFileUrl) {
      extraction.beo.sourceFileUrl = sourceFileUrl;
    }

    const result = await this.beoIngestService.ingestCanonicalBeo(scope.venueId, extraction.beo);

    return {
      ok: true,
      id: result.id,
      status: result.status,
      confidence: extraction.confidence,
      needsReview: result.needsReview,
      rawText: extraction.rawText ? extraction.rawText.slice(0, 1000) : undefined,
    };
  }

  /**
   * List BEOs for operations hub.
   */
  @Get('beos')
  async listBeos(
    @VenueScope() scope: Scope,
    @Query('serviceDate') serviceDate?: string,
    @Query('eventId') eventId?: string,
    @Query('spaceId') spaceId?: string,
    @Query('department') department?: string,
    @Query('status') status?: string,
    @Query('needsReview') needsReview?: string,
  ) {
    this.requireScope(scope);

    const hasCrossAccess = await canAccessAllDepartments(scope as any, scope.venueId, this.prisma);
    let allowedSliceKeys: Set<string> | 'all' = 'all';
    let allowedSuites = true;

    if (!hasCrossAccess) {
      const memberships = await this.prisma.departmentMembership.findMany({
        where: {
          facilityId: scope.venueId,
          userId: scope.userId,
          isActive: true,
        },
        include: { department: true },
      });

      const userDeptCodes = new Set(memberships.map((m) => m.department.code.toUpperCase()));

      // If user queried for a specific department slice they don't belong to -> 403 Forbidden
      if (department && department !== 'all') {
        const requiredDept = SLICE_KEY_TO_DEPT[department];
        if (requiredDept && !userDeptCodes.has(requiredDept)) {
          throw new ForbiddenException('Access denied for this department BEO slice');
        }
      }

      allowedSliceKeys = new Set<string>();
      for (const code of userDeptCodes) {
        const slices = DEPT_CODE_TO_SLICES[code] || [];
        slices.forEach((s) => (allowedSliceKeys as Set<string>).add(s));
      }
      allowedSuites = userDeptCodes.has('SUITES');
    }

    const where: any = { venueId: scope.venueId };

    if (serviceDate) {
      where.serviceDate = serviceDate;
    }
    if (eventId) {
      where.eventId = eventId;
    }
    if (spaceId) {
      where.spaceId = spaceId;
    }
    if (status) {
      where.status = status;
    }
    if (needsReview === 'true') {
      where.status = 'needs_review';
    }

    const beos = await this.prisma.crmBeo.findMany({
      where,
      orderBy: [
        { serviceStartAt: 'asc' },
        { eventName: 'asc' },
      ],
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
          },
        },
        suiteOrders: {
          select: {
            id: true,
            beoNumber: true,
            status: true,
            guestCount: true,
          },
        },
      },
      take: 200,
    });

    const filtered = beos
      .filter((b) => {
        if (department && department !== 'all') {
          if (department === 'suites') {
            return b.suiteOrders.length > 0 || Boolean((b.departmentSlices as any)?.suites);
          }
          if (!b.departmentSlices || typeof b.departmentSlices !== 'object') return false;
          const slices = b.departmentSlices as any;
          if (department === 'kitchen') return Boolean(slices.kitchen);
          if (department === 'banquet_floor' || department === 'banquetFloor') return Boolean(slices.banquetFloor);
          if (department === 'bars') return Boolean(slices.bars);
          if (department === 'warehouse') return Boolean(slices.warehouse);
          if (department === 'staffing') return Boolean(slices.staffing);
          return true;
        }

        if (allowedSliceKeys !== 'all') {
          const slices = (b.departmentSlices as Record<string, any>) || {};
          const hasSlice = Object.keys(slices).some((k) => allowedSliceKeys.has(k));
          const hasSuites = allowedSuites && b.suiteOrders.length > 0;
          return hasSlice || hasSuites;
        }

        return true;
      })
      .map((b) => {
        let slices = b.departmentSlices;
        let suiteOrders = b.suiteOrders;

        if (allowedSliceKeys !== 'all') {
          const rawSlices = (slices as Record<string, any>) || {};
          const filteredSlices: Record<string, any> = {};
          for (const [k, v] of Object.entries(rawSlices)) {
            if (allowedSliceKeys.has(k)) {
              filteredSlices[k] = v;
            }
          }
          slices = filteredSlices;
          if (!allowedSuites) {
            suiteOrders = [];
          }
        }

        return {
          id: b.id,
          eventName: b.eventName,
          serviceDate: b.serviceDate,
          serviceStartAt: b.serviceStartAt ? b.serviceStartAt.toISOString() : null,
          serviceEndAt: b.serviceEndAt ? b.serviceEndAt.toISOString() : null,
          loadInAt: b.loadInAt ? b.loadInAt.toISOString() : null,
          loadOutAt: b.loadOutAt ? b.loadOutAt.toISOString() : null,
          venueSpace: b.venueSpace,
          spaceId: b.spaceId,
          guestCount: b.guestCount,
          status: b.status,
          externalSource: b.externalSource,
          externalId: b.externalId,
          eventId: b.eventId,
          eventTitle: b.event?.title ?? null,
          suiteOrderCount: suiteOrders.length,
          departmentSlices: slices,
          hasLayout: Boolean(b.layoutJson),
          updatedAt: b.updatedAt.toISOString(),
        };
      });

    return {
      beos: filtered,
      totalCount: filtered.length,
    };
  }

  /**
   * Get single BEO detail.
   */
  @Get('beos/:id')
  async getBeo(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
  ) {
    this.requireScope(scope);

    const beo = await this.prisma.crmBeo.findFirst({
      where: { id, venueId: scope.venueId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            expectedGuests: true,
          },
        },
        suiteOrders: {
          select: {
            id: true,
            beoNumber: true,
            status: true,
            guestCount: true,
            deliveryWindowStart: true,
            deliveryWindowEnd: true,
          },
        },
      },
    });

    if (!beo) throw new NotFoundException('BEO not found');

    const hasCrossAccess = await canAccessAllDepartments(scope as any, scope.venueId, this.prisma);
    let departmentSlices = beo.departmentSlices;
    let suiteOrders = beo.suiteOrders;

    if (!hasCrossAccess) {
      const memberships = await this.prisma.departmentMembership.findMany({
        where: {
          facilityId: scope.venueId,
          userId: scope.userId,
          isActive: true,
        },
        include: { department: true },
      });
      const userDeptCodes = new Set(memberships.map((m) => m.department.code.toUpperCase()));
      const allowedSliceKeys = new Set<string>();
      for (const code of userDeptCodes) {
        const slices = DEPT_CODE_TO_SLICES[code] || [];
        slices.forEach((s) => allowedSliceKeys.add(s));
      }
      const allowedSuites = userDeptCodes.has('SUITES');

      const rawSlices = (departmentSlices as Record<string, any>) || {};
      const matchingKeys = Object.keys(rawSlices).filter((k) => allowedSliceKeys.has(k));
      const hasSuiteData = allowedSuites && suiteOrders.length > 0;

      if (matchingKeys.length === 0 && !hasSuiteData) {
        // Deep links to another department's BEO slice -> 403
        throw new ForbiddenException('Access denied for this department BEO slice');
      }

      const filteredSlices: Record<string, any> = {};
      for (const k of matchingKeys) {
        filteredSlices[k] = rawSlices[k];
      }
      departmentSlices = filteredSlices;
      if (!allowedSuites) {
        suiteOrders = [];
      }
    }

    return {
      id: beo.id,
      venueId: beo.venueId,
      eventName: beo.eventName,
      serviceDate: beo.serviceDate,
      serviceStartAt: beo.serviceStartAt ? beo.serviceStartAt.toISOString() : null,
      serviceEndAt: beo.serviceEndAt ? beo.serviceEndAt.toISOString() : null,
      loadInAt: beo.loadInAt ? beo.loadInAt.toISOString() : null,
      loadOutAt: beo.loadOutAt ? beo.loadOutAt.toISOString() : null,
      venueSpace: beo.venueSpace,
      spaceId: beo.spaceId,
      guestCount: beo.guestCount,
      status: beo.status,
      externalSource: beo.externalSource,
      externalId: beo.externalId,
      eventId: beo.eventId,
      event: beo.event,
      suiteOrders,
      departmentSlices,
      layoutJson: beo.layoutJson,
      sourcePayload: beo.sourcePayload,
      sourceFileUrl: beo.sourceFileUrl,
      sourceUpdatedAt: beo.sourceUpdatedAt ? beo.sourceUpdatedAt.toISOString() : null,
      specialRequirements: beo.specialRequirements,
      internalNotes: beo.internalNotes,
      updatedAt: beo.updatedAt.toISOString(),
    };
  }

  /**
   * Manual creation of an operations BEO (requires event + space + start/end).
   */
  @Post('beos')
  async createManualBeo(
    @VenueScope() scope: Scope,
    @Body() body: CreateManualBeoDto,
  ) {
    this.requireManager(scope);

    if (!body.eventName?.trim()) {
      throw new BadRequestException('Event name is required');
    }
    if (!body.venueSpace?.trim() && !body.spaceId?.trim()) {
      throw new BadRequestException('Space/Room is required');
    }
    if (!body.serviceStartAt || !body.serviceEndAt) {
      throw new BadRequestException('Start time and end time are required');
    }

    const startAt = new Date(body.serviceStartAt);
    const endAt = new Date(body.serviceEndAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid start or end date time');
    }

    const externalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const input: CanonicalBeoInput = {
      externalSource: 'manual',
      externalId,
      eventName: body.eventName.trim(),
      serviceDate: body.serviceDate || startAt.toISOString().slice(0, 10),
      serviceStartAt: startAt,
      serviceEndAt: endAt,
      loadInAt: body.loadInAt ? new Date(body.loadInAt) : null,
      loadOutAt: body.loadOutAt ? new Date(body.loadOutAt) : null,
      venueSpace: body.venueSpace?.trim(),
      spaceId: body.spaceId?.trim(),
      eventId: body.eventId?.trim(),
      guestCount: body.guestCount ?? null,
      status: 'confirmed',
      departmentSlices: body.departmentSlices,
      specialRequirements: body.specialRequirements,
      internalNotes: body.internalNotes,
    };

    const result = await this.beoIngestService.ingestCanonicalBeo(scope.venueId, input);
    return { ok: true, id: result.id, status: result.status };
  }

  /**
   * Patch BEO details (e.g. resolve needs_review, update times, slices, layout).
   */
  @Patch('beos/:id')
  async updateBeo(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Body() body: UpdateBeoDto,
  ) {
    this.requireManager(scope);

    const existing = await this.prisma.crmBeo.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!existing) throw new NotFoundException('BEO not found');

    const updateData: any = {};
    if (body.eventName !== undefined) updateData.eventName = body.eventName.trim();
    if (body.serviceDate !== undefined) updateData.serviceDate = body.serviceDate;
    if (body.serviceStartAt !== undefined) updateData.serviceStartAt = body.serviceStartAt ? new Date(body.serviceStartAt) : null;
    if (body.serviceEndAt !== undefined) updateData.serviceEndAt = body.serviceEndAt ? new Date(body.serviceEndAt) : null;
    if (body.loadInAt !== undefined) updateData.loadInAt = body.loadInAt ? new Date(body.loadInAt) : null;
    if (body.loadOutAt !== undefined) updateData.loadOutAt = body.loadOutAt ? new Date(body.loadOutAt) : null;
    if (body.venueSpace !== undefined) updateData.venueSpace = body.venueSpace;
    if (body.spaceId !== undefined) updateData.spaceId = body.spaceId;
    if (body.eventId !== undefined) {
      if (body.eventId !== null) {
        const event = await this.prisma.venueEvent.findFirst({
          where: { id: body.eventId, venueId: scope.venueId },
          select: { id: true },
        });
        if (!event) throw new NotFoundException('Event not found in this venue');
        updateData.eventId = event.id;
      } else {
        updateData.eventId = null;
      }
    }
    if (body.guestCount !== undefined) updateData.guestCount = body.guestCount;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.departmentSlices !== undefined) updateData.departmentSlices = body.departmentSlices;
    if (body.layoutJson !== undefined) updateData.layoutJson = body.layoutJson;
    if (body.specialRequirements !== undefined) updateData.specialRequirements = body.specialRequirements;
    if (body.internalNotes !== undefined) updateData.internalNotes = body.internalNotes;

    // If resolving needs_review, verify required fields
    if (body.status && body.status !== 'needs_review') {
      const space = updateData.venueSpace ?? existing.venueSpace ?? updateData.spaceId ?? existing.spaceId;
      const start = updateData.serviceStartAt ?? existing.serviceStartAt;
      const end = updateData.serviceEndAt ?? existing.serviceEndAt;
      if (!space || !start || !end) {
        throw new BadRequestException('Cannot mark confirmed/in_service without space and start/end times');
      }
    }

    const updated = await withTenantTransaction(
      this.prisma,
      async (tx) => {
        return tx.crmBeo.update({
          where: { id: existing.id },
          data: updateData,
        });
      },
      { venueId: scope.venueId },
    );

    return { ok: true, beo: updated };
  }

  /**
   * For suite-scoped BEOs without a SuiteBeoOrder, create an operational suite order.
   */
  @Post('beos/:id/create-suite-order')
  async createSuiteOrderForBeo(
    @VenueScope() scope: Scope,
    @Param('id') beoId: string,
  ) {
    this.requireManager(scope);

    const beo = await this.prisma.crmBeo.findFirst({
      where: { id: beoId, venueId: scope.venueId },
      include: { suiteOrders: true },
    });
    if (!beo) throw new NotFoundException('BEO not found');

    if (beo.suiteOrders.length > 0) {
      return { ok: true, suiteOrderId: beo.suiteOrders[0].id, alreadyExists: true };
    }

    // Determine zone & subvenue
    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: scope.venueId },
      select: { organizationId: true },
    });

    // Find a suite zone or first zone
    let zone = beo.spaceId
      ? await this.prisma.facilityZone.findFirst({ where: { id: beo.spaceId, facilityId: scope.venueId } })
      : null;

    if (!zone) {
      zone = await this.prisma.facilityZone.findFirst({
        where: { facilityId: scope.venueId, zoneType: 'premium' },
      }) ?? await this.prisma.facilityZone.findFirst({
        where: { facilityId: scope.venueId },
      });
    }

    if (!zone) {
      throw new BadRequestException('No facility zones configured for this venue to anchor suite order');
    }

    let subVenue = await this.prisma.subVenue.findFirst({
      where: { facilityId: scope.venueId, zoneId: zone.id },
    });

    if (!subVenue) {
      subVenue = await this.prisma.subVenue.create({
        data: {
          organizationId: venue.organizationId,
          facilityId: scope.venueId,
          zoneId: zone.id,
          code: beo.venueSpace ? beo.venueSpace.slice(0, 10).toUpperCase() : 'SUITE',
          name: beo.venueSpace || 'Luxury Suite',
          subVenueType: 'suite_group',
        },
      });
    }

    const deliveryStart = beo.serviceStartAt ?? new Date();
    const deliveryEnd = beo.serviceEndAt ?? new Date(deliveryStart.getTime() + 2 * 3600 * 1000);
    const beoNumber = `SBO-${beo.id.slice(-6).toUpperCase()}`;

    const created = await withTenantTransaction(
      this.prisma,
      async (tx) => {
        return tx.suiteBeoOrder.create({
          data: {
            organizationId: venue.organizationId,
            facilityId: scope.venueId,
            zoneId: zone.id,
            subVenueId: subVenue.id,
            crmBeoId: beo.id,
            eventId: beo.eventId,
            beoNumber,
            hostName: (beo.departmentSlices as any)?.suites?.hostName || beo.eventName,
            guestCount: beo.guestCount ?? 0,
            deliveryWindowStart: deliveryStart,
            deliveryWindowEnd: deliveryEnd,
            specialInstructions: beo.specialRequirements,
            cateringLineItems: [],
            status: 'draft',
          },
        });
      },
      { venueId: scope.venueId },
    );

    return { ok: true, suiteOrderId: created.id, beoNumber: created.beoNumber };
  }

  /**
   * Sync staffing slice of BEO to banquet daily roster.
   */
  @Post('beos/:id/sync-staffing')
  async syncBeoStaffing(
    @VenueScope() scope: Scope,
    @Param('id') beoId: string,
  ) {
    this.requireManager(scope);

    const beo = await this.prisma.crmBeo.findFirst({
      where: { id: beoId, venueId: scope.venueId },
    });
    if (!beo) throw new NotFoundException('BEO not found');

    const slices = beo.departmentSlices as any;
    const rawRoles = slices?.staffing?.requiredRoles;
    const roles = Array.isArray(rawRoles)
      ? rawRoles
      : [
          { role: 'Banquet Captain', count: 1 },
          { role: 'Server', count: Math.max(1, Math.round((beo.guestCount ?? 10) / 15)) },
        ];

    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: scope.venueId },
      select: { organizationId: true },
    });

    const operationalDate = beo.serviceDate || (beo.serviceStartAt ? beo.serviceStartAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

    const workers = roles.flatMap((r: any) => {
      const rawCount = Number(r?.count);
      const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(Math.floor(rawCount), 50)) : 1;
      const roleName = typeof r?.role === 'string' && r.role.trim() ? r.role.trim() : 'Staff';
      return Array.from({ length: count }, (_, i) => ({
        workerName: `${roleName} ${i + 1}`,
        workerRole: roleName,
        assignedStation: beo.venueSpace || 'Banquet Floor',
        shiftHours: typeof r?.hours === 'string' && r.hours.trim() ? r.hours.trim() : '4.0',
        notes: `Auto-synced from BEO ${beo.eventName}`,
      }));
    });

    const roster = await this.dailyRosterService.syncBanquetStaffToRoster({
      organizationId: venue.organizationId,
      facilityId: scope.venueId,
      actorUserId: scope.userId,
      actorRole: scope.role,
      actorAllAccess: scope.allAccess,
      dto: {
        operationalDate,
        eventName: beo.eventName,
        beoId: beo.id,
        workers,
      },
    });

    // Update staffing slice in BEO with synced state
    const updatedSlices = {
      ...(slices || {}),
      staffing: {
        ...(slices?.staffing || {}),
        rosterSynced: true,
        rosterSyncedAt: new Date().toISOString(),
        rosterId: (roster as any).roster?.id ?? (roster as any).rosterId,
      },
    };

    await withTenantTransaction(
      this.prisma,
      async (tx) => {
        return tx.crmBeo.update({
          where: { id: beo.id },
          data: { departmentSlices: updatedSlices },
        });
      },
      { venueId: scope.venueId },
    );

    return { ok: true, rosterId: (roster as any).roster?.id ?? (roster as any).rosterId, workersSynced: workers.length };
  }
}

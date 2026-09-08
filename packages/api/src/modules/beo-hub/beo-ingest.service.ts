import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type BeoStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { EventBeoReportService } from '../stadium/event-beo-report.service';
import type { CanonicalBeoInput } from './adapters/canonical-beo.types';

export interface IngestResult {
  id: string;
  externalSource: string;
  externalId: string;
  status: BeoStatus;
  isDuplicate: boolean;
  needsReview: boolean;
  eventId: string | null;
}

@Injectable()
export class BeoIngestService {
  private readonly logger = new Logger(BeoIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBeoReportService: EventBeoReportService,
  ) {}

  /**
   * Idempotent ingest of canonical BEO document into Venue Wrangler operations hub.
   * Keyed on (venueId, externalSource, externalId).
   */
  async ingestCanonicalBeo(venueId: string, input: CanonicalBeoInput): Promise<IngestResult> {
    const { externalSource, externalId } = input;
    if (!venueId || !externalSource || !externalId) {
      throw new Error('venueId, externalSource, and externalId are required for BEO ingest');
    }

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, organizationId: true, timezone: true },
    });
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);

    const facilityId = venue.id;

    // 1. Check for existing BEO by idempotent key
    const existing = await this.prisma.crmBeo.findUnique({
      where: {
        venueId_externalSource_externalId: {
          venueId,
          externalSource,
          externalId,
        },
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        sourceUpdatedAt: true,
        layoutJson: true,
        eventId: true,
      },
    });

    // Detect exact duplicate delivery
    const incomingSourceUpdated = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null;
    if (
      existing &&
      incomingSourceUpdated &&
      existing.sourceUpdatedAt &&
      incomingSourceUpdated.getTime() <= existing.sourceUpdatedAt.getTime()
    ) {
      this.logger.debug?.(
        `Duplicate ingest ignored for ${venueId}/${externalSource}/${externalId} (existing sourceUpdatedAt >= incoming).`
      );
      return {
        id: existing.id,
        externalSource,
        externalId,
        status: existing.status,
        isDuplicate: true,
        needsReview: existing.status === 'needs_review',
        eventId: existing.eventId,
      };
    }

    // 2. Validate space & times: flag needs_review if missing
    const hasSpace = Boolean(input.spaceId?.trim() || input.venueSpace?.trim());
    const startAt = input.serviceStartAt ? new Date(input.serviceStartAt) : null;
    const endAt = input.serviceEndAt ? new Date(input.serviceEndAt) : null;
    const hasValidTimes = Boolean(startAt && endAt && !isNaN(startAt.getTime()) && !isNaN(endAt.getTime()));

    let computedStatus: BeoStatus = input.status ?? 'confirmed';
    let needsReview = false;

    if (!hasSpace || !hasValidTimes) {
      computedStatus = 'needs_review';
      needsReview = true;
    }

    // Compute serviceDate (YYYY-MM-DD)
    let serviceDate = input.serviceDate ?? null;
    if (!serviceDate && startAt && !isNaN(startAt.getTime())) {
      serviceDate = startAt.toISOString().slice(0, 10);
    }

    // 3. Resolve or match Space / Zone in Facility
    let spaceId = input.spaceId?.trim() ?? null;
    let venueSpace = input.venueSpace?.trim() ?? null;

    if (!spaceId && venueSpace) {
      const matchedZone = await this.prisma.facilityZone.findFirst({
        where: {
          facilityId,
          active: true,
          OR: [
            { name: { equals: venueSpace, mode: 'insensitive' } },
            { code: { equals: venueSpace, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true },
      });
      if (matchedZone) {
        spaceId = matchedZone.id;
        venueSpace = matchedZone.name;
      }
    }

    // 4. Resolve or create VenueEvent
    let resolvedEventId = input.eventId ?? existing?.eventId ?? null;

    if (resolvedEventId) {
      const ev = await this.prisma.venueEvent.findFirst({
        where: { id: resolvedEventId, venueId },
        select: { id: true },
      });
      if (!ev) resolvedEventId = null;
    }

    if (!resolvedEventId && input.eventName && (startAt || serviceDate)) {
      const matchStart = startAt ?? new Date(`${serviceDate}T00:00:00Z`);
      const dayStart = new Date(matchStart);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const matchedEvent = await this.prisma.venueEvent.findFirst({
        where: {
          venueId,
          title: { equals: input.eventName.trim(), mode: 'insensitive' },
          startsAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true },
      });

      if (matchedEvent) {
        resolvedEventId = matchedEvent.id;
      } else if (hasValidTimes && startAt) {
        // Create matching VenueEvent rather than orphaning the BEO
        const createdEvent = await this.prisma.venueEvent.create({
          data: {
            venueId,
            organizationId: venue.organizationId,
            title: input.eventName.trim(),
            startsAt: startAt,
            endsAt: endAt ?? new Date(startAt.getTime() + 4 * 3600 * 1000),
            expectedGuests: input.guestCount ?? null,
            createdBy: 'beo-ingest',
          },
          select: { id: true },
        });
        resolvedEventId = createdEvent?.id ?? null;
      }
    }

    // 5. Persist BEO via Tenant Transaction
    const savedBeo = await withTenantTransaction(
      this.prisma,
      async (tx) => {
        const beoData: Prisma.CrmBeoUncheckedCreateInput = {
          venueId,
          facilityId,
          eventId: resolvedEventId,
          spaceId,
          venueSpace: venueSpace ?? (spaceId ? undefined : 'Unassigned Space'),
          externalSource,
          externalId,
          eventName: input.eventName.trim() || 'Untitled BEO',
          serviceDate,
          loadInAt: input.loadInAt ? new Date(input.loadInAt) : null,
          serviceStartAt: startAt,
          serviceEndAt: endAt,
          loadOutAt: input.loadOutAt ? new Date(input.loadOutAt) : null,
          guestCount: input.guestCount ?? null,
          status: computedStatus,
          departmentSlices: (input.departmentSlices as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          layoutJson: (input.layoutJson as Prisma.InputJsonValue) ?? (existing?.layoutJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          sourcePayload: (input.sourcePayload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          sourceFileUrl: input.sourceFileUrl ?? null,
          sourceUpdatedAt: incomingSourceUpdated ?? new Date(),
          leadId: input.leadId ?? null,
          fbMinimumCents: input.fbMinimumCents ?? null,
          depositCents: input.depositCents ?? null,
          specialRequirements: input.specialRequirements ?? null,
          internalNotes: input.internalNotes ?? null,
          assignedRepId: input.assignedRepId ?? null,
        };

        if (existing) {
          return tx.crmBeo.update({
            where: { id: existing.id },
            data: {
              ...beoData,
              // Preserve existing layoutJson if incoming did not supply new one
              layoutJson: input.layoutJson !== undefined ? (input.layoutJson as Prisma.InputJsonValue) : (existing.layoutJson as Prisma.InputJsonValue),
            },
          });
        }

        return tx.crmBeo.create({ data: beoData });
      },
      { venueId },
    );

    // 6. If event starts inside 36 hours, trigger EventBeoReport scheduled publish
    if (resolvedEventId) {
      try {
        const now = new Date();
        const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
        const event = await this.prisma.venueEvent.findFirst({
          where: {
            id: resolvedEventId,
            venueId,
            startsAt: { gte: now, lte: windowEnd },
          },
          select: { id: true },
        });

        if (event) {
          await this.eventBeoReportService
            .publish(venueId, event.id, { profileId: 'system', fullName: 'BEO Ingest Sync' }, 'scheduled')
            .catch((err) => {
              this.logger.warn(`BEO report publish skip for ${event.id}: ${(err as Error).message}`);
            });
        }
      } catch (err) {
        this.logger.warn(`Failed 36h check for event report publish: ${(err as Error).message}`);
      }
    }

    return {
      id: savedBeo.id,
      externalSource,
      externalId,
      status: savedBeo.status,
      isDuplicate: false,
      needsReview,
      eventId: savedBeo.eventId,
    };
  }
}

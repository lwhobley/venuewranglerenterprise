import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StaffShiftResponse } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertScope, type Identity } from './auth';
import { CreateStaffingDemandDto, CreateStaffShiftDto, OfflineAttendanceClaimDto, RespondToShiftDto, ReviewAttendanceClaimDto, StaffAttendanceCorrectionDto, UpdateStaffingDemandDto, UpdateStaffShiftDto } from './staffing.dto';
import { PrismaService } from './prisma.service';
import { PushNotificationsService } from './push-notifications.service';

@Injectable()
export class StaffingService {
  private readonly logger = new Logger(StaffingService.name);
  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  async list(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    const manager = identity.capabilities.includes('operations:write') || identity.capabilities.includes('tenant:admin');
    return this.prisma.withTenant(identity, (tx) => tx.staffShift.findMany({
      where: {
        organizationId: identity.tenantId,
        eventId,
        AND: [
          ...(!identity.capabilities.includes('tenant:admin') ? [
            { venueId: { in: identity.venueIds } },
            { OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] },
          ] : []),
          ...(!manager ? [{ OR: [{ assignedSubject: identity.subject }, { assignedSubject: null, state: 'PUBLISHED' as const }] }] : []),
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        breaks: { orderBy: { startedAt: 'asc' } },
        attendanceClaims: { where: { status: 'PENDING_REVIEW' }, orderBy: { receivedAt: 'asc' } },
      },
    }));
  }

  async coverageRequirements(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId }, select: { id: true, venueId: true } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:write', eventId, event.venueId);
      const demands = await tx.staffingDemand.findMany({
        where: { organizationId: identity.tenantId, eventId, ...(!identity.capabilities.includes('tenant:admin') ? { venueId: { in: identity.venueIds }, OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] } : {}) },
        orderBy: [{ startsAt: 'asc' }, { role: 'asc' }],
      });
      const coverage = [];
      for (const demand of demands) {
        const shifts = await tx.staffShift.findMany({ where: {
          organizationId: identity.tenantId, eventId, venueId: demand.venueId, ...(demand.locationId !== null ? { locationId: demand.locationId } : {}),
          role: demand.role, state: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { lte: demand.startsAt }, endsAt: { gte: demand.endsAt },
        }, select: { id: true, state: true, response: true, responseRevision: true, revision: true, assignedSubject: true } });
        const vendorRequests = await tx.staffingVendorRequest.findMany({
          where: { organizationId: identity.tenantId, demandId: demand.id, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } },
          select: { state: true, requestedHeadcount: true, committedHeadcount: true },
        });
        const scheduled = shifts.length;
        const published = shifts.filter((shift) => shift.state === 'PUBLISHED').length;
        const assigned = shifts.filter((shift) => shift.assignedSubject !== null).length;
        const confirmed = shifts.filter((shift) => shift.state === 'PUBLISHED' && shift.assignedSubject !== null && shift.response === 'ACKNOWLEDGED' && shift.responseRevision === shift.revision).length;
        const vendorRequested = vendorRequests.reduce((total, request) => total + request.requestedHeadcount, 0);
        const vendorCommitted = vendorRequests.reduce((total, request) => total + request.committedHeadcount, 0);
        const vendorReserved = vendorRequests.reduce((total, request) => total + (['SENT', 'ACKNOWLEDGED'].includes(request.state) ? request.requestedHeadcount : request.committedHeadcount), 0);
        coverage.push({ ...demand, scheduledHeadcount: scheduled, publishedHeadcount: published, assignedHeadcount: assigned, confirmedHeadcount: confirmed, vendorRequestedHeadcount: vendorRequested, vendorCommittedHeadcount: vendorCommitted, vendorReservedHeadcount: vendorReserved, unfilledHeadcount: Math.max(0, demand.requiredHeadcount - scheduled - vendorReserved), unconfirmedHeadcount: Math.max(0, demand.requiredHeadcount - confirmed) });
      }
      return coverage;
    });
  }

  async forecastCoverage(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, organizationId: identity.tenantId },
        select: { id: true, venueId: true, startsAt: true },
      });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:write', eventId, event.venueId);
      const history = await tx.event.findMany({
        where: {
          organizationId: identity.tenantId,
          venueId: event.venueId,
          startsAt: { lt: event.startsAt },
        },
        orderBy: { startsAt: 'desc' },
        take: 20,
        select: { id: true, startsAt: true },
      });
      if (history.length === 0) return [];
      const startsByEvent = new Map(history.map((row) => [row.id, row.startsAt]));
      const demands = await tx.staffingDemand.findMany({
        where: {
          organizationId: identity.tenantId,
          venueId: event.venueId,
          eventId: { in: history.map((row) => row.id) },
          ...(!identity.capabilities.includes('tenant:admin')
            ? { OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] }
            : {}),
        },
        orderBy: [{ role: 'asc' }, { startsAt: 'asc' }],
      });
      type Sample = { eventId: string; startsOffset: number; endsOffset: number; headcount: number; qualifications: string[] };
      const groups = new Map<string, { role: string; locationId: string | null; samples: Map<string, Sample> }>();
      for (const demand of demands) {
        const historicalStart = startsByEvent.get(demand.eventId);
        if (!historicalStart) continue;
        const startsOffset = Math.round((demand.startsAt.getTime() - historicalStart.getTime()) / 1_800_000) * 30;
        const durationMinutes = (demand.endsAt.getTime() - demand.startsAt.getTime()) / 60_000;
        const durationBucket = Math.round(durationMinutes / 60);
        const key = `${demand.role.trim().toLocaleLowerCase()}|${demand.locationId ?? ''}|${startsOffset}|${durationBucket}`;
        const group = groups.get(key) ?? { role: demand.role, locationId: demand.locationId, samples: new Map<string, Sample>() };
        const sample: Sample = {
          eventId: demand.eventId,
          startsOffset,
          endsOffset: startsOffset + durationBucket * 60,
          headcount: demand.requiredHeadcount,
          qualifications: demand.requiredQualificationCodes,
        };
        const existing = group.samples.get(demand.eventId);
        if (existing) {
          existing.headcount = Math.max(existing.headcount, sample.headcount);
          existing.qualifications = existing.qualifications.filter((code) => sample.qualifications.includes(code));
        } else group.samples.set(demand.eventId, sample);
        groups.set(key, group);
      }
      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      };
      return [...groups.values()].map((group) => {
        const samples = [...group.samples.values()];
        const sampleEventCount = new Set(samples.map((sample) => sample.eventId)).size;
        const qualificationSets = samples.map((sample) => new Set(sample.qualifications));
        const commonQualifications = [...(qualificationSets[0] ?? new Set<string>())]
          .filter((code) => qualificationSets.every((codes) => codes.has(code)))
          .sort();
        return {
          role: group.role,
          locationId: group.locationId,
          startsOffsetMinutes: Math.round(median(samples.map((sample) => sample.startsOffset))),
          endsOffsetMinutes: Math.round(median(samples.map((sample) => sample.endsOffset))),
          requiredHeadcount: Math.ceil(median(samples.map((sample) => sample.headcount))),
          requiredQualificationCodes: commonQualifications,
          sampleCount: samples.length,
          sampleEventCount,
          confidence: sampleEventCount < 3 ? 'LIMITED_HISTORY' : 'HISTORICAL_BASELINE',
          source: 'HISTORICAL_PLANNED_DEMAND',
        };
      }).sort((a, b) => a.startsOffsetMinutes - b.startsOffsetMinutes || a.role.localeCompare(b.role));
    });
  }

  async createCoverageRequirement(identity: Identity, eventId: string, dto: CreateStaffingDemandDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    const role = dto.role.trim();
    if (role.length < 2) throw new BadRequestException('Coverage role must contain at least two characters.');
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new BadRequestException('Coverage window must have a valid start and a later end.');
    const requiredQualificationCodes = this.normalizeQualificationCodes(dto.requiredQualificationCodes);
    const input = { eventId, venueId: dto.venueId, locationId: dto.locationId ?? null, role, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), requiredHeadcount: dto.requiredHeadcount, requiredQualificationCodes };
    return this.command(identity, key, 'staffing-coverage.create', input, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      const demand = await tx.staffingDemand.create({ data: {
        organizationId: identity.tenantId, eventId, venueId: dto.venueId, locationId: dto.locationId,
        role, startsAt, endsAt, requiredHeadcount: dto.requiredHeadcount, requiredQualificationCodes,
        createdBy: identity.subject, updatedBy: identity.subject,
      } });
      await this.auditDemand(tx, identity, demand.id, 'created', undefined, demand);
      return demand;
    });
  }

  async updateCoverageRequirement(identity: Identity, eventId: string, demandId: string, dto: UpdateStaffingDemandDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('A reason of at least three characters is required for a coverage change.');
    if (dto.role !== undefined && dto.role.trim().length < 2) throw new BadRequestException('Coverage role must contain at least two characters.');
    const patch = {
      ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
      ...(dto.role !== undefined ? { role: dto.role.trim() } : {}),
      ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
      ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
      ...(dto.requiredHeadcount !== undefined ? { requiredHeadcount: dto.requiredHeadcount } : {}),
      ...(dto.requiredQualificationCodes !== undefined ? { requiredQualificationCodes: this.normalizeQualificationCodes(dto.requiredQualificationCodes) } : {}),
    };
    if ((patch.startsAt && !Number.isFinite(patch.startsAt.getTime())) || (patch.endsAt && !Number.isFinite(patch.endsAt.getTime()))) throw new BadRequestException('Coverage window timestamps must be valid.');
    if (Object.keys(patch).length === 0) throw new BadRequestException('Provide at least one coverage change.');
    return this.command(identity, key, 'staffing-coverage.update', { eventId, demandId, patch: { ...patch, startsAt: patch.startsAt?.toISOString(), endsAt: patch.endsAt?.toISOString() }, reason }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-demand:${identity.tenantId}:${demandId}`}, 0))`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`vendor-demand:${identity.tenantId}:${demandId}`}, 0))`;
      const current = await tx.staffingDemand.findFirst({ where: { id: demandId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Coverage requirement not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (patch.locationId) {
        assertScope(identity, 'operations:write', eventId, current.venueId, patch.locationId);
        if (!await tx.location.findFirst({ where: { id: patch.locationId, venueId: current.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      }
      const startsAt = patch.startsAt ?? current.startsAt;
      const endsAt = patch.endsAt ?? current.endsAt;
      if (endsAt <= startsAt) throw new BadRequestException('Coverage window must have a later end than start.');
      const shapeChanged = (patch.locationId !== undefined && patch.locationId !== current.locationId)
        || (patch.role !== undefined && patch.role !== current.role)
        || (patch.startsAt !== undefined && patch.startsAt.getTime() !== current.startsAt.getTime())
        || (patch.endsAt !== undefined && patch.endsAt.getTime() !== current.endsAt.getTime())
        || (patch.requiredQualificationCodes !== undefined && JSON.stringify(patch.requiredQualificationCodes) !== JSON.stringify(current.requiredQualificationCodes));
      if (shapeChanged && await tx.staffShift.count({ where: { organizationId: identity.tenantId, staffingDemandId: demandId, state: { in: ['DRAFT', 'PUBLISHED'] } } })) {
        throw new ConflictException('Edit or cancel generated shifts before changing the role, area, qualification, or coverage window.');
      }
      if (shapeChanged && await tx.staffingVendorRequest.count({ where: { organizationId: identity.tenantId, demandId, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } } })) {
        throw new ConflictException('Resolve or cancel outstanding vendor requests before changing the role, area, qualification, or coverage window.');
      }
      if (patch.requiredHeadcount !== undefined) {
        const [scheduled, requests] = await Promise.all([
          tx.staffShift.count({ where: { organizationId: identity.tenantId, eventId, venueId: current.venueId, ...(current.locationId !== null ? { locationId: current.locationId } : {}), role: current.role, state: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { lte: current.startsAt }, endsAt: { gte: current.endsAt } } }),
          tx.staffingVendorRequest.findMany({ where: { organizationId: identity.tenantId, demandId, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } }, select: { state: true, requestedHeadcount: true, committedHeadcount: true } }),
        ]);
        const reserved = requests.reduce((total, request) => total + (['SENT', 'ACKNOWLEDGED'].includes(request.state) ? request.requestedHeadcount : request.committedHeadcount), 0);
        if (patch.requiredHeadcount < scheduled + reserved) throw new ConflictException('The target cannot be lower than its scheduled shifts and active vendor reservations.');
      }
      const updated = await tx.staffingDemand.update({ where: { id: demandId }, data: { ...patch, updatedBy: identity.subject } });
      const changed = ['role', 'locationId', 'startsAt', 'endsAt', 'requiredHeadcount', 'requiredQualificationCodes'].some((field) => JSON.stringify(current[field as keyof typeof current]) !== JSON.stringify(updated[field as keyof typeof updated]));
      if (!changed) throw new ConflictException('The coverage requirement has no changes to save.');
      await this.auditDemand(tx, identity, demandId, 'updated', current, updated, reason);
      return updated;
    });
  }

  async generateCoverageShifts(identity: Identity, eventId: string, demandId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'staffing-coverage.generate', { eventId, demandId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-demand:${identity.tenantId}:${demandId}`}, 0))`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`vendor-demand:${identity.tenantId}:${demandId}`}, 0))`;
      const demand = await tx.staffingDemand.findFirst({ where: { id: demandId, eventId, organizationId: identity.tenantId } });
      if (!demand) throw new NotFoundException('Coverage requirement not found.');
      assertScope(identity, 'operations:write', eventId, demand.venueId, demand.locationId ?? undefined);
      const existing = await tx.staffShift.count({ where: {
        organizationId: identity.tenantId, eventId, venueId: demand.venueId, ...(demand.locationId !== null ? { locationId: demand.locationId } : {}),
        role: demand.role, state: { in: ['DRAFT', 'PUBLISHED'] }, startsAt: { lte: demand.startsAt }, endsAt: { gte: demand.endsAt },
      } });
      const requests = await tx.staffingVendorRequest.findMany({ where: { organizationId: identity.tenantId, demandId, state: { in: ['SENT', 'ACKNOWLEDGED', 'PARTIALLY_COMMITTED', 'COMMITTED'] } }, select: { state: true, requestedHeadcount: true, committedHeadcount: true } });
      const reserved = requests.reduce((total, request) => total + (['SENT', 'ACKNOWLEDGED'].includes(request.state) ? request.requestedHeadcount : request.committedHeadcount), 0);
      const deficit = Math.max(0, demand.requiredHeadcount - existing - reserved);
      const created = [];
      for (let index = 0; index < deficit; index += 1) {
        const shift = await tx.staffShift.create({ data: {
          organizationId: identity.tenantId, eventId, venueId: demand.venueId, locationId: demand.locationId,
          staffingDemandId: demand.id, role: demand.role, requiredQualificationCodes: demand.requiredQualificationCodes,
          startsAt: demand.startsAt, endsAt: demand.endsAt, createdBy: identity.subject, updatedBy: identity.subject,
        } });
        await this.audit(tx, identity, shift.id, 'created_from_coverage_demand', undefined, shift);
        created.push(shift);
      }
      return { demandId: demand.id, requiredHeadcount: demand.requiredHeadcount, createdShifts: created, scheduledHeadcount: existing + created.length, vendorReservedHeadcount: reserved, unfilledHeadcount: Math.max(0, demand.requiredHeadcount - existing - created.length - reserved) };
    });
  }

  async assignmentSuggestions(identity: Identity, eventId: string, shiftId: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const shift = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!shift) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, shift.venueId, shift.locationId ?? undefined);
      if (shift.state !== 'DRAFT' || shift.attendance !== 'NOT_STARTED') throw new ConflictException('Staff recommendations are only available before publishing or starting a shift.');

      const subjects = [...new Set(identity.assignableUserIds)].sort();
      if (subjects.length === 0) return { shiftId, availabilitySignal: 'NO_RECORDED_CONFLICT_ONLY', recommendations: [], excludedCount: 0, message: 'The signed identity has no assignable workers for this event.' };
      const people = await tx.person.findMany({ where: { organizationId: identity.tenantId, active: true, externalSubject: { in: subjects } }, select: { id: true, externalSubject: true, displayName: true }, orderBy: { displayName: 'asc' } });
      if (people.length === 0) return { shiftId, availabilitySignal: 'NO_RECORDED_CONFLICT_ONLY', recommendations: [], excludedCount: 0, message: 'No active assignable roster members were found.' };

      const [policy] = await tx.$queryRaw<Array<{ minimum_rest_minutes: number | null }>>`SELECT minimum_rest_minutes FROM organizations WHERE id = ${identity.tenantId}::uuid`;
      const restMs = (policy?.minimum_rest_minutes ?? 0) * 60_000;
      const restStart = new Date(shift.startsAt.getTime() - restMs);
      const restEnd = new Date(shift.endsAt.getTime() + restMs);
      const [unavailable, conflicts, workload, qualifications] = await Promise.all([
        tx.staffUnavailability.findMany({ where: { organizationId: identity.tenantId, subject: { in: people.map((person) => person.externalSubject) }, deletedAt: null, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } }, select: { subject: true } }),
        tx.staffShift.findMany({ where: { organizationId: identity.tenantId, assignedSubject: { in: people.map((person) => person.externalSubject) }, state: 'PUBLISHED', id: { not: shiftId }, startsAt: { lt: restEnd }, endsAt: { gt: restStart } }, select: { assignedSubject: true } }),
        tx.staffShift.findMany({ where: { organizationId: identity.tenantId, eventId, assignedSubject: { in: people.map((person) => person.externalSubject) }, state: { in: ['DRAFT', 'PUBLISHED'] }, id: { not: shiftId } }, select: { assignedSubject: true, startsAt: true, endsAt: true } }),
        shift.requiredQualificationCodes.length === 0 ? Promise.resolve([]) : tx.personQualification.findMany({ where: { organizationId: identity.tenantId, personId: { in: people.map((person) => person.id) }, code: { in: shift.requiredQualificationCodes }, revokedAt: null, evidenceStatus: { in: ['NONE', 'VERIFIED'] }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date(Date.UTC(shift.endsAt.getUTCFullYear(), shift.endsAt.getUTCMonth(), shift.endsAt.getUTCDate())) } }] }, select: { personId: true, code: true } }),
      ]);
      const unavailableSubjects = new Set(unavailable.map((row) => row.subject));
      const conflictingSubjects = new Set(conflicts.map((row) => row.assignedSubject).filter((subject): subject is string => subject !== null));
      const qualifiedByPerson = new Map<string, Set<string>>();
      for (const qualification of qualifications) {
        const codes = qualifiedByPerson.get(qualification.personId) ?? new Set<string>();
        codes.add(qualification.code);
        qualifiedByPerson.set(qualification.personId, codes);
      }
      const workloadBySubject = new Map<string, { minutes: number; shifts: number }>();
      for (const assigned of workload) {
        if (!assigned.assignedSubject) continue;
        const load = workloadBySubject.get(assigned.assignedSubject) ?? { minutes: 0, shifts: 0 };
        load.minutes += Math.max(0, assigned.endsAt.getTime() - assigned.startsAt.getTime()) / 60_000;
        load.shifts += 1;
        workloadBySubject.set(assigned.assignedSubject, load);
      }
      const recommendations = [];
      let excludedCount = 0;
      for (const person of people) {
        const reasons: string[] = [];
        if (policy?.minimum_rest_minutes === null || policy === undefined) reasons.push('Tenant rest policy is not configured.');
        if (unavailableSubjects.has(person.externalSubject)) reasons.push('Worker has recorded unavailable time during this shift.');
        if (conflictingSubjects.has(person.externalSubject)) reasons.push('Worker has a published shift inside this shift or its required rest window.');
        const validCodes = qualifiedByPerson.get(person.id) ?? new Set<string>();
        const missing = shift.requiredQualificationCodes.filter((code) => !validCodes.has(code));
        if (missing.length > 0) reasons.push(`Missing current qualifications: ${missing.join(', ')}.`);
        if (reasons.length > 0) { excludedCount += 1; continue; }
        const load = workloadBySubject.get(person.externalSubject) ?? { minutes: 0, shifts: 0 };
        recommendations.push({ subject: person.externalSubject, displayName: person.displayName, eventAssignedMinutes: Math.round(load.minutes), eventAssignedShifts: load.shifts, availabilitySignal: 'NO_RECORDED_CONFLICT_ONLY' });
      }
      recommendations.sort((left, right) => left.eventAssignedMinutes - right.eventAssignedMinutes || left.eventAssignedShifts - right.eventAssignedShifts || left.displayName.localeCompare(right.displayName));
      return {
        shiftId,
        availabilitySignal: 'NO_RECORDED_CONFLICT_ONLY',
        recommendations: recommendations.slice(0, 8),
        eligibleCount: recommendations.length,
        excludedCount,
        message: recommendations.length === 0 ? 'No eligible assignable workers were found. Review the venue rest policy, qualifications, availability records, and identity assignment scope.' : 'Ranked by lowest scheduled minutes in this event. A manager must select a worker; the assignment endpoint rechecks all rules.',
      };
    });
  }

  async teamAvailability(identity: Identity, eventId: string, fromInput: string, toInput: string) {
    assertScope(identity, 'operations:write', eventId);
    const from = new Date(fromInput);
    const to = new Date(toInput);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Availability calendar range must be valid, ordered, and no longer than 31 days.');
    }
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId }, select: { id: true, venueId: true } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:write', eventId, event.venueId);
      const people = await tx.person.findMany({
        where: {
          organizationId: identity.tenantId,
          active: true,
          ...(!identity.capabilities.includes('tenant:admin') ? { externalSubject: { in: identity.assignableUserIds } } : {}),
        },
        select: { externalSubject: true, displayName: true },
        orderBy: { displayName: 'asc' },
      });
      const subjects = people.map((person) => person.externalSubject);
      if (subjects.length === 0) return [];
      const rows = await tx.staffUnavailability.findMany({
        where: { organizationId: identity.tenantId, subject: { in: subjects }, deletedAt: null, startsAt: { lt: to }, endsAt: { gt: from } },
        select: { id: true, subject: true, startsAt: true, endsAt: true },
        orderBy: [{ startsAt: 'asc' }, { subject: 'asc' }],
      });
      const names = new Map(people.map((person) => [person.externalSubject, person.displayName]));
      return rows.map((row) => ({ id: row.id, subject: row.subject, startsAt: row.startsAt, endsAt: row.endsAt, displayName: names.get(row.subject) ?? 'Roster member' }));
    });
  }

  async create(identity: Identity, eventId: string, dto: CreateStaffShiftDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    if (!dto.role.trim()) throw new ConflictException('Shift role must not be blank.');
    const start = new Date(dto.startsAt);
    const end = new Date(dto.endsAt);
    if (end <= start) throw new ConflictException('Shift end must be later than shift start.');
    const requiredQualificationCodes = this.normalizeQualificationCodes(dto.requiredQualificationCodes);
    const input = { eventId, venueId: dto.venueId, locationId: dto.locationId ?? null, assignedSubject: dto.assignedSubject ?? null, role: dto.role.trim(), instructions: dto.instructions?.trim() ?? '', requiredQualificationCodes, startsAt: start.toISOString(), endsAt: end.toISOString() };
    return this.command(identity, key, 'staff-shift.create', input, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      await this.assertAssignable(tx, identity, dto.assignedSubject);
      await this.assertQualified(tx, identity.tenantId, dto.assignedSubject, requiredQualificationCodes, end);
      await this.lockScheduleSubjects(tx, identity.tenantId, [dto.assignedSubject]);
      await this.assertAvailable(tx, identity.tenantId, dto.assignedSubject, start, end);
      await this.assertNoOverlap(tx, identity.tenantId, dto.assignedSubject, start, end);
      const shift = await tx.staffShift.create({ data: {
        organizationId: identity.tenantId, eventId, venueId: dto.venueId, locationId: dto.locationId,
        assignedSubject: dto.assignedSubject, role: input.role, instructions: input.instructions,
        startsAt: start, endsAt: end, requiredQualificationCodes, createdBy: identity.subject, updatedBy: identity.subject,
      } });
      await this.audit(tx, identity, shift.id, 'created', undefined, shift);
      return shift;
    });
  }

  async update(identity: Identity, eventId: string, shiftId: string, dto: UpdateStaffShiftDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    if (dto.role !== undefined && (typeof dto.role !== 'string' || dto.role.trim().length < 2)) throw new ConflictException('Shift role must contain at least two characters.');
    const normalized = { ...dto, role: dto.role?.trim(), instructions: dto.instructions === null ? '' : dto.instructions?.trim(), requiredQualificationCodes: dto.requiredQualificationCodes === undefined ? undefined : this.normalizeQualificationCodes(dto.requiredQualificationCodes), startsAt: dto.startsAt ? new Date(dto.startsAt).toISOString() : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt).toISOString() : undefined };
    const result = await this.command(identity, key, 'staff-shift.update', { eventId, shiftId, patch: normalized }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state === 'CANCELLED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('A cancelled or started shift cannot be edited.');
      const start = normalized.startsAt ? new Date(normalized.startsAt) : current.startsAt;
      const end = normalized.endsAt ? new Date(normalized.endsAt) : current.endsAt;
      if (end <= start) throw new ConflictException('Shift end must be later than shift start.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: current.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      if (dto.locationId) assertScope(identity, 'operations:write', eventId, current.venueId, dto.locationId);
      if (dto.assignedSubject !== undefined && dto.assignedSubject !== null) await this.assertAssignable(tx, identity, dto.assignedSubject);
      const materialChange = (dto.locationId !== undefined && dto.locationId !== current.locationId)
        || (dto.assignedSubject !== undefined && dto.assignedSubject !== current.assignedSubject)
        || (dto.role !== undefined && normalized.role !== current.role)
        || (dto.instructions !== undefined && normalized.instructions !== current.instructions)
        || (normalized.requiredQualificationCodes !== undefined && JSON.stringify(normalized.requiredQualificationCodes) !== JSON.stringify(current.requiredQualificationCodes))
        || (dto.startsAt !== undefined && start.getTime() !== current.startsAt.getTime())
        || (dto.endsAt !== undefined && end.getTime() !== current.endsAt.getTime());
      if (!materialChange) throw new ConflictException('No shift changes were supplied.');
      if (current.state === 'PUBLISHED') {
        const assignedSubject = dto.assignedSubject === undefined ? current.assignedSubject : dto.assignedSubject;
        await this.lockScheduleSubjects(tx, identity.tenantId, [current.assignedSubject, assignedSubject]);
      }
      const nextSubject = dto.assignedSubject === undefined ? current.assignedSubject : dto.assignedSubject;
      const nextQualifications = normalized.requiredQualificationCodes ?? current.requiredQualificationCodes;
      if (current.state !== 'PUBLISHED') await this.lockScheduleSubjects(tx, identity.tenantId, [nextSubject]);
      await this.assertQualified(tx, identity.tenantId, nextSubject, nextQualifications, end);
      await this.assertAvailable(tx, identity.tenantId, nextSubject, start, end);
      await this.assertNoOverlap(tx, identity.tenantId, nextSubject, start, end, shiftId);
      const patchData = {
        ...dto,
        role: normalized.role,
        instructions: normalized.instructions,
        requiredQualificationCodes: normalized.requiredQualificationCodes,
        startsAt: dto.startsAt ? start : undefined,
        endsAt: dto.endsAt ? end : undefined,
        ...(current.state === 'PUBLISHED' ? { revision: { increment: 1 }, response: StaffShiftResponse.PENDING, responseRevision: null } : {}),
        updatedBy: identity.subject,
      };
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: patchData });
      await this.audit(tx, identity, shiftId, 'updated', current, updated);
      const assignedSubject = updated.assignedSubject ?? current.assignedSubject;
      const notification = current.state === 'PUBLISHED' && materialChange
        ? await this.notification(tx, identity, updated, assignedSubject, 'staffing.shift.updated')
        : null;
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  async publish(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const result = await this.command(identity, key, 'staff-shift.publish', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state !== 'DRAFT') throw new ConflictException('Only a draft shift can be published.');
      await this.assertAssignable(tx, identity, current.assignedSubject ?? undefined);
      await this.assertQualified(tx, identity.tenantId, current.assignedSubject, current.requiredQualificationCodes, current.endsAt);
      await this.lockScheduleSubjects(tx, identity.tenantId, [current.assignedSubject]);
      await this.assertAvailable(tx, identity.tenantId, current.assignedSubject, current.startsAt, current.endsAt);
      await this.assertNoOverlap(tx, identity.tenantId, current.assignedSubject, current.startsAt, current.endsAt, shiftId);
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { state: 'PUBLISHED', response: 'PENDING', responseRevision: null, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, 'published', current, updated);
      const notification = await this.notification(tx, identity, updated, updated.assignedSubject, 'staffing.shift.published');
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  async claim(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, 'staff-shift.claim', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject || current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('This open shift is no longer available.');
      const activePerson = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: identity.subject, active: true }, select: { id: true } });
      if (!activePerson) throw new ForbiddenException('An active organization roster record is required to claim a shift.');
      await this.assertQualified(tx, identity.tenantId, identity.subject, current.requiredQualificationCodes, current.endsAt);
      await this.lockScheduleSubjects(tx, identity.tenantId, [identity.subject]);
      await this.assertAvailable(tx, identity.tenantId, identity.subject, current.startsAt, current.endsAt);
      await this.assertNoOverlap(tx, identity.tenantId, identity.subject, current.startsAt, current.endsAt, shiftId);
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: {
        assignedSubject: identity.subject,
        revision: { increment: 1 },
        response: 'PENDING',
        responseRevision: null,
        updatedBy: identity.subject,
      } });
      await this.audit(tx, identity, shiftId, 'claimed', current, updated);
      return updated;
    });
  }

  async respond(identity: Identity, eventId: string, shiftId: string, dto: RespondToShiftDto, key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, `staff-shift.${dto.response.toLowerCase()}`, { eventId, shiftId, response: dto.response, reason: dto.reason?.trim() ?? '' }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may respond to this shift.');
      if (current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('Only a current published shift can be acknowledged or declined.');
      if (dto.response === 'ACKNOWLEDGED') await this.assertQualified(tx, identity.tenantId, identity.subject, current.requiredQualificationCodes, current.endsAt);
      if (current.response !== 'PENDING' && current.responseRevision === current.revision) throw new ConflictException('This shift version already has a response.');
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { response: dto.response, responseRevision: current.revision, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, dto.response.toLowerCase(), current, updated, dto.reason?.trim());
      return updated;
    });
  }

  async attendance(identity: Identity, eventId: string, shiftId: string, action: 'check-in' | 'check-out', key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, `staff-shift.${action}`, { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, current.venueId, current.locationId ?? undefined);
      if (current.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may record attendance.');
      if (current.state !== 'PUBLISHED' || current.response !== 'ACKNOWLEDGED' || current.responseRevision !== current.revision) throw new ConflictException('Acknowledge the current published shift before recording attendance.');
      if (action === 'check-in') await this.assertQualified(tx, identity.tenantId, identity.subject, current.requiredQualificationCodes, current.endsAt);
      if (action === 'check-in' && current.attendance !== 'NOT_STARTED') throw new ConflictException('Attendance has already started.');
      if (action === 'check-out' && current.attendance !== 'CHECKED_IN') throw new ConflictException('Check in before checking out.');
      if (action === 'check-out' && await tx.staffBreak.findFirst({ where: { organizationId: identity.tenantId, shiftId, endedAt: null }, select: { id: true } })) throw new ConflictException('End the active break before checking out.');
      const now = new Date();
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: action === 'check-in'
        ? { attendance: 'CHECKED_IN', checkedInAt: now, updatedBy: identity.subject }
        : { attendance: 'CHECKED_OUT', checkedOutAt: now, updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, action, current, updated);
      return updated;
    });
  }

  async correctAttendance(identity: Identity, eventId: string, shiftId: string, dto: StaffAttendanceCorrectionDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('An attendance correction reason of at least three characters is required.');
    if (dto.checkedInAt === undefined && dto.checkedOutAt === undefined) throw new BadRequestException('Provide a corrected check-in or check-out time.');
    const input = { eventId, shiftId, checkedInAt: dto.checkedInAt, checkedOutAt: dto.checkedOutAt, reason };
    return this.command(identity, key, 'staff-attendance.correct', input, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.attendance === 'NOT_STARTED' || !current.checkedInAt) throw new ConflictException('The shift has no recorded attendance to correct.');
      if (await tx.staffAttendanceClaim.findFirst({ where: { organizationId: identity.tenantId, shiftId, status: 'PENDING_REVIEW' }, select: { id: true } })) throw new ConflictException('Review pending offline attendance claims before correcting the shift.');
      if (dto.checkedOutAt !== undefined && current.attendance !== 'CHECKED_OUT') throw new ConflictException('A check-out time can only be corrected after the shift is checked out.');
      const checkedInAt = dto.checkedInAt === undefined ? current.checkedInAt : new Date(dto.checkedInAt);
      const checkedOutAt = dto.checkedOutAt === undefined ? current.checkedOutAt : new Date(dto.checkedOutAt);
      if ((dto.checkedInAt === undefined || checkedInAt.getTime() === current.checkedInAt.getTime())
        && (dto.checkedOutAt === undefined || checkedOutAt?.getTime() === current.checkedOutAt?.getTime())) throw new ConflictException('The corrected times must change at least one recorded value.');
      const latestAllowed = new Date(Date.now() + 5 * 60_000);
      if (checkedInAt > latestAllowed || (checkedOutAt && checkedOutAt > latestAllowed)) throw new BadRequestException('Corrected attendance times cannot be more than five minutes in the future.');
      if (checkedOutAt && checkedOutAt < checkedInAt) throw new BadRequestException('Check-out must be at or after check-in.');
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: {
        ...(dto.checkedInAt !== undefined ? { checkedInAt } : {}),
        ...(dto.checkedOutAt !== undefined ? { checkedOutAt } : {}),
        updatedBy: identity.subject,
      } });
      await this.audit(tx, identity, shiftId, 'attendance.corrected', current, updated, reason);
      return updated;
    });
  }

  async submitOfflineAttendance(identity: Identity, eventId: string, shiftId: string, dto: OfflineAttendanceClaimDto, key: string) {
    assertScope(identity, 'operations:read', eventId);
    const recordedAt = new Date(dto.recordedAt);
    const now = new Date();
    if (!Number.isFinite(recordedAt.getTime()) || recordedAt > new Date(now.getTime() + 5 * 60_000) || recordedAt < new Date(now.getTime() - 48 * 60 * 60_000)) {
      throw new BadRequestException('Offline attendance time must be within the prior 48 hours and cannot be more than five minutes in the future.');
    }
    return this.command(identity, key, 'staff-attendance.offline-claim', { eventId, shiftId, action: dto.action, recordedAt: recordedAt.toISOString() }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const shift = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!shift) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, shift.venueId, shift.locationId ?? undefined);
      if (shift.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may submit an offline attendance claim.');
      if (shift.state !== 'PUBLISHED' || shift.response !== 'ACKNOWLEDGED' || shift.responseRevision !== shift.revision) throw new ConflictException('Acknowledge the current published shift before submitting an attendance claim.');
      if (dto.action === 'CHECK_IN' && shift.attendance !== 'NOT_STARTED') throw new ConflictException('This shift already has a recorded check-in.');
      if (dto.action === 'CHECK_OUT' && shift.attendance !== 'CHECKED_IN') {
        const pendingCheckIn = shift.attendance === 'NOT_STARTED' && await tx.staffAttendanceClaim.findFirst({ where: { organizationId: identity.tenantId, shiftId, workerSubject: identity.subject, action: 'CHECK_IN', status: 'PENDING_REVIEW' }, select: { id: true } });
        if (!pendingCheckIn) throw new ConflictException('A supervisor must accept the check-in before submitting a check-out claim.');
      }
      if (await tx.staffAttendanceClaim.findFirst({ where: { organizationId: identity.tenantId, shiftId, workerSubject: identity.subject, action: dto.action, status: 'PENDING_REVIEW' }, select: { id: true } })) {
        throw new ConflictException(`A ${dto.action.toLowerCase().replace('_', '-')} claim is already awaiting supervisor review.`);
      }
      const claim = await tx.staffAttendanceClaim.create({ data: {
        organizationId: identity.tenantId, eventId, shiftId, workerSubject: identity.subject,
        action: dto.action, recordedAt, receivedAt: now, status: 'PENDING_REVIEW',
      } });
      await this.audit(tx, identity, shiftId, 'attendance.offline_claimed', undefined, claim, 'Unverified device time; supervisor review required.');
      return claim;
    });
  }

  async pendingOfflineAttendance(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.prisma.withTenant(identity, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId }, select: { id: true, venueId: true } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:write', eventId, event.venueId);
      return tx.staffAttendanceClaim.findMany({
        where: { organizationId: identity.tenantId, eventId, status: 'PENDING_REVIEW', ...(!identity.capabilities.includes('tenant:admin') ? { shift: { venueId: { in: identity.venueIds }, OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }] } } : {}) },
        include: { shift: { select: { id: true, role: true, locationId: true, startsAt: true, endsAt: true } } },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      });
    });
  }

  async reviewOfflineAttendance(identity: Identity, eventId: string, claimId: string, dto: ReviewAttendanceClaimDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('A review reason of at least three characters is required.');
    return this.command(identity, key, 'staff-attendance.offline-review', { eventId, claimId, decision: dto.decision, reason }, async (tx) => {
      const claim = await tx.staffAttendanceClaim.findFirst({ where: { id: claimId, eventId, organizationId: identity.tenantId } });
      if (!claim) throw new NotFoundException('Attendance claim not found.');
      const shift = await tx.staffShift.findFirst({ where: { id: claim.shiftId, eventId, organizationId: identity.tenantId } });
      if (!shift) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, shift.venueId, shift.locationId ?? undefined);
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shift.id}`}, 0))`;
      const current = await tx.staffAttendanceClaim.findFirst({ where: { id: claimId, organizationId: identity.tenantId } });
      if (!current || current.status !== 'PENDING_REVIEW') throw new ConflictException('This attendance claim has already been reviewed.');
      const reviewedAt = new Date();
      if (dto.decision === 'ACCEPTED') {
        if (current.workerSubject !== shift.assignedSubject || shift.state !== 'PUBLISHED' || shift.response !== 'ACKNOWLEDGED' || shift.responseRevision !== shift.revision) throw new ConflictException('The shift assignment or acknowledgement changed after this claim was submitted.');
        if (current.action === 'CHECK_IN') {
          if (shift.attendance !== 'NOT_STARTED') throw new ConflictException('The shift already has a check-in. Reject this duplicate claim.');
          await this.assertQualified(tx, identity.tenantId, current.workerSubject, shift.requiredQualificationCodes, shift.endsAt);
        } else {
          if (shift.attendance !== 'CHECKED_IN' || !shift.checkedInAt || current.recordedAt < shift.checkedInAt) throw new ConflictException('The shift needs an accepted check-in before this check-out claim.');
          if (await tx.staffBreak.findFirst({ where: { organizationId: identity.tenantId, shiftId: shift.id, endedAt: null }, select: { id: true } })) throw new ConflictException('End the active break before accepting check-out.');
        }
        const updatedShift = await tx.staffShift.update({ where: { id: shift.id }, data: current.action === 'CHECK_IN'
          ? { attendance: 'CHECKED_IN', checkedInAt: current.recordedAt, updatedBy: identity.subject }
          : { attendance: 'CHECKED_OUT', checkedOutAt: current.recordedAt, updatedBy: identity.subject } });
        await this.audit(tx, identity, shift.id, `attendance.offline_${current.action.toLowerCase()}_accepted`, shift, updatedShift, reason);
      }
      const updatedClaim = await tx.staffAttendanceClaim.update({ where: { id: claimId }, data: {
        status: dto.decision, reviewedBy: identity.subject, reviewedAt, reviewReason: reason,
      } });
      await this.audit(tx, identity, shift.id, `attendance.offline_claim_${dto.decision.toLowerCase()}`, current, updatedClaim, reason);
      return updatedClaim;
    });
  }

  async startBreak(identity: Identity, eventId: string, shiftId: string, kind: 'REST' | 'MEAL', key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, 'staff-break.start', { eventId, shiftId, kind }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const shift = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!shift) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, shift.venueId, shift.locationId ?? undefined);
      if (shift.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may record a break.');
      if (shift.state !== 'PUBLISHED' || shift.attendance !== 'CHECKED_IN') throw new ConflictException('Check in to the published shift before starting a break.');
      const now = new Date();
      if (now < shift.startsAt || now >= shift.endsAt) throw new ConflictException('Breaks can only be recorded within the scheduled shift window.');
      if (await tx.staffBreak.findFirst({ where: { organizationId: identity.tenantId, shiftId, endedAt: null }, select: { id: true } })) throw new ConflictException('End the current break before starting another.');
      const record = await tx.staffBreak.create({ data: { organizationId: identity.tenantId, shiftId, workerSubject: identity.subject, kind, startedAt: now } });
      await this.audit(tx, identity, shiftId, `break.${kind.toLowerCase()}.started`, undefined, record);
      return record;
    });
  }

  async endBreak(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.command(identity, key, 'staff-break.end', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const shift = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!shift) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:read', eventId, shift.venueId, shift.locationId ?? undefined);
      if (shift.assignedSubject !== identity.subject) throw new ForbiddenException('Only the assigned worker may end a break.');
      if (shift.attendance !== 'CHECKED_IN') throw new ConflictException('The shift is not currently checked in.');
      const current = await tx.staffBreak.findFirst({ where: { organizationId: identity.tenantId, shiftId, workerSubject: identity.subject, endedAt: null }, orderBy: { startedAt: 'desc' } });
      if (!current) throw new ConflictException('There is no active break to end.');
      const updated = await tx.staffBreak.update({ where: { id: current.id }, data: { endedAt: new Date() } });
      await this.audit(tx, identity, shiftId, `break.${current.kind.toLowerCase()}.ended`, current, updated);
      return updated;
    });
  }

  async cancel(identity: Identity, eventId: string, shiftId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    const result = await this.command(identity, key, 'staff-shift.cancel', { eventId, shiftId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-shift:${identity.tenantId}:${shiftId}`}, 0))`;
      const current = await tx.staffShift.findFirst({ where: { id: shiftId, eventId, organizationId: identity.tenantId } });
      if (!current) throw new NotFoundException('Shift not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.state !== 'PUBLISHED' || current.attendance !== 'NOT_STARTED') throw new ConflictException('Only a published shift that has not started may be cancelled.');
      const updated = await tx.staffShift.update({ where: { id: shiftId }, data: { state: 'CANCELLED', updatedBy: identity.subject } });
      await this.audit(tx, identity, shiftId, 'cancelled', current, updated);
      const notification = await this.notification(tx, identity, updated, current.assignedSubject, 'staffing.shift.cancelled');
      return { shift: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.shift;
  }

  private notification(tx: Prisma.TransactionClient, identity: Identity, shift: { id: string; eventId: string }, recipientSubject: string | null | undefined, kind: string) {
    if (!recipientSubject || recipientSubject === identity.subject) return Promise.resolve(null);
    return tx.userNotification.create({ data: {
      organizationId: identity.tenantId,
      eventId: shift.eventId,
      shiftId: shift.id,
      recipientSubject,
      kind,
      title: kind === 'staffing.shift.cancelled' ? 'Shift cancelled' : kind === 'staffing.shift.published' ? 'New shift assigned' : 'Shift schedule updated',
      body: 'Open Venue Wrangler to review your event schedule.',
    } });
  }

  private deliver(identity: Identity, notification: { id: string; kind: string; recipientSubject: string } | null) {
    if (!notification) return;
    void this.push.deliver({ ...identity, subject: notification.recipientSubject }, notification).catch(() => {
      this.logger.warn('Push dispatch failed after the durable shift notification was committed.');
    });
  }

  private async assertAssignable(tx: Prisma.TransactionClient, identity: Identity, subject?: string) {
    if (subject === undefined) return;
    if (!identity.assignableUserIds.includes(subject)) throw new ForbiddenException('The selected person is outside your assignment scope.');
    const person = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: subject, active: true }, select: { id: true } });
    if (!person) throw new NotFoundException('The selected person is not an active user in this organization.');
  }

  private async lockScheduleSubjects(tx: Prisma.TransactionClient, tenantId: string, subjects: Array<string | null | undefined>) {
    for (const subject of [...new Set(subjects.filter((value): value is string => Boolean(value)))].sort()) {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`staff-schedule:${tenantId}:${subject}`}, 0))`;
    }
  }

  private async assertNoOverlap(tx: Prisma.TransactionClient, tenantId: string, subject: string | null | undefined, startsAt: Date, endsAt: Date, exceptShiftId?: string) {
    if (!subject) return;
    const [policy] = await tx.$queryRaw<Array<{ minimum_rest_minutes: number | null }>>`
      SELECT minimum_rest_minutes FROM organizations WHERE id = ${tenantId}::uuid FOR SHARE
    `;
    if (!policy || policy.minimum_rest_minutes === null) throw new ConflictException('The organization has not configured a minimum rest period. Ask a tenant administrator to set the staffing policy before assigning this worker.');
    const restMilliseconds = policy.minimum_rest_minutes * 60_000;
    const conflict = await tx.staffShift.findFirst({ where: {
      organizationId: tenantId,
      assignedSubject: subject,
      state: 'PUBLISHED',
      ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}),
      startsAt: { lt: new Date(endsAt.getTime() + restMilliseconds) },
      endsAt: { gt: new Date(startsAt.getTime() - restMilliseconds) },
    }, select: { id: true } });
    if (conflict) throw new ConflictException(policy.minimum_rest_minutes === 0
      ? 'This worker already has an overlapping published shift. Adjust the schedule before publishing.'
      : `This worker's published schedule violates the configured ${policy.minimum_rest_minutes}-minute minimum rest period.`);
  }

  private async assertAvailable(tx: Prisma.TransactionClient, tenantId: string, subject: string | null | undefined, startsAt: Date, endsAt: Date) {
    if (!subject) return;
    const unavailable = await tx.staffUnavailability.findFirst({ where: {
      organizationId: tenantId, subject, deletedAt: null,
      startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
    }, select: { id: true } });
    if (unavailable) throw new ConflictException('This worker has marked part of the shift unavailable. Adjust the schedule before assigning or publishing.');
  }

  private normalizeQualificationCodes(codes?: string[]) {
    const normalized = (codes ?? []).map((code) => code.trim().toUpperCase());
    if (normalized.some((code) => !/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(code)) || new Set(normalized).size !== normalized.length) {
      throw new ConflictException('Required qualification codes must be unique valid identifiers.');
    }
    return normalized.sort();
  }

  private async assertQualified(tx: Prisma.TransactionClient, tenantId: string, subject: string | null | undefined, codes: string[], shiftEndsAt: Date) {
    const requiredCodes = codes ?? [];
    if (!subject || requiredCodes.length === 0) return;
    const person = await tx.person.findFirst({ where: { organizationId: tenantId, externalSubject: subject, active: true }, select: { id: true } });
    if (!person) throw new NotFoundException('The selected person is not an active user in this organization.');
    const requiredThroughUtcDay = new Date(Date.UTC(shiftEndsAt.getUTCFullYear(), shiftEndsAt.getUTCMonth(), shiftEndsAt.getUTCDate()));
    const valid = await tx.personQualification.findMany({ where: {
      organizationId: tenantId, personId: person.id, code: { in: requiredCodes }, revokedAt: null, evidenceStatus: { in: ['NONE', 'VERIFIED'] },
      OR: [{ expiresAt: null }, { expiresAt: { gte: requiredThroughUtcDay } }],
    }, select: { code: true } });
    const validCodes = new Set(valid.map((qualification) => qualification.code));
    const missing = requiredCodes.filter((code) => !validCodes.has(code));
    if (missing.length > 0) throw new ConflictException(`Worker lacks a current eligible qualification for: ${missing.join(', ')}. Credentials under review or rejected cannot be used for staffing.`);
  }

  private audit(tx: Prisma.TransactionClient, identity: Identity, shiftId: string, action: string, before?: unknown, after?: unknown, reason?: string) {
    return tx.staffShiftAuditEvent.create({ data: {
      organizationId: identity.tenantId, shiftId, actorId: identity.subject, action, reason,
      before: before as Prisma.InputJsonValue | undefined, after: after as Prisma.InputJsonValue | undefined,
    } });
  }

  private auditDemand(tx: Prisma.TransactionClient, identity: Identity, demandId: string, action: string, before?: unknown, after?: unknown, reason?: string) {
    return tx.staffingDemandAudit.create({ data: {
      organizationId: identity.tenantId, demandId, actorId: identity.subject, action, reason,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
    } });
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

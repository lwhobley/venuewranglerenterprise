import type { CanonicalBeoInput, DepartmentSlices } from './canonical-beo.types';

export function parseGenericJsonPayload(raw: unknown): CanonicalBeoInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Generic JSON BEO payload must be a JSON object');
  }

  const data = raw as Record<string, any>;
  const externalId = String(data.id ?? data.externalId ?? data.beoId ?? data.beoNumber ?? '').trim();
  if (!externalId) {
    throw new Error('Generic JSON BEO payload requires an id, externalId, or beoId');
  }

  const eventName = String(data.eventName ?? data.title ?? data.eventTitle ?? '').trim();
  const serviceDate = data.serviceDate ? String(data.serviceDate).slice(0, 10) : null;
  const guestCount = typeof data.guestCount === 'number' ? data.guestCount : (data.expectedGuests ? Number(data.expectedGuests) : null);
  const venueSpace = data.venueSpace ? String(data.venueSpace).trim() : (data.space ? String(data.space).trim() : (data.room ? String(data.room).trim() : null));
  const spaceId = data.spaceId ? String(data.spaceId).trim() : (data.zoneId ? String(data.zoneId).trim() : null);

  const loadInAt = data.loadInAt ? new Date(data.loadInAt) : null;
  const serviceStartAt = data.serviceStartAt ? new Date(data.serviceStartAt) : (data.startTime ? new Date(data.startTime) : null);
  const serviceEndAt = data.serviceEndAt ? new Date(data.serviceEndAt) : (data.endTime ? new Date(data.endTime) : null);
  const loadOutAt = data.loadOutAt ? new Date(data.loadOutAt) : null;

  const departmentSlices: DepartmentSlices = {};
  if (data.departmentSlices && typeof data.departmentSlices === 'object') {
    Object.assign(departmentSlices, data.departmentSlices);
  } else {
    if (data.kitchen) departmentSlices.kitchen = data.kitchen;
    if (data.banquetFloor) departmentSlices.banquetFloor = data.banquetFloor;
    if (data.bars) departmentSlices.bars = data.bars;
    if (data.suites) departmentSlices.suites = data.suites;
    if (data.warehouse) departmentSlices.warehouse = data.warehouse;
    if (data.staffing) departmentSlices.staffing = data.staffing;
  }

  return {
    externalSource: 'generic-json',
    externalId,
    eventName: eventName || 'Untitled Event',
    serviceDate,
    spaceId,
    venueSpace,
    loadInAt,
    serviceStartAt,
    serviceEndAt,
    loadOutAt,
    guestCount: Number.isFinite(guestCount) ? guestCount : null,
    departmentSlices: Object.keys(departmentSlices).length ? departmentSlices : null,
    layoutJson: data.layoutJson ?? null,
    sourcePayload: (() => {
      const sanitized = typeof data === 'object' && data !== null ? { ...data } : {};
      delete (sanitized as any).secret;
      return sanitized;
    })(),
    sourceUpdatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
    specialRequirements: data.specialRequirements ? String(data.specialRequirements) : null,
    internalNotes: data.internalNotes ? String(data.internalNotes) : null,
  };
}

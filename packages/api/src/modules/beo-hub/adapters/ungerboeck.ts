import type { CanonicalBeoInput, DepartmentSlices } from './canonical-beo.types';

export function parseUngerboeckPayload(raw: unknown): CanonicalBeoInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Ungerboeck payload must be a JSON object');
  }

  const data = raw as Record<string, any>;
  // Ungerboeck commonly keys on FunctionID, BookingID, or OrderNumber
  const externalId = String(
    data.FunctionID ??
    data.FunctionId ??
    data.BookingID ??
    data.BookingId ??
    data.OrderNumber ??
    data.EventID ??
    ''
  ).trim();

  if (!externalId) {
    throw new Error('Ungerboeck payload missing FunctionID or BookingID');
  }

  const eventName = String(
    data.FunctionDescription ??
    data.EventDescription ??
    data.Description ??
    data.EventName ??
    data.Title ??
    ''
  ).trim();

  const venueSpace = String(
    data.SpaceDescription ??
    data.Space ??
    data.RoomDescription ??
    data.Room ??
    data.Location ??
    ''
  ).trim() || null;

  const spaceId = String(data.SpaceCode ?? data.RoomCode ?? data.ResourceCode ?? '').trim() || null;

  // Ungerboeck datetime fields: StartDate/StartTime or StartDateTime
  const startRaw = data.StartDateTime ?? data.StartTime ?? data.StartDate;
  const endRaw = data.EndDateTime ?? data.EndTime ?? data.EndDate;
  const serviceStartAt = startRaw ? new Date(startRaw) : null;
  const serviceEndAt = endRaw ? new Date(endRaw) : null;

  const loadInRaw = data.SetupStartDateTime ?? data.LoadInDateTime ?? data.SetupStartTime;
  const loadOutRaw = data.TeardownEndDateTime ?? data.LoadOutDateTime ?? data.TeardownEndTime;
  const loadInAt = loadInRaw ? new Date(loadInRaw) : null;
  const loadOutAt = loadOutRaw ? new Date(loadOutRaw) : null;

  let serviceDate: string | null = null;
  if (data.StartDate) {
    serviceDate = String(data.StartDate).slice(0, 10);
  } else if (serviceStartAt && !isNaN(serviceStartAt.getTime())) {
    serviceDate = serviceStartAt.toISOString().slice(0, 10);
  }

  const attendees = data.ActualAttendance ?? data.GuaranteedAttendance ?? data.AgreedAttendance ?? data.EstimatedAttendance;
  const guestCount = typeof attendees === 'number' ? attendees : (attendees ? Number(attendees) : null);

  // Parse item lines / instructions into slices
  const departmentSlices: DepartmentSlices = {};
  const orders = Array.isArray(data.Orders) ? data.Orders : (Array.isArray(data.OrderLines) ? data.OrderLines : []);
  
  const kitchenItems: Array<{ name: string; quantity?: number; dietary?: string; course?: string }> = [];
  const barItems: string[] = [];

  for (const item of orders) {
    const desc = String(item.Description ?? item.ItemDescription ?? item.Name ?? '').trim();
    const qty = typeof item.Quantity === 'number' ? item.Quantity : Number(item.Quantity || 1);
    const category = String(item.Department ?? item.Category ?? item.ItemType ?? '').toLowerCase();

    if (category.includes('bar') || category.includes('beverage') || category.includes('liquor')) {
      barItems.push(`${desc} (x${qty})`);
    } else if (category.includes('food') || category.includes('culinary') || category.includes('kitchen') || category.includes('catering')) {
      kitchenItems.push({
        name: desc,
        quantity: qty,
        course: item.Course ? String(item.Course) : undefined,
        dietary: item.DietaryRequirements ? String(item.DietaryRequirements) : undefined,
      });
    }
  }

  if (kitchenItems.length > 0 || data.CulinaryNotes) {
    departmentSlices.kitchen = {
      notes: data.CulinaryNotes ? String(data.CulinaryNotes) : undefined,
      specialInstructions: data.KitchenInstructions ? String(data.KitchenInstructions) : undefined,
      menuItems: kitchenItems,
    };
  }

  if (data.SetupNotes || data.SetupStyle || data.RoomLayout) {
    departmentSlices.banquetFloor = {
      notes: data.SetupNotes ? String(data.SetupNotes) : undefined,
      setupStyle: data.SetupStyle ? String(data.SetupStyle) : undefined,
      roomArrangement: data.RoomLayout ? String(data.RoomLayout) : undefined,
    };
  }

  if (barItems.length > 0 || data.BeverageNotes || data.BarPackage) {
    departmentSlices.bars = {
      notes: data.BeverageNotes ? String(data.BeverageNotes) : undefined,
      barPackage: data.BarPackage ? String(data.BarPackage) : undefined,
      specialtyCocktails: barItems.length > 0 ? barItems : undefined,
    };
  }

  if (data.StaffingNotes || data.LaborRequirement) {
    departmentSlices.staffing = {
      notes: data.StaffingNotes ? String(data.StaffingNotes) : String(data.LaborRequirement),
      rosterSynced: false,
    };
  }

  return {
    externalSource: 'ungerboeck',
    externalId,
    eventName: eventName || 'Ungerboeck Event',
    serviceDate,
    spaceId,
    venueSpace,
    loadInAt,
    serviceStartAt,
    serviceEndAt,
    loadOutAt,
    guestCount: Number.isFinite(guestCount) ? guestCount : null,
    departmentSlices: Object.keys(departmentSlices).length ? departmentSlices : null,
    sourcePayload: (() => {
      const sanitized = typeof data === 'object' && data !== null ? { ...data } : {};
      delete (sanitized as any).secret;
      return sanitized;
    })(),
    sourceUpdatedAt: data.LastChangedDateTime ? new Date(data.LastChangedDateTime) : new Date(),
    specialRequirements: data.SpecialInstructions ? String(data.SpecialInstructions) : null,
    internalNotes: data.InternalNotes ? String(data.InternalNotes) : null,
  };
}

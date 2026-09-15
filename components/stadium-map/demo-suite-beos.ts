import type { StadiumZoneData } from './zone-data';
import type { EventBeoReportDocument, ReportDepartmentSection, SuiteBeoReportRow } from '../../lib/beo-report';

export interface DemoSuiteBeo {
  id: string;
  eventName: string;
  serviceDate: string;
  serviceStartAt: string;
  serviceEndAt: string;
  loadInAt: null;
  loadOutAt: null;
  venueSpace: string;
  spaceId: string;
  guestCount: number | null;
  status: 'confirmed';
  externalSource: 'stadium-demo';
  externalId: string;
  eventId: null;
  eventTitle: null;
  suiteOrderCount: 1;
  departmentSlices: {
    suites: {
      beoNumber: string;
      hostName: string | null;
      packageName: string | null;
      menuPackage: string | null;
      preOrders: NonNullable<NonNullable<StadiumZoneData['units'][number]['suiteDetails']>['beoPreOrders']>;
      inSuiteOrders: NonNullable<NonNullable<StadiumZoneData['units'][number]['suiteDetails']>['inSuiteOrders']>;
      notes: string;
    };
  };
  hasLayout: false;
  updatedAt: string;
  demoLink: { zoneId: string; unitId: string };
}

export interface DemoSuiteRunnerOrder {
  id: string;
  beoNumber: string;
  subVenue: { name: string; code: string };
  zone: { name: string; level: string };
  hostName: string;
  guestCount: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  specialInstructions?: string;
  cateringLineItems: Array<{ code: string; name: string; quantity: number; unitPriceCents: number; category: string }>;
  status: 'prep_initiated' | 'en_route' | 'delivered';
  deliveredAt?: string;
  urgencyColor: string;
  minutesUntilDelivery: number;
  isDemo: true;
  demoLink: { zoneId: string; unitId: string };
}

export interface DemoDistroTicket {
  id: string;
  organizationId: 'stadium-demo';
  facilityId: 'stadium-demo';
  beoId: string;
  zoneId: string;
  serviceAreaId: string;
  serviceAreaName: string;
  kitchenId: 'kitchen-main';
  kitchenName: 'Main Commissary Kitchen';
  distroLocationName: 'Distro Bay North';
  status: 'firing' | 'ready' | 'picked_up';
  priority: 'normal';
  itemName: string;
  itemDescription: string;
  quantity: number;
  notes?: string;
  requestedAt: string;
  readyAt?: string;
  pickedUpAt?: string;
  wasOverdue: false;
  isOverdue: false;
  isDemo: true;
  demoLink: { zoneId: string; unitId: string };
}

/**
 * Projects the stadium's explicitly-labelled demo suite fixtures into the BEO
 * hub. This keeps both screens on one fixture source: a demo order cannot
 * appear in a suite without its matching BEO row, and no second copy of the
 * menu/order data can drift out of sync.
 */
export function buildDemoSuiteBeos(
  zones: StadiumZoneData[],
  serviceDate = new Date().toISOString().slice(0, 10),
): DemoSuiteBeo[] {
  return zones.flatMap((zone) =>
    zone.units.flatMap((unit) => {
      const suite = unit.suiteDetails;
      if (!suite?.beoNumber) return [];

      const serviceStartAt = `${serviceDate}T17:00:00.000Z`;
      const serviceEndAt = `${serviceDate}T22:00:00.000Z`;
      return [{
        id: `demo-suite-beo:${suite.beoNumber}`,
        eventName: `${suite.suiteholder ?? unit.name} Hospitality`,
        serviceDate,
        serviceStartAt,
        serviceEndAt,
        loadInAt: null,
        loadOutAt: null,
        venueSpace: unit.name,
        spaceId: unit.id,
        guestCount: suite.guestCount ?? unit.capacity,
        status: 'confirmed' as const,
        externalSource: 'stadium-demo' as const,
        externalId: suite.beoNumber,
        eventId: null,
        eventTitle: null,
        suiteOrderCount: 1 as const,
        departmentSlices: {
          suites: {
            beoNumber: suite.beoNumber,
            hostName: suite.hostName ?? null,
            packageName: suite.beoPackageName ?? null,
            menuPackage: suite.menuPackage ?? null,
            preOrders: suite.beoPreOrders ?? [],
            inSuiteOrders: suite.inSuiteOrders ?? [],
            notes: `Linked demo order for ${unit.code}.`,
          },
        },
        hasLayout: false as const,
        updatedAt: serviceStartAt,
        demoLink: { zoneId: zone.id, unitId: unit.id },
      }];
    }),
  );
}

/** Runner queue projection of the same suite fixtures used by the map and hub. */
export function buildDemoSuiteRunnerOrders(
  zones: StadiumZoneData[],
  serviceDate = new Date().toISOString().slice(0, 10),
): DemoSuiteRunnerOrder[] {
  return zones.flatMap((zone) =>
    zone.units.flatMap((unit) => {
      const suite = unit.suiteDetails;
      const preOrders = suite?.beoPreOrders ?? [];
      if (!suite?.beoNumber || preOrders.length === 0) return [];

      const allDelivered = preOrders.every((item) => item.status === 'delivered');
      const readyForRunner = !allDelivered && preOrders.some((item) => item.status === 'prepped');
      const dietaryNotes = preOrders
        .flatMap((item) => item.dietaryNotes ? [`${item.name}: ${item.dietaryNotes}`] : [])
        .join(' · ');
      const levelNumber = unit.stadiumLevel?.match(/\d+/)?.[0] ?? unit.level ?? zone.level;
      const levelLabel = levelNumber === '200'
        ? 'Level 2 Club'
        : levelNumber === '300'
          ? 'Level 3 VIP'
          : `Level ${levelNumber}`;

      return [{
        id: `demo-suite-beo:${suite.beoNumber}`,
        beoNumber: suite.beoNumber,
        subVenue: { name: unit.name, code: unit.code },
        zone: { name: zone.name, level: levelLabel },
        hostName: suite.hostName ?? suite.suiteholder ?? 'Suite Host',
        guestCount: suite.guestCount ?? unit.capacity ?? 0,
        deliveryWindowStart: `${serviceDate}T17:00:00.000Z`,
        deliveryWindowEnd: `${serviceDate}T22:00:00.000Z`,
        specialInstructions: dietaryNotes || undefined,
        cateringLineItems: preOrders.map((item) => ({
          code: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: 0,
          category: item.category,
        })),
        status: allDelivered ? 'delivered' as const : readyForRunner ? 'en_route' as const : 'prep_initiated' as const,
        deliveredAt: allDelivered ? `${serviceDate}T16:45:00.000Z` : undefined,
        urgencyColor: readyForRunner ? 'warning' : allDelivered ? 'success' : 'normal',
        minutesUntilDelivery: allDelivered ? 0 : readyForRunner ? 15 : 45,
        isDemo: true as const,
        demoLink: { zoneId: zone.id, unitId: unit.id },
      }];
    }),
  );
}

/**
 * Live records win by BEO number, while fixture-only records fill otherwise
 * empty screens. Every operational surface uses this rule so the same order is
 * never shown twice with two different states.
 */
export function mergeSuiteOrdersByBeoNumber<
  TLive extends { beoNumber: string },
  TDemo extends { beoNumber: string } = TLive,
>(live: TLive[], demo: TDemo[]): Array<TLive | TDemo> {
  const liveNumbers = new Set(live.map((row) => row.beoNumber));
  return [...live, ...demo.filter((row) => !liveNumbers.has(row.beoNumber))];
}

/** Kitchen-to-distro line tickets derived one-for-one from the suite BEO source items. */
export function buildDemoDistroTickets(
  zones: StadiumZoneData[],
  serviceDate = new Date().toISOString().slice(0, 10),
): DemoDistroTicket[] {
  return buildDemoSuiteBeos(zones, serviceDate).flatMap((beo) =>
    beo.departmentSlices.suites.preOrders.map((item) => {
      const status = item.status === 'delivered' ? 'picked_up' as const : item.status === 'prepped' ? 'ready' as const : 'firing' as const;
      return {
        id: `demo-distro:${beo.externalId}:${item.id}`,
        organizationId: 'stadium-demo' as const,
        facilityId: 'stadium-demo' as const,
        beoId: beo.id,
        zoneId: beo.demoLink.zoneId,
        serviceAreaId: beo.demoLink.unitId,
        serviceAreaName: beo.venueSpace,
        kitchenId: 'kitchen-main' as const,
        kitchenName: 'Main Commissary Kitchen' as const,
        distroLocationName: 'Distro Bay North' as const,
        status,
        priority: 'normal' as const,
        itemName: item.name,
        itemDescription: `${beo.externalId} · ${item.category}`,
        quantity: item.quantity,
        notes: item.dietaryNotes,
        requestedAt: beo.serviceStartAt,
        readyAt: status === 'ready' ? `${serviceDate}T16:45:00.000Z` : undefined,
        pickedUpAt: status === 'picked_up' ? `${serviceDate}T16:30:00.000Z` : undefined,
        wasOverdue: false as const,
        isOverdue: false as const,
        isDemo: true as const,
        demoLink: beo.demoLink,
      };
    }),
  );
}

export function mergeDistroTicketsById<TLive extends { id: string }, TDemo extends { id: string } = TLive>(
  live: TLive[],
  demo: TDemo[],
): Array<TLive | TDemo> {
  const liveIds = new Set(live.map((row) => row.id));
  return [...live, ...demo.filter((row) => !liveIds.has(row.id))];
}

function reportStatus(preOrders: DemoSuiteBeo['departmentSlices']['suites']['preOrders']): string {
  if (preOrders.length === 0) return 'confirmed_beo';
  if (preOrders.every((item) => item.status === 'delivered')) return 'delivered';
  if (preOrders.some((item) => item.status === 'prepped')) return 'en_route';
  return 'prep_initiated';
}

/** A published-report-shaped view of the exact same fixtures used by the map and BEO hub. */
export function buildDemoSuiteReport(
  zones: StadiumZoneData[],
  serviceDate = new Date().toISOString().slice(0, 10),
): EventBeoReportDocument {
  const beos = buildDemoSuiteBeos(zones, serviceDate);
  const rows: SuiteBeoReportRow[] = beos.map((beo) => {
    const suite = beo.departmentSlices.suites;
    return {
      id: beo.id,
      beoNumber: suite.beoNumber,
      salesBeo: null,
      suiteCode: zones.flatMap((zone) => zone.units).find((unit) => unit.id === beo.demoLink.unitId)?.code ?? beo.spaceId,
      suiteName: beo.venueSpace,
      zoneName: zones.find((zone) => zone.id === beo.demoLink.zoneId)?.name ?? '',
      hostName: suite.hostName ?? 'Suite Host',
      hostPhone: null,
      hostEmail: null,
      guestCount: beo.guestCount ?? 0,
      deliveryWindowStart: beo.serviceStartAt,
      deliveryWindowEnd: beo.serviceEndAt,
      status: reportStatus(suite.preOrders),
      specialInstructions: suite.notes,
      totalCents: 0,
      lineItems: suite.preOrders.map((item) => ({
        code: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: 0,
        category: item.category,
      })),
      demoLink: beo.demoLink,
    };
  });

  const hospitalityLines = rows.map((row) => ({
    id: `demo-report-suite:${row.beoNumber}`,
    kind: 'suite_delivery' as const,
    at: row.deliveryWindowStart,
    title: `${row.suiteCode} · ${row.suiteName}`,
    detail: `${row.guestCount} guests`,
    status: row.status,
    reference: row.beoNumber,
  }));
  const culinaryLines = rows.flatMap((row) => row.lineItems.map((item) => ({
    id: `demo-report-item:${row.beoNumber}:${item.code}`,
    kind: 'task' as const,
    at: row.deliveryWindowStart,
    title: `${item.quantity}× ${item.name}`,
    detail: row.suiteName,
    status: row.status === 'delivered' ? 'completed' : row.status,
    reference: row.beoNumber,
  })));
  const sections: ReportDepartmentSection[] = [
    {
      code: 'premium_hospitality',
      label: 'Premium Hospitality',
      lineCount: hospitalityLines.length,
      openCount: hospitalityLines.filter((line) => line.status !== 'delivered').length,
      lines: hospitalityLines,
    },
    {
      code: 'culinary_production',
      label: 'Culinary Production',
      lineCount: culinaryLines.length,
      openCount: culinaryLines.filter((line) => line.status !== 'completed').length,
      lines: culinaryLines,
    },
  ].filter((section) => section.lineCount > 0) as ReportDepartmentSection[];
  const totalLines = sections.reduce((sum, section) => sum + section.lineCount, 0);
  const totalOpen = sections.reduce((sum, section) => sum + section.openCount, 0);

  return {
    reportType: 'event_beo_report',
    version: 1,
    publishedAt: `${serviceDate}T12:00:00.000Z`,
    trigger: 'manual',
    venue: { id: 'stadium-demo', name: 'VenueWrangler Stadium' },
    event: {
      id: 'stadium-demo-event',
      title: 'Stadium Operations Demo',
      eventCode: 'DEMO-GAMEDAY',
      eventType: 'gameday',
      status: 'confirmed',
      startsAt: `${serviceDate}T18:00:00.000Z`,
      gatesOpenAt: `${serviceDate}T16:00:00.000Z`,
      endsAt: `${serviceDate}T22:00:00.000Z`,
      expectedGuests: rows.reduce((sum, row) => sum + row.guestCount, 0),
      opponentOrHeadliner: null,
    },
    suites: {
      beoCount: rows.length,
      guestCount: rows.reduce((sum, row) => sum + row.guestCount, 0),
      revenueCents: 0,
      linkedToSalesCount: 0,
      rows,
    },
    departments: sections,
    totals: { lineCount: totalLines, openLineCount: totalOpen, departmentCount: sections.length },
    dataGaps: ['Demo suite orders are read-only until matching live API records are created.'],
  };
}

/** Adds fixture-only suites to a live snapshot while preserving live rows and status as authoritative. */
export function mergeDemoSuiteReport(
  live: EventBeoReportDocument | null,
  demo: EventBeoReportDocument,
): EventBeoReportDocument {
  if (!live) return demo;

  const liveNumbers = new Set(live.suites.rows.map((row) => row.beoNumber));
  const addedRows = demo.suites.rows.filter((row) => !liveNumbers.has(row.beoNumber));
  const addedNumbers = new Set(addedRows.map((row) => row.beoNumber));
  const sectionCodes = new Set([...live.departments.map((section) => section.code), ...demo.departments.map((section) => section.code)]);
  const departments = [...sectionCodes].map((code) => {
    const liveSection = live.departments.find((section) => section.code === code);
    const demoSection = demo.departments.find((section) => section.code === code);
    const addedLines = (demoSection?.lines ?? []).filter((line) => line.reference && addedNumbers.has(line.reference));
    const lines = [...(liveSection?.lines ?? []), ...addedLines];
    return {
      code,
      label: liveSection?.label ?? demoSection?.label ?? code,
      lineCount: lines.length,
      openCount: lines.filter((line) => !['done', 'delivered', 'closed_invoiced', 'arrived', 'ready', 'complete', 'completed'].includes(line.status)).length,
      lines,
    } satisfies ReportDepartmentSection;
  });
  const rows = [...live.suites.rows, ...addedRows];

  return {
    ...live,
    suites: {
      ...live.suites,
      rows,
      beoCount: rows.length,
      guestCount: rows.reduce((sum, row) => sum + row.guestCount, 0),
    },
    departments,
    totals: {
      lineCount: departments.reduce((sum, section) => sum + section.lineCount, 0),
      openLineCount: departments.reduce((sum, section) => sum + section.openCount, 0),
      departmentCount: departments.length,
    },
    dataGaps: addedRows.length
      ? [...live.dataGaps, `${addedRows.length} fixture suite BEOs are shown read-only beside the live report.`]
      : live.dataGaps,
  };
}

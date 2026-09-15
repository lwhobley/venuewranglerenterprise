import type { StadiumZoneData } from './zone-data';

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
  cateringLineItems: Array<{ code: string; name: string; quantity: number }>;
  status: 'prep_initiated' | 'en_route' | 'delivered';
  deliveredAt?: string;
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
        })),
        status: allDelivered ? 'delivered' as const : readyForRunner ? 'en_route' as const : 'prep_initiated' as const,
        deliveredAt: allDelivered ? `${serviceDate}T16:45:00.000Z` : undefined,
        isDemo: true as const,
        demoLink: { zoneId: zone.id, unitId: unit.id },
      }];
    }),
  );
}

import { describe, expect, it } from 'vitest';
import { buildDemoSuiteBeos, buildDemoSuiteRunnerOrders } from './demo-suite-beos';
import { COMPREHENSIVE_STADIUM_ZONES } from './zone-data';

describe('buildDemoSuiteBeos', () => {
  it('creates exactly one linked BEO row for every suite BEO fixture', () => {
    const suiteFixtures = COMPREHENSIVE_STADIUM_ZONES.flatMap((zone) =>
      zone.units
        .filter((unit) => Boolean(unit.suiteDetails?.beoNumber))
        .map((unit) => ({ zoneId: zone.id, unit })),
    );

    const beos = buildDemoSuiteBeos(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');

    expect(beos).toHaveLength(suiteFixtures.length);
    expect(new Set(beos.map((beo) => beo.externalId)).size).toBe(beos.length);
    for (const fixture of suiteFixtures) {
      const beo = beos.find((candidate) => candidate.externalId === fixture.unit.suiteDetails?.beoNumber);
      expect(beo).toMatchObject({
        suiteOrderCount: 1,
        serviceDate: '2026-09-15',
        demoLink: { zoneId: fixture.zoneId, unitId: fixture.unit.id },
      });
    }
  });

  it('uses the exact suite pre-orders instead of inventing fallback items', () => {
    const beos = buildDemoSuiteBeos(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');
    const suite302 = beos.find((beo) => beo.demoLink.unitId === 'u-302');
    const suite301 = beos.find((beo) => beo.demoLink.unitId === 'u-301');

    expect(suite302?.departmentSlices.suites.preOrders).toEqual([]);
    expect(suite301?.departmentSlices.suites.preOrders).toEqual(
      COMPREHENSIVE_STADIUM_ZONES.flatMap((zone) => zone.units)
        .find((unit) => unit.id === 'u-301')?.suiteDetails?.beoPreOrders,
    );
  });

  it('creates runner deliveries only for BEOs with actual fixture pre-orders', () => {
    const expected = COMPREHENSIVE_STADIUM_ZONES.flatMap((zone) => zone.units)
      .filter((unit) => (unit.suiteDetails?.beoPreOrders?.length ?? 0) > 0);
    const orders = buildDemoSuiteRunnerOrders(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');

    expect(orders).toHaveLength(expected.length);
    for (const unit of expected) {
      const order = orders.find((candidate) => candidate.beoNumber === unit.suiteDetails?.beoNumber);
      expect(order?.cateringLineItems).toEqual(
        unit.suiteDetails?.beoPreOrders?.map((item) => ({
          code: item.id,
          name: item.name,
          quantity: item.quantity,
        })),
      );
      expect(order?.demoLink.unitId).toBe(unit.id);
    }
    expect(orders.every((order) => order.cateringLineItems.length > 0)).toBe(true);
  });
});

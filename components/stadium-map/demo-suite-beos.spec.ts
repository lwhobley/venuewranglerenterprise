import { describe, expect, it } from 'vitest';
import {
  buildDemoSuiteBeos,
  buildDemoDistroTickets,
  buildDemoSuiteReport,
  buildDemoSuiteRunnerOrders,
  mergeDemoSuiteReport,
  mergeDistroTicketsById,
  mergeSuiteOrdersByBeoNumber,
} from './demo-suite-beos';
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
          unitPriceCents: 0,
          category: item.category,
        })),
      );
      expect(order?.demoLink.unitId).toBe(unit.id);
    }
    expect(orders.every((order) => order.cateringLineItems.length > 0)).toBe(true);
  });

  it('projects the same BEO numbers and exact items into KDS, runner, and report views', () => {
    const date = '2026-09-15';
    const hub = buildDemoSuiteBeos(COMPREHENSIVE_STADIUM_ZONES, date);
    const operational = buildDemoSuiteRunnerOrders(COMPREHENSIVE_STADIUM_ZONES, date);
    const report = buildDemoSuiteReport(COMPREHENSIVE_STADIUM_ZONES, date);

    expect(report.suites.rows.map((row) => row.beoNumber)).toEqual(hub.map((beo) => beo.externalId));
    for (const order of operational) {
      const reportRow = report.suites.rows.find((row) => row.beoNumber === order.beoNumber);
      expect(reportRow?.lineItems).toEqual(order.cateringLineItems);
      expect(reportRow?.demoLink).toEqual(order.demoLink);
    }
  });

  it('lets a live API order override its fixture counterpart without duplicating it', () => {
    const demo = buildDemoSuiteRunnerOrders(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');
    const live = { ...demo[0], id: 'live-order', isDemo: false as const };
    const merged = mergeSuiteOrdersByBeoNumber([live], demo);

    expect(merged.filter((row) => row.beoNumber === live.beoNumber)).toEqual([live]);
    expect(merged).toHaveLength(demo.length);
  });

  it('adds fixture-only BEOs to a live report but keeps the live copy authoritative', () => {
    const demo = buildDemoSuiteReport(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');
    const liveRow = { ...demo.suites.rows[0], id: 'live-report-row', status: 'confirmed_beo' };
    const live = {
      ...demo,
      suites: { ...demo.suites, rows: [liveRow], beoCount: 1 },
      departments: [],
    };
    const merged = mergeDemoSuiteReport(live, demo);

    expect(merged.suites.rows.find((row) => row.beoNumber === liveRow.beoNumber)).toEqual(liveRow);
    expect(merged.suites.rows).toHaveLength(demo.suites.rows.length);
  });

  it('projects every exact BEO line item into the downstream distro flow', () => {
    const operational = buildDemoSuiteRunnerOrders(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');
    const distro = buildDemoDistroTickets(COMPREHENSIVE_STADIUM_ZONES, '2026-09-15');
    const expectedItems = operational.flatMap((order) => order.cateringLineItems.map((item) => ({ order, item })));

    expect(distro).toHaveLength(expectedItems.length);
    for (const { order, item } of expectedItems) {
      expect(distro).toContainEqual(expect.objectContaining({
        beoId: order.id,
        serviceAreaId: order.demoLink.unitId,
        itemName: item.name,
        quantity: item.quantity,
      }));
    }
    expect(mergeDistroTicketsById([distro[0]], distro)).toHaveLength(distro.length);
  });
});

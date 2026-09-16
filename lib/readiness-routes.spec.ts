import { describe, expect, it } from 'vitest';
import { EVENT_BEO_ROUTE, READINESS_ROW_ROUTES } from './readiness-routes';
import { SUITE_BEO_REPORT_ROUTE, beoReportRoute, parseReportDepartment } from './beo-report';

/**
 * Each readiness row must lead to the screen that shows the work behind its
 * score — and never to the opening/closing checklist, which is a task list and
 * scores a different category entirely.
 */
describe('readiness row routing', () => {
  it('sends the suite BEO row to the published report, opened on suites', () => {
    const route = READINESS_ROW_ROUTES['Luxury Suite BEOs'];
    expect(route).not.toContain('/checklist');
    expect(route).toContain('/stadium/beo-report');

    const department = new URLSearchParams(route.split('?')[1]).get('department');
    expect(parseReportDepartment(department)).toBe('premium_hospitality');
  });

  it('keeps the row whose readiness category really is checklist-backed', () => {
    // `setup` scores prep items plus incomplete checklist items.
    expect(READINESS_ROW_ROUTES['Commissary & Kitchens']).toBe('/checklist');
    expect(READINESS_ROW_ROUTES['Concessions & Stands']).toBe('/facility');
  });

  it('has no row pointing at a removed screen', () => {
    for (const route of Object.values(READINESS_ROW_ROUTES)) {
      expect(route).not.toContain('/(tabs)/guests');
      expect(route).not.toContain('/(tabs)/schedule');
      expect(route).not.toContain('/staff?');
    }
  });

  it('points the operational BEO entry points at the published report', () => {
    expect(EVENT_BEO_ROUTE).toBe('/stadium/beo-report');
    expect(SUITE_BEO_REPORT_ROUTE).toBe('/stadium/beo-report?department=premium_hospitality');
  });

  it('builds an event- and department-scoped report link', () => {
    expect(beoReportRoute()).toBe('/stadium/beo-report');
    expect(beoReportRoute({ eventId: 'evt_1' })).toBe('/stadium/beo-report?eventId=evt_1');
    expect(beoReportRoute({ eventId: 'evt_1', department: 'culinary_production' })).toBe(
      '/stadium/beo-report?eventId=evt_1&department=culinary_production'
    );
  });

  it('ignores a deep-link department the report does not render', () => {
    expect(parseReportDepartment('premium_hospitality')).toBe('premium_hospitality');
    expect(parseReportDepartment('checklist')).toBeUndefined();
    expect(parseReportDepartment(undefined)).toBeUndefined();
  });
});

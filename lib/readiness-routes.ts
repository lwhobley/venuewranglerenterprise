/**
 * Where the home screen's readiness rows lead.
 *
 * These live outside the screens so they can be asserted without rendering a
 * whole tab: the rows that talk about BEOs kept falling through to the
 * opening/closing checklist, which is a task list and scores a different
 * readiness category entirely.
 */

export { EVENT_BEO_ROUTE, SUITE_BEO_REPORT_ROUTE, beoReportRoute } from './beo-report';

/**
 * Destination for each readiness row, matched to the screen holding the records
 * that produced its score.
 *
 * `approvals` counts unconfirmed `CrmBeo` rows. Those are still recorded, but
 * the CRM workspace that used to display them has been removed, so the row
 * leads to the published BEO report — the only remaining BEO surface. The
 * report is built from `SuiteBeoOrder`, so the number and the page are not
 * reading the same table; see the note on the suites section of the report.
 *
 * `setup` really is checklist-backed, and `floor` is the concessions view.
 */
export const READINESS_ROW_ROUTES = {
  'Concessions & Stands': '/facility',
  'Luxury Suite BEOs': '/stadium/beo-report?department=premium_hospitality',
  'Commissary & Kitchens': '/checklist',
} as const;

export type ReadinessRowLabel = keyof typeof READINESS_ROW_ROUTES;

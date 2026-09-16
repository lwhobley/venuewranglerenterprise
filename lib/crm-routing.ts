/**
 * Where the BEO and readiness entry points lead.
 *
 * These live outside the screens so they can be asserted without rendering a
 * whole tab: the rows and blockers that talk about BEOs kept falling through to
 * the opening/closing checklist, which is a task list and scores a different
 * readiness category entirely.
 */

export type WorkspaceView = 'hub' | 'events';

const WORKSPACE_VIEWS: WorkspaceView[] = ['hub', 'events'];

/** Narrows a deep-link parameter to a view the CRM workspace actually renders. */
export function parseWorkspaceView(value: unknown): WorkspaceView | undefined {
  return typeof value === 'string' && (WORKSPACE_VIEWS as string[]).includes(value)
    ? (value as WorkspaceView)
    : undefined;
}

/**
 * The published event BEO report — the suite BEO list and each department's run
 * of service for one event. Operational BEO entry points lead here.
 */
export { EVENT_BEO_ROUTE, SUITE_BEO_REPORT_ROUTE, beoReportRoute } from './beo-report';

/**
 * The stadium BEO execution workspace on its Events tab. `eventName` filters the
 * list to one event when no specific beoId is requested.
 */
export function crmEventBeoRoute(eventName?: string): string {
  const query = new URLSearchParams();
  if (eventName) query.set('event', eventName);
  const qStr = query.toString();
  return qStr ? `/stadium/beo-hub?${qStr}` : '/stadium/beo-hub';
}

/**
 * One operational BEO in the stadium hub, by record id.
 */
export function crmBeoRoute(crmBeoId: string): string {
  return `/stadium/beo-hub?beoId=${encodeURIComponent(crmBeoId)}`;
}

export const STADIUM_BEO_HUB_ROUTE = '/stadium/beo-hub';

/**
 * Destination for each readiness row on the home screen.
 */
export const READINESS_ROW_ROUTES = {
  'Concessions & Stands': '/facility',
  'Luxury Suite BEOs': '/stadium/beo-hub',
  'Commissary & Kitchens': '/checklist',
  'Staffing & Union Roster': '/staff',
} as const;

export type ReadinessRowLabel = keyof typeof READINESS_ROW_ROUTES;


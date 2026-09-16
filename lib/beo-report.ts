/**
 * Client-side shape of the published event BEO report, mirroring
 * `packages/api/src/modules/stadium/event-beo-report.service.ts`.
 *
 * Kept in `lib/` rather than inside the screen so the routing helpers and their
 * tests can reason about departments without pulling in a React tree.
 */

export const BEO_REPORT_DEPARTMENTS = [
  'premium_hospitality',
  'culinary_production',
  'catering_banquets',
  'concessions',
  'beverage_operations',
  'retail_fnb',
  'vendor_partners',
  'unassigned',
] as const;

export type BeoReportDepartment = (typeof BEO_REPORT_DEPARTMENTS)[number];

/** Narrows a deep-link parameter to a department the report actually renders. */
export function parseReportDepartment(value: unknown): BeoReportDepartment | undefined {
  return typeof value === 'string' && (BEO_REPORT_DEPARTMENTS as readonly string[]).includes(value)
    ? (value as BeoReportDepartment)
    : undefined;
}

export type ReportLineKind = 'suite_delivery' | 'task' | 'run_of_show' | 'vendor' | 'outlet_readiness';

export interface ReportLine {
  id: string;
  kind: ReportLineKind;
  at: string | null;
  title: string;
  detail: string | null;
  status: string;
  reference: string | null;
}

export interface ReportDepartmentSection {
  code: BeoReportDepartment;
  label: string;
  lineCount: number;
  openCount: number;
  lines: ReportLine[];
}

/** The sales BEO an operational suite order fulfils, when one is linked. */
export interface SalesBeoRef {
  id: string;
  eventName: string;
  eventDate: string | null;
  status: string;
  fbMinimumCents: number | null;
  depositCents: number | null;
}

export interface SuiteBeoReportRow {
  id: string;
  beoNumber: string;
  /** Null when the suite order was raised without a sales document behind it. */
  salesBeo: SalesBeoRef | null;
  suiteCode: string;
  suiteName: string;
  zoneName: string;
  hostName: string;
  hostPhone: string | null;
  hostEmail: string | null;
  guestCount: number;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  status: string;
  specialInstructions: string | null;
  totalCents: number;
  lineItems: { code: string; name: string; quantity: number; unitPriceCents: number; category: string }[];
}

export interface EventBeoReportDocument {
  reportType: 'event_beo_report';
  version: number;
  publishedAt: string;
  trigger: 'manual' | 'scheduled';
  venue: { id: string; name: string };
  event: {
    id: string;
    title: string;
    eventCode: string | null;
    eventType: string;
    status: string;
    startsAt: string;
    gatesOpenAt: string | null;
    endsAt: string | null;
    expectedGuests: number | null;
    opponentOrHeadliner: string | null;
  };
  suites: {
    beoCount: number;
    guestCount: number;
    revenueCents: number;
    /** Suite orders carrying a link to their sales BEO. */
    linkedToSalesCount: number;
    rows: SuiteBeoReportRow[];
  };
  departments: ReportDepartmentSection[];
  totals: { lineCount: number; openLineCount: number; departmentCount: number };
  dataGaps: string[];
}

export interface PublishedBeoReport {
  id: string;
  version: number;
  trigger: 'manual' | 'scheduled';
  publishedAt: string;
  publishedBy: string;
  dataGaps: string[];
  report: EventBeoReportDocument;
}

/**
 * Statuses that mean the line is finished. Every source contributing a line —
 * suite deliveries, tasks, run of show, vendors, outlet readiness — spells
 * "done" differently, so the report reads them through one list.
 */
const SETTLED_LINE_STATUSES = new Set(['done', 'delivered', 'closed_invoiced', 'arrived', 'ready', 'complete', 'completed']);

export function isOpenLineStatus(status: string): boolean {
  return !SETTLED_LINE_STATUSES.has(status);
}

/** "5:30 – 6:15 PM", or just the start when the two are the same minute. */
export function formatWindow(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

/**
 * Shapes returned by the BEO upload parse step, mirroring
 * `packages/api/src/modules/stadium/beo-upload.service.ts`.
 */
export interface SuiteCandidate {
  id: string;
  zoneId: string;
  code: string;
  name: string;
}

export interface SuiteMatch {
  subVenueId: string;
  zoneId: string;
  code: string;
  name: string;
  confidence: 'exact_code' | 'exact_name' | 'number';
}

export interface ParsedSuiteRow {
  rowId: string;
  /** Exactly as the document wrote it, so a manager can check the mapping. */
  suiteLabel: string;
  beoNumber: string | null;
  hostName: string;
  guestCount: number;
  serviceStart: string | null;
  serviceEnd: string | null;
  specialInstructions: string | null;
  lineItems: { code: string; name: string; quantity: number; unitPriceCents: number; category: string }[];
  totalCents: number;
  match: SuiteMatch | null;
  candidates: SuiteCandidate[];
}

export interface ParsedBeoUpload {
  documentTitle: string;
  eventName: string;
  eventDate: string | null;
  notes: string;
  rows: ParsedSuiteRow[];
  /** Every active suite in the venue, for assigning a row with no candidates. */
  venueSuites: SuiteCandidate[];
  matchedCount: number;
  unmatchedCount: number;
  readyToCommit: boolean;
}

/** Where a manager imports the catering document for an event. */
export function beoUploadRoute(eventId?: string): string {
  return eventId ? `/stadium/beo-upload?eventId=${encodeURIComponent(eventId)}` : '/stadium/beo-upload';
}

/** The published report for one event, optionally opened on one department. */
export function beoReportRoute(options: { eventId?: string; department?: BeoReportDepartment } = {}): string {
  const query = new URLSearchParams();
  if (options.eventId) query.set('eventId', options.eventId);
  if (options.department) query.set('department', options.department);
  const suffix = query.toString();
  return suffix ? `/stadium/beo-report?${suffix}` : '/stadium/beo-report';
}

/** The report for the next event, all departments. */
export const EVENT_BEO_ROUTE = '/stadium/beo-report';

/** The suite BEO list — where every "Suite BEOs" entry point leads. */
export const SUITE_BEO_REPORT_ROUTE = beoReportRoute({ department: 'premium_hospitality' });

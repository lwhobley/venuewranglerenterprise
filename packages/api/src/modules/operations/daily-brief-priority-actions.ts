export type WranglerAction = {
  id: string;
  type: 'NAVIGATE' | 'ACKNOWLEDGE' | 'REASSIGN_RESERVATION' | 'NOTIFY_STAFF';
  label: string;
  route: '/reservations' | '/staff' | '/schedule' | '/bar-stock' | '/reports' | '/floor' | '/inventory';
  requiresConfirmation: boolean;
  payload?: Record<string, string | number | boolean | null>;
};

export type DailyBriefPriorityAction = {
  id: string;
  kind: 'event' | 'coverage' | 'requests' | 'stock' | 'floor' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  severity: 'info' | 'watch' | 'warning' | 'critical';
  title: string;
  body: string;
  reason: string;
  cta: string;
  route: WranglerAction['route'];
  actions: WranglerAction[];
};

type DailyBriefEvent = { title: string; startsAt: number; expectedGuests: number | null; reservationGuestName: string | null; reservationPartySize: number | null; notes: string | null };

function pluralize(count: number, singular: string, plural = `${singular}s`) { return `${count} ${count === 1 ? singular : plural}`; }
function guestSummary(event: DailyBriefEvent) { const guestCount = event.expectedGuests ?? event.reservationPartySize; return guestCount ? `${pluralize(guestCount, 'guest')} expected` : 'Guest count still needs a final check'; }
function action(id: string, label: string, route: WranglerAction['route']): WranglerAction { return { id, type: 'NAVIGATE', label, route, requiresConfirmation: false }; }
function notifyCoverageAction(openShiftCount: number): WranglerAction { return { id: 'coverage-notify-staff', type: 'NOTIFY_STAFF', label: 'Notify available staff', route: '/staff', requiresConfirmation: true, payload: { openShiftCount } }; }

export function buildDailyBriefPriorityActions(input: { openShiftCount: number; pendingRequestCount: number; lowStockCount: number; eightySixCount: number; events: DailyBriefEvent[] }): DailyBriefPriorityAction[] {
  const { openShiftCount, pendingRequestCount, lowStockCount, eightySixCount, events } = input;
  const actions: DailyBriefPriorityAction[] = [];
  const nextEvent = [...events].sort((a, b) => a.startsAt - b.startsAt)[0] ?? null;

  if (nextEvent) {
    const route = '/reservations' as const;
    actions.push({ id: `event-${nextEvent.startsAt}`, kind: 'event', tone: 'warn', severity: 'warning', title: `Prep ${nextEvent.reservationGuestName ?? nextEvent.title}`, body: `${guestSummary(nextEvent)}. Review the run sheet, seating plan, and service notes before doors open.`, reason: 'An upcoming event or reservation is the nearest time-sensitive service commitment.', cta: 'Open reservations', route, actions: [action(`event-${nextEvent.startsAt}-open`, 'Review reservation', route)] });
  }

  if (openShiftCount > 0) {
    const route = '/staff' as const;
    actions.push({ id: 'coverage-open-shifts', kind: 'coverage', tone: 'warn', severity: openShiftCount >= 3 ? 'critical' : 'warning', title: `Cover ${pluralize(openShiftCount, 'open shift')}`, body: 'Get the floor staffed before service so the shift starts with the right coverage.', reason: `${pluralize(openShiftCount, 'scheduled shift')} currently have no assigned coverage.`, cta: 'Notify staff', route, actions: [notifyCoverageAction(openShiftCount), action('coverage-open-staff', 'Open staff', route)] });
  }

  if (pendingRequestCount > 0) {
    const route = '/schedule' as const;
    actions.push({ id: 'requests-pending', kind: 'requests', tone: 'neutral', severity: 'watch', title: `Review ${pluralize(pendingRequestCount, 'pending request')}`, body: 'Approve or deny the queue now so the schedule stays stable for the next publish.', reason: `${pluralize(pendingRequestCount, 'staff request')} can still change upcoming coverage.`, cta: 'Open schedule', route, actions: [action('requests-open-schedule', 'Review requests', route)] });
  }

  if (lowStockCount > 0 || eightySixCount > 0) {
    const route = '/inventory' as const;
    const title = lowStockCount > 0 ? lowStockCount === 1 ? '1 low-stock item needs attention' : `${lowStockCount} low-stock items need attention` : `${pluralize(eightySixCount, 'item')} on the 86 list`;
    actions.push({ id: 'stock-risk', kind: 'stock', tone: lowStockCount > 0 ? 'warn' : 'neutral', severity: lowStockCount >= 3 ? 'warning' : 'watch', title, body: lowStockCount > 0 && eightySixCount > 0 ? `${pluralize(lowStockCount, 'low-stock item')} need attention and ${pluralize(eightySixCount, 'item')} are already 86'd. Refill before they interrupt service.` : lowStockCount > 0 ? 'Top up the bar list before the problem turns into a comp or a missed sale.' : 'Keep the 86 list current so the team does not sell what the bar cannot support.', reason: 'Current on-hand inventory is at or below par, or an item is already unavailable.', cta: 'Open inventory', route, actions: [action('stock-open-inventory', 'Review inventory', route)] });
  }

  if (actions.length === 0) {
    const route = '/reports' as const;
    actions.push({ id: 'service-steady', kind: 'steady', tone: 'good', severity: 'info', title: 'Service looks on track', body: 'No urgent event prep, coverage, request, or stock issues are blocking the shift.', reason: 'Wrangler found no active rule violations in the current daily operating context.', cta: 'Open reports', route, actions: [action('steady-open-reports', 'View service pulse', route)] });
  }

  const severityRank = { critical: 0, warning: 1, watch: 2, info: 3 } as const;
  return actions.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 4);
}

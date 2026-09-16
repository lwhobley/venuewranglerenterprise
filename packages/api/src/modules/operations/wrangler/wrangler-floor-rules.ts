import type { DailyBriefPriorityAction, WranglerAction } from '../daily-brief-priority-actions';

export type WranglerTableState = {
  tableId: string;
  label: string;
  status: 'available' | 'seated' | 'dirty' | 'reserved' | 'held' | 'out_of_service';
  seatedAt: number | null;
};

export type WranglerUpcomingAssignment = {
  assignmentId: string;
  tableId: string;
  tableLabel: string;
  startsAt: number;
  endsAt: number;
  reservationId: string | null;
  guestName: string | null;
  partySize: number | null;
  tags: string[];
  alternateTableId?: string | null;
  alternateTableLabel?: string | null;
};

function navAction(id: string, label: string, route: WranglerAction['route']): WranglerAction {
  return { id, type: 'NAVIGATE', label, route, requiresConfirmation: false };
}

function minutesBetween(earlier: number, later: number) {
  return Math.max(0, Math.round((later - earlier) / 60000));
}

export function buildWranglerFloorActions(input: {
  now: number;
  tables: WranglerTableState[];
  upcomingAssignments: WranglerUpcomingAssignment[];
  longSeatedMinutes?: number;
}): DailyBriefPriorityAction[] {
  const longSeatedMinutes = input.longSeatedMinutes ?? 120;
  const actions: DailyBriefPriorityAction[] = [];
  const tableById = new Map(input.tables.map((table) => [table.tableId, table]));

  for (const assignment of input.upcomingAssignments) {
    const table = tableById.get(assignment.tableId);
    if (!table || table.status !== 'seated') continue;

    const arrivalMinutes = Math.round((assignment.startsAt - input.now) / 60000);
    if (arrivalMinutes < 0 || arrivalMinutes > 30) continue;

    const isVip = assignment.tags.some((tag) => tag.toLowerCase().includes('vip'));
    const route = '/floor' as const;
    const recommendedActions: WranglerAction[] = [];

    recommendedActions.push(navAction(`floor-conflict:${assignment.assignmentId}:open`, 'Resolve on floor', route));

    actions.push({
      id: `floor-conflict:${assignment.assignmentId}`,
      kind: 'floor',
      tone: 'warn',
      severity: isVip ? 'critical' : 'warning',
      title: `${assignment.tableLabel} is still seated`,
      body: `${assignment.guestName ?? 'An incoming party'} arrives in ${arrivalMinutes} min${assignment.partySize ? ` for ${assignment.partySize}` : ''}, but the assigned table has not cleared.${assignment.alternateTableLabel ? ` ${assignment.alternateTableLabel} is available as an alternate.` : ''}`,
      reason: isVip
        ? 'A VIP reservation is approaching while its assigned table remains seated.'
        : 'An incoming reservation is approaching while its assigned table remains seated.',
      cta: assignment.alternateTableLabel ? `Move to ${assignment.alternateTableLabel}` : 'Open floor',
      route,
      actions: recommendedActions,
    });
  }

  for (const table of input.tables) {
    if (table.status !== 'seated' || table.seatedAt == null) continue;
    const seatedMinutes = minutesBetween(table.seatedAt, input.now);
    if (seatedMinutes < longSeatedMinutes) continue;

    const route = '/floor' as const;
    actions.push({
      id: `floor-long-seated:${table.tableId}`,
      kind: 'floor',
      tone: 'warn',
      severity: seatedMinutes >= longSeatedMinutes + 30 ? 'warning' : 'watch',
      title: `${table.label} has been seated ${seatedMinutes} min`,
      body: 'The table is running beyond the normal service window. Check the guest experience, check status, and upcoming reservation pressure.',
      reason: `The table has remained seated for at least ${longSeatedMinutes} minutes.`,
      cta: 'Open floor',
      route,
      actions: [navAction(`floor-long-seated:${table.tableId}:open`, 'Check table', route)],
    });
  }

  return actions;
}

import type { DailyBriefPriorityAction, WranglerAction } from '../daily-brief-priority-actions';

export type WranglerReservation = {
  id: string;
  guestName: string;
  partySize: number;
  reservationTime: number;
  tags: string[];
};

export type WranglerRuleInput = {
  now: number;
  reservations: WranglerReservation[];
  lowStockCount: number;
  eightySixCount: number;
};

function minutesUntil(now: number, target: number) {
  return Math.round((target - now) / 60000);
}

function navAction(id: string, label: string, route: WranglerAction['route']): WranglerAction {
  return { id, type: 'NAVIGATE', label, route, requiresConfirmation: false };
}

export function buildWranglerRuleActions(input: WranglerRuleInput): DailyBriefPriorityAction[] {
  const actions: DailyBriefPriorityAction[] = [];

  for (const reservation of input.reservations) {
    const mins = minutesUntil(input.now, reservation.reservationTime);
    const isVip = reservation.tags.some((tag) => tag.toLowerCase().includes('vip'));
    const isLarge = reservation.partySize >= 8;

    if (mins >= 0 && mins <= 30 && (isVip || isLarge)) {
      const route = '/reservations' as const;
      actions.push({
        id: `arrival:${reservation.id}`,
        kind: 'event',
        tone: 'warn',
        severity: isVip ? 'warning' : 'watch',
        title: `${reservation.guestName} arrives in ${mins} min`,
        body: `${reservation.partySize} guests expected. Review seating, service notes, and floor readiness before arrival.`,
        reason: isVip ? 'VIP arrival inside the next 30 minutes.' : 'Large-party arrival inside the next 30 minutes.',
        cta: 'Open reservations',
        route,
        actions: [navAction(`open-reservation:${reservation.id}`, 'Review arrival', route)],
      });
    }
  }

  if (input.lowStockCount > 0 && input.eightySixCount > 0) {
    const route = '/bar-stock' as const;
    actions.push({
      id: 'inventory:service-risk',
      kind: 'stock',
      tone: 'warn',
      severity: 'warning',
      title: 'Inventory is already affecting service',
      body: `${input.lowStockCount} low-stock item${input.lowStockCount === 1 ? '' : 's'} and ${input.eightySixCount} item${input.eightySixCount === 1 ? '' : 's'} on the 86 list need attention.`,
      reason: 'Low stock and active 86 items are occurring at the same time.',
      cta: 'Open inventory',
      route,
      actions: [navAction('inventory:open', 'Review inventory', route)],
    });
  }

  return actions;
}

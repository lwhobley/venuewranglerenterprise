import type { DailyBriefPriorityAction } from '../daily-brief-priority-actions';
import type { WranglerServicePhase } from './wrangler-service-phase';

export type WranglerSummary = {
  covers: number;
  reservations: number;
  vipArrivals: number;
  lowStockItems: number;
  eightySixItems: number;
  pendingStaffRequests: number;
  seatedTables: number;
  activeWaitlist?: number;
  totalSalesCents?: number;
  openChecksCount?: number;
  connectedIntegrationsCount?: number;
  disconnectedIntegrationsCount?: number;
  teamMessagesCount?: number;
};

export function buildWranglerRecap(args: { phase: WranglerServicePhase; summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const unresolved = args.priorities.filter((item) => item.severity !== 'info');
  const headline = args.phase === 'closed'
    ? unresolved.length ? `Service closed with ${unresolved.length} item${unresolved.length === 1 ? '' : 's'} to carry forward.` : 'Service closed cleanly.'
    : args.phase === 'closing'
      ? `${args.summary.seatedTables} table${args.summary.seatedTables === 1 ? '' : 's'} still active as service winds down.`
      : `${args.summary.covers} covers across ${args.summary.reservations} reservations are in today's service picture.`;

  return {
    headline,
    metrics: [
      { label: 'Covers', value: args.summary.covers },
      { label: 'VIPs', value: args.summary.vipArrivals },
      { label: 'Low stock', value: args.summary.lowStockItems },
      { label: 'Waitlist', value: args.summary.activeWaitlist ?? 0 },
    ],
    unresolved: unresolved.slice(0, 4).map((item) => ({ id: item.id, title: item.title, severity: item.severity, reason: item.reason })),
    tomorrow: unresolved.slice(0, 3).map((item) => item.reason),
  };
}

export function buildWranglerPatterns(args: { summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const patterns: Array<{ id: string; title: string; detail: string; confidence: 'live' | 'emerging' }> = [];
  if (args.summary.lowStockItems > 0 || args.summary.eightySixItems > 0) patterns.push({ id: 'stock', title: 'Inventory pressure', detail: `${args.summary.lowStockItems} low-stock and ${args.summary.eightySixItems} 86'd item${args.summary.eightySixItems === 1 ? '' : 's'} need follow-through.`, confidence: 'live' });
  if (args.priorities.some((item) => item.kind === 'floor')) patterns.push({ id: 'floor', title: 'Floor pressure', detail: 'Current seating and reservation timing are creating a floor conflict.', confidence: 'live' });
  if ((args.summary.disconnectedIntegrationsCount ?? 0) > 0) patterns.push({ id: 'integrations', title: 'Integration pressure', detail: `${args.summary.disconnectedIntegrationsCount} integration connection${args.summary.disconnectedIntegrationsCount === 1 ? '' : 's'} need attention.`, confidence: 'live' });
  if ((args.summary.activeWaitlist ?? 0) > 3) patterns.push({ id: 'waitlist', title: 'Waitlist demand', detail: `${args.summary.activeWaitlist} parties are currently waiting on the floor.`, confidence: 'live' });
  return patterns.slice(0, 4);
}

export function answerWranglerQuestion(question: string, args: { phaseLabel: string; summary: WranglerSummary; priorities: DailyBriefPriorityAction[] }) {
  const q = question.trim().toLowerCase();
  const top = args.priorities[0];
  if (!q) return { answer: 'Ask about service pressure, staffing, sales, floor, CRM leads, stock, integrations, or what to fix next.', sources: [] as string[] };
  if (q.includes('before') || q.includes('fix') || q.includes('attention') || q.includes('next')) {
    return top
      ? { answer: `${top.title}. ${top.reason} Recommended move: ${top.cta}.`, sources: [top.id] }
      : { answer: `Nothing needs immediate intervention during ${args.phaseLabel.toLowerCase()}.`, sources: [] };
  }
  if (q.includes('sale') || q.includes('revenue') || q.includes('sales') || q.includes('check')) {
    const totalDollars = ((args.summary.totalSalesCents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return { answer: `Today's sales stand at ${totalDollars} across ${args.summary.openChecksCount ?? 0} open checks and closed orders.`, sources: ['sales'] };
  }
  if (q.includes('integration') || q.includes('pos') || q.includes('toast') || q.includes('stripe') || q.includes('opentable')) {
    const dis = args.summary.disconnectedIntegrationsCount ?? 0;
    return { answer: dis > 0 ? `${dis} integration connection(s) require attention.` : `All ${args.summary.connectedIntegrationsCount ?? 0} integration connections are healthy and active.`, sources: ['integrations'] };
  }
  if (q.includes('waitlist') || q.includes('walk') || q.includes('waiting')) {
    return { answer: `There are currently ${args.summary.activeWaitlist ?? 0} parties on the walk-in waitlist.`, sources: ['waitlist'] };
  }
  if (q.includes('chat') || q.includes('message') || q.includes('announcement')) {
    return { answer: `${args.summary.teamMessagesCount ?? 0} team messages have been shared in staff chat channels.`, sources: ['chat'] };
  }
  if (q.includes('stock') || q.includes('bar') || q.includes('86') || q.includes('inventory')) return { answer: `${args.summary.lowStockItems} items are at or below par and ${args.summary.eightySixItems} items are currently 86'd.`, sources: ['stock'] };
  if (q.includes('vip') || q.includes('guest')) return { answer: `${args.summary.vipArrivals} VIP arrival${args.summary.vipArrivals === 1 ? '' : 's'} are in today's reservation picture.`, sources: ['guest'] };
  if (q.includes('floor') || q.includes('table') || q.includes('turn')) return { answer: `${args.summary.seatedTables} tables are seated now with ${args.summary.activeWaitlist ?? 0} parties on the waitlist.${top?.kind === 'floor' ? ` ${top.title}: ${top.reason}` : ' No floor issue is currently the top operational priority.'}`, sources: top?.kind === 'floor' ? [top.id] : [] };
  return { answer: top ? `During ${args.phaseLabel.toLowerCase()}, the top issue is ${top.title.toLowerCase()}. ${top.reason}` : `Service is currently under control during ${args.phaseLabel.toLowerCase()}.`, sources: top ? [top.id] : [] };
}

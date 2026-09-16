export type DailyBriefRecoveryAction = {
  kind: 'labor' | 'coverage' | 'schedule' | 'inventory' | 'floor' | 'steady';
  tone: 'good' | 'warn' | 'neutral';
  title: string;
  body: string;
  cta: string;
  route: '/floor' | '/reports' | '/reservations' | '/schedule' | '/staff' | '/bar-stock' | '/inventory';
};

export type DailyBriefProfitabilityPulse = {
  tone: 'good' | 'warn' | 'neutral';
  headline: string;
  detail: string;
  salesCents: number;
  laborHours: number;
  salesPerLaborHourCents: number | null;
  openChecks: number;
  activeClocks: number;
  recoveryActions: DailyBriefRecoveryAction[];
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function wholeDollars(cents: number | null | undefined) {
  if (cents == null) return '—';
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export function buildDailyBriefProfitabilityPulse(input: {
  salesCents: number;
  laborHours: number;
  openChecks: number;
  activeClocks: number;
  openShiftCount: number;
  pendingRequestCount: number;
  lowStockCount: number;
  eightySixCount: number;
}): DailyBriefProfitabilityPulse {
  const {
    salesCents,
    laborHours,
    openChecks,
    activeClocks,
    openShiftCount,
    pendingRequestCount,
    lowStockCount,
    eightySixCount,
  } = input;
  const salesPerLaborHourCents = laborHours > 0 ? Math.round(salesCents / laborHours) : null;
  const recoveryActions: DailyBriefRecoveryAction[] = [];

  let tone: DailyBriefProfitabilityPulse['tone'] = 'neutral';
  let headline = 'Sales and labor are in balance';
  let detail = laborHours > 0
    ? `Today is running at ${wholeDollars(salesPerLaborHourCents)} in sales per labor hour.`
    : 'No labor hours have posted yet, so the margin pulse is still warming up.';

  if (salesPerLaborHourCents == null) {
    if (salesCents > 0) {
      headline = 'Sales are coming in before labor data is ready';
      detail = 'The shift has revenue, but there are no labor hours on the board yet.';
    } else {
      headline = 'No sales or labor logged yet';
      detail = 'The room is still quiet, so there is nothing to recover from yet.';
    }
  } else if (salesPerLaborHourCents < 10000) {
    tone = 'warn';
    headline = 'Labor is outrunning sales';
    detail = `Sales per labor hour is ${wholeDollars(salesPerLaborHourCents)}. Tighten the floor, the roster, or both.`;
  } else if (salesPerLaborHourCents >= 18000) {
    tone = 'good';
    headline = 'Sales are ahead of labor pace';
    detail = `Sales per labor hour is ${wholeDollars(salesPerLaborHourCents)} and the shift is holding up well.`;
  }

  if (salesPerLaborHourCents != null && salesPerLaborHourCents < 10000) {
    if (openChecks > 0) {
      recoveryActions.push({
        kind: 'floor',
        tone: 'warn',
        title: `Turn ${pluralize(openChecks, 'open check')} faster`,
        body: `Open checks are tying up the floor while sales per labor hour sits at ${wholeDollars(salesPerLaborHourCents)}.`,
        cta: 'Open floor',
        route: '/floor',
      });
    } else if (activeClocks > 0) {
      recoveryActions.push({
        kind: 'labor',
        tone: 'warn',
        title: 'Labor is ahead of sales',
        body: `${activeClocks} people are clocked in and sales are moving slowly. Check whether one role can be released early.`,
        cta: 'Open reports',
        route: '/reports',
      });
    }
  }

  if (openShiftCount > 0) {
    recoveryActions.push({
      kind: 'coverage',
      tone: 'warn',
      title: `Fill ${pluralize(openShiftCount, 'open shift')}`,
      body: 'Close the coverage gap before it turns into a slower floor and a noisier service.',
      cta: 'Open staff',
      route: '/staff',
    });
  }

  if (pendingRequestCount > 0) {
    recoveryActions.push({
      kind: 'schedule',
      tone: 'neutral',
      title: `Clear ${pluralize(pendingRequestCount, 'pending request')}`,
      body: 'Approve or deny the queue so staffing changes stop dragging on the next publish.',
      cta: 'Open schedule',
      route: '/schedule',
    });
  }

  if (lowStockCount > 0 || eightySixCount > 0) {
    recoveryActions.push({
      kind: 'inventory',
      tone: lowStockCount > 0 ? 'warn' : 'neutral',
      title: lowStockCount > 0
        ? `${pluralize(lowStockCount, 'low-stock item')} need attention`
        : `${pluralize(eightySixCount, 'item')} on the 86 list`,
      body: lowStockCount > 0 && eightySixCount > 0
        ? `${pluralize(lowStockCount, 'low-stock item')} are low and ${pluralize(eightySixCount, 'item')} are already 86'd.`
        : lowStockCount > 0
          ? 'Top up the bar list before the problem turns into a comp or a missed sale.'
          : 'Keep the 86 list current so the team does not sell what the bar cannot support.',
      cta: 'Open inventory',
      route: '/inventory',
    });
  }

  if (recoveryActions.length === 0) {
    recoveryActions.push({
      kind: 'steady',
      tone: 'good',
      title: 'No recovery steps needed',
      body: 'The margin pulse looks stable and there is no immediate recovery work to push.',
      cta: 'Open reports',
      route: '/reports',
    });
  }

  return {
    tone,
    headline,
    detail,
    salesCents,
    laborHours,
    salesPerLaborHourCents,
    openChecks,
    activeClocks,
    recoveryActions: recoveryActions.slice(0, 4),
  };
}

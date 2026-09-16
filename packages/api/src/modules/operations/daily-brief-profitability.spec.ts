import { describe, expect, it } from 'vitest';
import { buildDailyBriefProfitabilityPulse } from './daily-brief-profitability';

const BASE = {
  salesCents: 0,
  laborHours: 0,
  openChecks: 0,
  activeClocks: 0,
  pendingRequestCount: 0,
  lowStockCount: 0,
  eightySixCount: 0,
};

describe('buildDailyBriefProfitabilityPulse', () => {
  it('returns a calm steady-state pulse when nothing is live yet', () => {
    expect(buildDailyBriefProfitabilityPulse(BASE)).toMatchObject({
      tone: 'neutral',
      headline: 'No sales or labor logged yet',
      recoveryActions: [
        {
          kind: 'steady',
          tone: 'good',
          title: 'No recovery steps needed',
          cta: 'Open reports',
          route: '/reports',
        },
      ],
    });
  });

  it('flags low sales-per-labor and prioritizes floor recovery first', () => {
    const pulse = buildDailyBriefProfitabilityPulse({
      ...BASE,
      salesCents: 18000,
      laborHours: 3,
      openChecks: 4,
      activeClocks: 6,
      pendingRequestCount: 1,
      lowStockCount: 1,
      eightySixCount: 2,
    });

    expect(pulse.tone).toBe('warn');
    expect(pulse.headline).toBe('Labor is outrunning sales');
    expect(pulse.recoveryActions.map((action) => action.kind)).toEqual(['floor', 'schedule', 'inventory']);
  });

  it('marks strong sales pace as healthy', () => {
    const pulse = buildDailyBriefProfitabilityPulse({
      ...BASE,
      salesCents: 90000,
      laborHours: 4,
      openChecks: 0,
      activeClocks: 4,
    });

    expect(pulse.tone).toBe('good');
    expect(pulse.headline).toBe('Sales are ahead of labor pace');
  });
});

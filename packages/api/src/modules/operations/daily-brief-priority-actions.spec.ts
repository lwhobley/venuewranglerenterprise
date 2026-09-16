import { describe, expect, it } from 'vitest';
import { buildDailyBriefPriorityActions } from './daily-brief-priority-actions';

const ZERO = { pendingRequestCount: 0, lowStockCount: 0, eightySixCount: 0, events: [] as any[] };

describe('buildDailyBriefPriorityActions', () => {
  it('returns a structured steady-state action when nothing needs attention', () => {
    const [result] = buildDailyBriefPriorityActions(ZERO);

    expect(result).toMatchObject({
      id: 'service-steady',
      kind: 'steady',
      tone: 'good',
      severity: 'info',
      title: 'Service looks on track',
      route: '/reports',
      actions: [
        {
          type: 'NAVIGATE',
          label: 'View service pulse',
          route: '/reports',
          requiresConfirmation: false,
        },
      ],
    });
  });

  it('orders priorities by severity instead of feature order', () => {
    const results = buildDailyBriefPriorityActions({
      ...ZERO,
      pendingRequestCount: 1,
      lowStockCount: 3,
      events: [{
        title: 'Private dinner',
        startsAt: 1,
        expectedGuests: 24,
        reservationGuestName: 'Smith',
        reservationPartySize: null,
        notes: null,
      }],
    });

    expect(results.map((item) => item.kind)).toEqual(['event', 'stock', 'requests']);
    expect(results.map((item) => item.severity)).toEqual(['warning', 'warning', 'watch']);
  });

  it('includes the operational reason and nested action metadata', () => {
    const [result] = buildDailyBriefPriorityActions({
      ...ZERO,
      lowStockCount: 1,
      eightySixCount: 2,
    });

    expect(result).toMatchObject({
      id: 'stock-risk',
      kind: 'stock',
      severity: 'watch',
      route: '/bar-stock',
      reason: expect.any(String),
      actions: [
        {
          id: 'stock-open-inventory',
          type: 'NAVIGATE',
          route: '/bar-stock',
          requiresConfirmation: false,
        },
      ],
    });
  });
});

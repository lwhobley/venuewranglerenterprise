import { describe, expect, it } from 'vitest';
import { buildWranglerRuleActions } from './wrangler-rules';

const NOW = new Date('2026-08-08T18:00:00.000Z').getTime();

describe('buildWranglerRuleActions', () => {
  it('surfaces a VIP arrival inside the next 30 minutes', () => {
    const results = buildWranglerRuleActions({
      now: NOW,
      reservations: [
        {
          id: 'res-vip',
          guestName: 'Jordan Carter',
          partySize: 4,
          reservationTime: NOW + 18 * 60_000,
          tags: ['VIP'],
        },
      ],
      lowStockCount: 0,
      eightySixCount: 0,
    });

    expect(results[0]).toMatchObject({
      id: 'arrival:res-vip',
      kind: 'event',
      severity: 'warning',
      title: 'Jordan Carter arrives in 18 min',
      route: '/reservations',
    });
  });

  it('does not alert on an ordinary small reservation inside 30 minutes', () => {
    const results = buildWranglerRuleActions({
      now: NOW,
      reservations: [
        {
          id: 'res-standard',
          guestName: 'Standard Guest',
          partySize: 2,
          reservationTime: NOW + 10 * 60_000,
          tags: [],
        },
      ],
      lowStockCount: 0,
      eightySixCount: 0,
    });

    expect(results).toEqual([]);
  });

  it('flags inventory when low stock and 86 items overlap', () => {
    const results = buildWranglerRuleActions({
      now: NOW,
      reservations: [],
      lowStockCount: 2,
      eightySixCount: 1,
    });

    expect(results[0]).toMatchObject({
      id: 'inventory:service-risk',
      kind: 'stock',
      severity: 'warning',
      route: '/bar-stock',
    });
  });
});

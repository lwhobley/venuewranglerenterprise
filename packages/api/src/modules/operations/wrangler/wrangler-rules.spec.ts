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
      openShiftCount: 0,
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
      openShiftCount: 0,
      lowStockCount: 0,
      eightySixCount: 0,
    });

    expect(results).toEqual([]);
  });

  it('escalates three or more open shifts to critical coverage risk', () => {
    const results = buildWranglerRuleActions({
      now: NOW,
      reservations: [],
      openShiftCount: 3,
      lowStockCount: 0,
      eightySixCount: 0,
    });

    expect(results[0]).toMatchObject({
      id: 'coverage:critical',
      kind: 'coverage',
      severity: 'critical',
      route: '/staff',
    });
  });

  it('flags inventory when low stock and 86 items overlap', () => {
    const results = buildWranglerRuleActions({
      now: NOW,
      reservations: [],
      openShiftCount: 0,
      lowStockCount: 2,
      eightySixCount: 1,
    });

    expect(results[0]).toMatchObject({
      id: 'inventory:service-risk',
      kind: 'stock',
      severity: 'warning',
      route: '/inventory',
    });
  });
});

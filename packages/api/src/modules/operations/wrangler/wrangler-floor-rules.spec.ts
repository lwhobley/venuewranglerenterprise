import { describe, expect, it } from 'vitest';
import { buildWranglerFloorActions } from './wrangler-floor-rules';

const NOW = new Date('2026-08-08T19:00:00.000Z').getTime();

describe('buildWranglerFloorActions', () => {
  it('flags an incoming VIP whose assigned table is still seated', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't18', label: 'Table 18', status: 'seated', seatedAt: NOW - 95 * 60_000 },
      ],
      upcomingAssignments: [
        {
          assignmentId: 'a1',
          tableId: 't18',
          tableLabel: 'Table 18',
          startsAt: NOW + 18 * 60_000,
          endsAt: NOW + 108 * 60_000,
          reservationId: 'r1',
          guestName: 'Jordan Carter',
          partySize: 4,
          tags: ['VIP'],
        },
      ],
    });

    expect(results[0]).toMatchObject({
      id: 'floor-conflict:a1',
      kind: 'floor',
      severity: 'critical',
      route: '/floor',
    });
  });

  it('offers an executable move when a safe alternate exists', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't18', label: 'Table 18', status: 'seated', seatedAt: NOW - 95 * 60_000 },
      ],
      upcomingAssignments: [
        {
          assignmentId: 'a1',
          tableId: 't18',
          tableLabel: 'Table 18',
          startsAt: NOW + 18 * 60_000,
          endsAt: NOW + 108 * 60_000,
          reservationId: 'r1',
          guestName: 'Jordan Carter',
          partySize: 4,
          tags: ['VIP'],
          alternateTableId: 't12',
          alternateTableLabel: 'Table 12',
        },
      ],
    });

    // Reservation reassignment was cut from the enterprise shell; the conflict
    // still surfaces with a navigation action and names the alternate table.
    expect(results[0]?.actions.map((action) => action.type)).not.toContain('REASSIGN_RESERVATION');
    expect(results[0]?.actions[0]?.id).toBe('floor-conflict:a1:open');
    expect(results[0]?.body).toContain('Table 12');
  });

  it('flags a table seated beyond the service window', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't22', label: 'Table 22', status: 'seated', seatedAt: NOW - 132 * 60_000 },
      ],
      upcomingAssignments: [],
      longSeatedMinutes: 120,
    });

    expect(results[0]).toMatchObject({
      id: 'floor-long-seated:t22',
      kind: 'floor',
      severity: 'watch',
      route: '/floor',
      title: 'Table 22 has been seated 132 min',
    });
  });

  it('ignores an upcoming assignment when the table is already clear', () => {
    const results = buildWranglerFloorActions({
      now: NOW,
      tables: [
        { tableId: 't12', label: 'Table 12', status: 'available', seatedAt: null },
      ],
      upcomingAssignments: [
        {
          assignmentId: 'a2',
          tableId: 't12',
          tableLabel: 'Table 12',
          startsAt: NOW + 10 * 60_000,
          endsAt: NOW + 100 * 60_000,
          reservationId: 'r2',
          guestName: 'Alex Morgan',
          partySize: 2,
          tags: [],
        },
      ],
    });

    expect(results).toEqual([]);
  });
});

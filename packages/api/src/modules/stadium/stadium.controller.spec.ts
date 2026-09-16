import { describe, expect, it, vi } from 'vitest';
import { StadiumController } from './stadium.controller';

describe('StadiumController Phase 3 - Live Operations', () => {
  const scope: any = {
    venueId: 'venue-1',
    profileId: 'user-1',
    role: 'organization_admin',
    allAccess: true,
  };

  it('retains active live events past kickoff in overview', async () => {
    const pastKickoffDate = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
    const mockEvents = [
      {
        id: 'event-live',
        title: 'Championship Game',
        startsAt: pastKickoffDate,
        gatesOpenAt: new Date(Date.now() - 90 * 60 * 1000),
        eventType: 'nfl',
        operationalState: 'live',
        fnbReadiness: [],
        issues: [],
      },
    ];

    const tx: any = {
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'venue-1',
          name: 'Colosseum',
          venueType: 'stadium',
          stadiumCapacity: 75000,
          homeTeam: 'Warriors',
          timezone: 'America/New_York',
        }),
      },
      venueEvent: {
        findMany: vi.fn().mockImplementation(async (args) => {
          // Verify that query uses OR condition to include active operational states
          expect(args.where.OR).toBeDefined();
          return mockEvents;
        }),
      },
      fnbOperationUnit: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      fnbPartner: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const controller = new StadiumController(tx);
    const result = await controller.overview(scope);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('event-live');
    expect(result.events[0].operationalState).toBe('live');
  });

  it('calculates SLA deadlines and breach status correctly for event issues', async () => {
    const now = Date.now();
    // Issue created 10 minutes ago, unacknowledged, critical (ack SLA is 5 min => breached)
    const criticalBreachedIssue = {
      id: 'issue-crit',
      title: 'POS Terminal Down Section 102',
      severity: 'critical',
      status: 'open',
      openedAt: new Date(now - 10 * 60 * 1000),
      acknowledgedAt: null,
      resolvedAt: null,
      outlet: { id: 'outlet-1', name: 'West Concourse Bar' },
      event: { id: 'event-1', title: 'Game Day' },
    };

    // Issue created 2 minutes ago, low (ack SLA is 30 min => nominal)
    const criticalNominalIssue = {
      id: 'issue-fresh',
      title: 'Ketchup Dispenser Low',
      severity: 'low',
      status: 'open',
      openedAt: new Date(now - 2 * 60 * 1000),
      acknowledgedAt: null,
      resolvedAt: null,
      outlet: { id: 'outlet-2', name: 'East Stand' },
      event: { id: 'event-1', title: 'Game Day' },
    };

    const tx: any = {
      venueEvent: {
        findFirst: vi.fn().mockResolvedValue({ id: 'event-1', venueId: 'venue-1' }),
      },
      eventIssue: {
        findMany: vi.fn().mockResolvedValue([criticalBreachedIssue, criticalNominalIssue]),
      },
    };

    const controller = new StadiumController(tx);
    const issues = await controller.listEventIssues(scope, 'event-1');

    expect(issues).toHaveLength(2);
    // Critical issue should have breached ACK SLA
    expect(issues[0].isAckBreached).toBe(true);
    expect(issues[0].slaStatus).toBe('breached');
    expect(issues[0].ackDeadlineAt).toBeDefined();

    // Fresh low-severity issue should be nominal
    expect(issues[1].isAckBreached).toBe(false);
    expect(issues[1].slaStatus).toBe('nominal');
  });

  it('advances event phase, enforces alcohol cutoff, and logs audit record', async () => {
    const mockEvent = {
      id: 'event-1',
      venueId: 'venue-1',
      organizationId: 'org-1',
      title: 'Championship Game',
    };

    let auditLogRecord: any = null;

    const tx: any = {
      venueEvent: {
        findFirst: vi.fn().mockResolvedValue(mockEvent),
      },
      venue: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' }),
      },
      facility: {
        findUnique: vi.fn().mockResolvedValue({ id: 'venue-1' }),
      },
      eventAuditLog: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          auditLogRecord = { id: 'audit-1', createdAt: new Date(), ...data };
          return auditLogRecord;
        }),
      },
    };

    const mockGateway: any = {
      broadcastEventIssue: vi.fn().mockResolvedValue(undefined),
    };

    const controller = new StadiumController(tx, mockGateway);
    const result = await controller.advanceEventPhase(scope, 'event-1', {
      phase: 'q4_alcohol_cutoff',
      reason: 'Standard 4th quarter alcohol service cessation',
      alcoholCutoffEnforced: true,
      isOvertime: false,
    });

    expect(result.phase).toBe('q4_alcohol_cutoff');
    expect(result.alcoholCutoffEnforced).toBe(true);
    expect(result.updatedAt).toBeDefined();
    expect(auditLogRecord).toBeDefined();
    expect(auditLogRecord.action).toBe('phase_advanced');
    expect(auditLogRecord.metadata.phase).toBe('q4_alcohol_cutoff');
    expect(auditLogRecord.metadata.alcoholCutoffEnforced).toBe(true);
  });
});

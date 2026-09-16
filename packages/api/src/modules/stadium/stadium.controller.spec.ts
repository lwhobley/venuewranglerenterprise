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
        findFirst: vi.fn().mockResolvedValue(null),
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

  it('refuses to move the game phase back or reopen alcohol sales without a reason', async () => {
    const tx: any = {
      venueEvent: { findFirst: vi.fn().mockResolvedValue({ id: 'event-1', organizationId: 'org-1', title: 'Game' }) },
      eventAuditLog: {
        findFirst: vi.fn().mockResolvedValue({ metadata: { phase: 'q4_alcohol_cutoff', alcoholCutoffEnforced: true } }),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'audit-2', createdAt: new Date(), ...data })),
      },
    };
    const controller = new StadiumController(tx);

    await expect(controller.advanceEventPhase(scope, 'event-1', { phase: 'halftime' })).rejects.toThrow('requires a reason');
    await expect(controller.advanceEventPhase(scope, 'event-1', { phase: 'q4_alcohol_cutoff', alcoholCutoffEnforced: false }))
      .rejects.toThrow('Clearing the alcohol cutoff requires a reason');
    expect(tx.eventAuditLog.create).not.toHaveBeenCalled();

    // Moving forward without restating the cutoff keeps it enforced.
    const next = await controller.advanceEventPhase(scope, 'event-1', { phase: 'postgame' });
    expect(next.alcoholCutoffEnforced).toBe(true);
  });

  it('calculates comprehensive operational variance pack including dark stands and transfer shrink', async () => {
    const mockEvent = {
      id: 'event-1',
      title: 'Playoff Game',
      startsAt: new Date(),
      operationalState: 'closing',
      organizationId: 'org-1',
    };

    const mockCloseout = {
      laborHours: 400,
      laborCostCents: 1200000,
      actualSalesCents: 8500000,
      forecastSalesCents: 8000000,
    };

    const mockIssues = [
      {
        id: 'issue-86',
        issueType: 'stockout',
        severity: 'high',
        status: 'open',
        title: '86 Draft Beer Stand 104',
        openedAt: new Date(Date.now() - 45 * 60 * 1000),
        resolvedAt: null,
        outletId: 'unit-1',
      },
    ];

    const mockUnits = [
      { id: 'unit-1', name: 'Stand 104', department: 'concessions', stadiumZone: '100 Level' },
      { id: 'unit-2', name: 'Stand 105', department: 'concessions', stadiumZone: '100 Level' },
    ];

    // Stand 105 has no readiness entry, meaning it is a dark stand
    const mockReadiness = [{ zoneId: 'unit-1', status: 'ready' }];

    const mockTransfers = [
      { id: 't-1', status: 'completed', items: [{ requestedQty: 100, issuedQty: 100, receivedQty: 95, returnedQty: 0 }] },
      // Completed but never received: must not be counted as a clean receipt.
      { id: 't-2', status: 'completed', items: [{ requestedQty: 40, issuedQty: 40 }] },
    ];

    const tx: any = {
      venueEvent: { findFirst: vi.fn().mockResolvedValue(mockEvent) },
      eventCloseout: { findUnique: vi.fn().mockResolvedValue(mockCloseout) },
      eventIssue: { findMany: vi.fn().mockResolvedValue(mockIssues) },
      eventFnbReadiness: { findMany: vi.fn().mockResolvedValue(mockReadiness) },
      fnbOperationUnit: { findMany: vi.fn().mockResolvedValue(mockUnits) },
      inventoryTransferRequest: { findMany: vi.fn().mockResolvedValue(mockTransfers) },
      venue: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' }) },
      facility: { findUnique: vi.fn().mockResolvedValue({ id: 'venue-1' }) },
    };

    const controller = new StadiumController(tx);
    const variance = await controller.getEventVariancePack(scope, 'event-1');

    expect(variance.eventId).toBe('event-1');
    expect(variance.labor.actualSalesCents).toBe(8500000);
    expect(variance.labor.salesVarianceCents).toBe(500000); // 8500000 - 8000000
    expect(variance.stockouts.totalStockouts).toBe(1);
    expect(variance.stockouts.unresolvedCount).toBe(1);
    expect(variance.darkStands.totalDarkStands).toBe(1); // Stand 105 unopened
    expect(variance.darkStands.stands[0].name).toBe('Stand 105');
    expect(variance.transfers.discrepancyQty).toBe(5); // 100 issued - 95 received
    expect(variance.transfers.receivedQty).toBe(95);
    expect(variance.transfers.unconfirmedReceiptLines).toBe(1);
  });

  it('aggregates multi-venue operational roll-up across accessible venues', async () => {
    const mockVenues = [
      { id: 'v-1', name: 'Metro Arena', stadiumCapacity: 20000, homeTeam: 'Wolves' },
      { id: 'v-2', name: 'State Stadium', stadiumCapacity: 70000, homeTeam: 'Titans' },
    ];

    const tx: any = {
      venue: {
        findMany: vi.fn().mockResolvedValue(mockVenues),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'venue-1', organizationId: 'org-1' }),
      },
      facility: { findUnique: vi.fn().mockResolvedValue({ id: 'venue-1' }) },
      venueEvent: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'ev-active',
          title: 'Live Championship',
          operationalState: 'live',
          startsAt: new Date(),
        }),
      },
      eventIssue: { count: vi.fn().mockResolvedValue(1) },
      fnbOperationUnit: { count: vi.fn().mockResolvedValue(10) },
    };

    const controller = new StadiumController(tx);
    const rollup = await controller.getMultiVenueRollup(scope);

    expect(rollup.totalVenues).toBe(2);
    expect(rollup.activeEventsCount).toBe(2);
    expect(rollup.venues[0].operationalHealth).toBe('watch'); // 1 issue
    expect(tx.venue.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' } }));
  });
});

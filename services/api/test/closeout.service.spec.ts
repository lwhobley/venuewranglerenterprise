import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CloseoutService } from '../src/closeout.service';
import type { Identity } from '../src/auth';
import type { PrismaService } from '../src/prisma.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const closeoutId = '40000000-0000-4000-8000-000000000001';
const issueId = '50000000-0000-4000-8000-000000000001';

const identity: Identity = {
  subject: 'idp|manager', tenantId, capabilities: ['event:closeout'],
  venueIds: ['10000000-0000-4000-8000-000000000001'], eventIds: [eventId],
  locationIds: [], assignableUserIds: ['idp|worker'],
};

function serviceFor(tx: Record<string, unknown>) {
  const prisma = { withTenant: vi.fn((_identity, work) => work(tx)) } as unknown as PrismaService;
  return new CloseoutService(prisma, { deliver: vi.fn() } as never);
}

function emptyExceptionQueries() {
  return {
    issue: { findMany: vi.fn().mockResolvedValue([{ id: issueId, title: 'Service issue', state: 'REPORTED' }]) },
    operationalTask: { findMany: vi.fn().mockResolvedValue([]) },
    staffAttendanceClaim: { findMany: vi.fn().mockResolvedValue([]) },
    hospitalityOrder: { findMany: vi.fn().mockResolvedValue([]) },
    staffingVendorRequest: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe('CloseoutService', () => {
  it('denies closeout access when the token lacks the dedicated capability', async () => {
    const service = serviceFor({});
    await expect(service.overview({ ...identity, capabilities: ['operations:read'] }, eventId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects assigning follow-up outside the manager assignable roster', async () => {
    const service = serviceFor({});
    await expect(service.updateFollowup(identity, eventId, {
      sourceType: 'TASK', sourceId: closeoutId, state: 'FOLLOW_UP', ownerSubject: 'idp|other', dueAt: new Date(Date.now() + 86400000).toISOString(), reason: 'Complete the correction.',
    }, 'closeout-followup-idempotency-key')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps finalization blocked while a live source has no disposition', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      eventCloseout: {
        findFirst: vi.fn().mockResolvedValue({ id: closeoutId, state: 'OPEN' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: closeoutId, state: 'OPEN' }),
      },
      eventCloseoutFollowup: { findUnique: vi.fn().mockResolvedValue(null) },
      ...emptyExceptionQueries(),
    };
    const service = serviceFor(tx);
    await expect(service.finalize(identity, eventId, 'closeout-finalize-idempotency-key')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.eventCloseout.update).toBeUndefined();
    expect(tx.commandReceipt.create).not.toHaveBeenCalled();
  });

  it('keeps closeout open while a purchase order still needs approval or receiving', async () => {
    const purchaseOrderId = '60000000-0000-4000-8000-000000000001';
    const tx = {
      $queryRaw: vi.fn((parts: TemplateStringsArray) => Promise.resolve(parts.join(' ').includes('stock_purchase_orders')
        ? [{ id: purchaseOrderId, label: 'Purchase order awaiting approval, receipt, or quantity reconciliation' }]
        : [])),
      event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId: identity.venueIds[0], name: 'Fixture event' }) },
      eventCloseout: { findUnique: vi.fn().mockResolvedValue(null) },
      eventCloseoutFollowup: { findMany: vi.fn().mockResolvedValue([]) },
      eventPostCloseCorrection: { findMany: vi.fn().mockResolvedValue([]) },
      eventCloseoutAudit: { findMany: vi.fn().mockResolvedValue([]) },
      ...emptyExceptionQueries(),
    };
    const service = serviceFor(tx);
    const overview = await service.overview(identity, eventId);
    expect(overview.exceptions).toContainEqual(expect.objectContaining({ sourceType: 'STOCK_PURCHASE_ORDER', sourceId: purchaseOrderId }));
    expect(overview.canFinalize).toBe(false);
  });

  it('rechecks a live exception and finalizes only after an audited acceptance', async () => {
    const finalized = { id: closeoutId, state: 'CLOSED', finalizedBy: identity.subject };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      eventCloseout: {
        findFirst: vi.fn().mockResolvedValue({ id: closeoutId, state: 'OPEN' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: closeoutId, state: 'OPEN' }),
        update: vi.fn().mockResolvedValue(finalized),
      },
      eventCloseoutFollowup: { findUnique: vi.fn().mockResolvedValue({ state: 'ACCEPTED' }) },
      eventCloseoutAudit: { create: vi.fn() },
      ...emptyExceptionQueries(),
    };
    const service = serviceFor(tx);
    await expect(service.finalize(identity, eventId, 'closeout-finalize-idempotency-key')).resolves.toEqual(finalized);
    expect(tx.eventCloseout.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'CLOSED' }) }));
    expect(tx.eventCloseoutAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'finalized' }) }));
  });

  it('records a scoped append-only correction and audits it without changing source records', async () => {
    const correction = { id: closeoutId, eventId, sourceType: 'EVENT', sourceId: eventId, headline: 'Attendance total', correction: 'Updated count in closeout note.', reason: 'Supervisor verified paper tally.', createdBy: identity.subject };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      eventCloseout: { findFirst: vi.fn().mockResolvedValue({ id: closeoutId, state: 'CLOSED' }) },
      eventPostCloseCorrection: { create: vi.fn().mockResolvedValue(correction) },
      eventCloseoutAudit: { create: vi.fn() },
    };
    const service = serviceFor(tx);
    await expect(service.createCorrection(identity, eventId, {
      sourceType: 'EVENT', sourceId: eventId, headline: 'Attendance total', correction: 'Updated count in closeout note.', reason: 'Supervisor verified paper tally.',
    }, 'post-close-correction-idempotency-key')).resolves.toEqual(correction);
    expect(tx.eventPostCloseCorrection.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: tenantId, eventId, createdBy: identity.subject }) }));
    expect(tx.eventCloseoutAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'post_close_correction_recorded' }) }));
    expect(tx.commandReceipt.create).toHaveBeenCalled();
    expect(tx.eventCloseout).not.toHaveProperty('update');
  });

  it('does not allow correction entries before event closeout is finalized', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      eventCloseout: { findFirst: vi.fn().mockResolvedValue({ id: closeoutId, state: 'OPEN' }) },
      eventPostCloseCorrection: { create: vi.fn() },
      eventCloseoutAudit: { create: vi.fn() },
    };
    const service = serviceFor(tx);
    await expect(service.createCorrection(identity, eventId, {
      sourceType: 'EVENT', sourceId: eventId, headline: 'Correction', correction: 'Add the verified detail.', reason: 'The paper log was checked.',
    }, 'post-close-correction-idempotency-key')).rejects.toThrow('Post-close corrections can only be added to a closed event.');
    expect(tx.eventPostCloseCorrection.create).not.toHaveBeenCalled();
  });
});

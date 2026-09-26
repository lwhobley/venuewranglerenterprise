import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { type Identity } from '../src/auth';
import { PrismaService } from '../src/prisma.service';
import { VendorStaffingService } from '../src/vendor-staffing.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const venueId = '10000000-0000-4000-8000-000000000001';
const requestId = '50000000-0000-4000-8000-000000000001';
const manager: Identity = { subject: 'idp|manager', tenantId, capabilities: ['operations:read', 'operations:write'], venueIds: [venueId], eventIds: [eventId], locationIds: [], assignableUserIds: ['idp|vendor-a'] };
const vendor: Identity = { ...manager, subject: 'idp|vendor-a', capabilities: ['vendor:staffing', 'operations:read'], assignableUserIds: [] };

function serviceFor(tx: Record<string, unknown>) {
  const prisma = { withTenant: vi.fn((_identity, work) => work(tx)) } as unknown as PrismaService;
  return new VendorStaffingService(prisma, { deliver: vi.fn().mockResolvedValue(undefined) } as never);
}

describe('VendorStaffingService', () => {
  it('limits vendor reads to requests assigned to the authenticated vendor subject', async () => {
    const tx = {
      event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId }) },
      staffingVendorRequest: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await serviceFor(tx).list(vendor, eventId);
    expect(tx.staffingVendorRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: tenantId, eventId, vendorSubject: vendor.subject }) }));
  });

  it('rejects a response when the request belongs to a different vendor account', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      staffingVendorRequest: { findFirst: vi.fn().mockResolvedValue({ id: requestId, eventId, organizationId: tenantId, venueId, locationId: null, vendorSubject: 'idp|vendor-b', state: 'SENT' }), update: vi.fn() },
    };
    const service = serviceFor(tx);
    await expect(service.respond(vendor, eventId, requestId, { decision: 'COMMITTED', committedHeadcount: 1, reason: 'We can staff this shift.' }, 'vendor-response-idempotency-key')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.staffingVendorRequest.update).not.toHaveBeenCalled();
  });

  it('escalates only unanswered requests past their deadline and does not fill the gap', async () => {
    const overdue = { id: requestId, eventId, organizationId: tenantId, venueId, requesterSubject: manager.subject, state: 'SENT', responseDueAt: new Date('2020-01-01T00:00:00.000Z') };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId }) },
      staffingVendorRequest: { findMany: vi.fn().mockResolvedValue([overdue]), update: vi.fn().mockResolvedValue({ ...overdue, escalatedAt: new Date() }) },
      staffingVendorRequestAudit: { create: vi.fn().mockResolvedValue({}) },
      venueNotice: { create: vi.fn().mockResolvedValue({ id: 'notice-1', kind: 'vendor.deadline_escalated', recipientSubject: manager.subject }) },
    };
    const result = await serviceFor(tx).escalateOverdue(manager, eventId, 'vendor-escalate-overdue-01');
    expect(result).toEqual({ escalated: 1 });
    expect(tx.staffingVendorRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ escalatedAt: expect.any(Date) }) }));
    expect(tx.staffingVendorRequest.update.mock.calls[0][0].data).not.toHaveProperty('state');
  });

  it('rejects a manager request if the vendor identity is outside their assignment scope', async () => {
    const service = serviceFor({});
    await expect(service.create(manager, eventId, { demandId: requestId, vendorSubject: 'idp|vendor-b', requestedHeadcount: 2, responseDueAt: new Date(Date.now() + 3600000).toISOString() }, 'vendor-create-idempotency-key')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

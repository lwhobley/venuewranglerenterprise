import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../src/auth';
import { HospitalityService } from '../src/hospitality.service';
import type { PrismaService } from '../src/prisma.service';
import type { PushNotificationsService } from '../src/push-notifications.service';

const eventId = '00000000-0000-0000-0000-000000000001';
const venueId = '00000000-0000-0000-0000-000000000002';
const tenantId = '00000000-0000-0000-0000-000000000003';
const requester: Identity = { subject: 'requester-1', tenantId, capabilities: ['operations:read','operations:write','hospitality:order'], eventIds: [eventId], venueIds: [venueId], locationIds: [], assignableUserIds: ['kitchen-1'] };
const kitchen: Identity = { ...requester, subject: 'kitchen-1', capabilities: ['operations:read','hospitality:fulfill'], assignableUserIds: [] };

function harness(order: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'loc-1' }) },
    person: { findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }) },
    hospitalityOrder: {
      findFirst: vi.fn().mockResolvedValue({ id: 'order-1', organizationId: tenantId, eventId, venueId, locationId: null, requestedBy: requester.subject, assignedTo: 'kitchen-1', serviceAt: new Date(), state: 'SUBMITTED', instructions: '', rejectionReason: null, lines: [], ...order }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data, include }) => ({ id: 'order-1', ...data, lines: include ? data.lines.create : [] })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'order-1', ...order, ...data, eventId, venueId, locationId: null, requestedBy: requester.subject, assignedTo: 'kitchen-1', lines: [] })),
    },
    hospitalityOrderAudit: { create: vi.fn().mockResolvedValue({}) },
    hospitalityOrderLine: { update: vi.fn().mockResolvedValue({}) },
    hospitalityOrderFulfillment: { create: vi.fn().mockResolvedValue({}) },
    hospitalityDeliveryReceipt: { create: vi.fn().mockResolvedValue({ id: 'receipt-1' }) },
    userNotification: { create: vi.fn().mockResolvedValue({ id: 'notice-1', kind: 'hospitality.order.submitted', recipientSubject: 'kitchen-1' }) },
  };
  const prisma = { withTenant: vi.fn((_identity: Identity, action: (transaction: never) => Promise<unknown>) => action(tx as never)) } as unknown as PrismaService;
  const push = { deliver: vi.fn().mockResolvedValue(undefined) } as unknown as PushNotificationsService;
  return { service: new HospitalityService(prisma, push), tx, push };
}

describe('hospitality order lifecycle', () => {
  it('creates a scoped order with item snapshots, audit, idempotency, and an assigned-kitchen notice', async () => {
    const { service, tx, push } = harness();
    const order = await service.create(requester, eventId, {
      venueId, serviceAt: '2026-10-20T18:00:00Z', assignedTo: 'kitchen-1', instructions: 'Deliver to suite 14',
      lines: [{ itemName: 'House lemonade', quantity: 2, unit: 'pitcher', note: 'No ice' }],
    }, 'hospitality-create-key-0001');
    expect(order).toMatchObject({ id: 'order-1', state: 'SUBMITTED' });
    expect(tx.hospitalityOrder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requestedBy: requester.subject, assignedTo: 'kitchen-1', lines: { create: [expect.objectContaining({ itemName: 'House lemonade', quantity: 2 })] } }) }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'submitted', actorId: requester.subject }) }));
    expect(tx.userNotification.create).toHaveBeenCalled();
    expect(push.deliver).toHaveBeenCalled();
  });

  it('does not allow a requester role to advance kitchen fulfillment', async () => {
    const { service, tx } = harness();
    await expect(service.act(requester, eventId, '00000000-0000-0000-0000-000000000099', { action: 'accept' }, 'hospitality-action-key-0001'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('allows a scoped kitchen operator to accept and advance a submitted order', async () => {
    const { service, tx } = harness();
    const order = await service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', { action: 'accept' }, 'hospitality-action-key-0002');
    expect(order).toMatchObject({ state: 'ACCEPTED' });
    expect(tx.hospitalityOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: 'ACCEPTED', rejectionReason: null } }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'accept' }) }));
  });

  it('records a reasoned partial fulfillment, substitution, and immutable line records', async () => {
    const line = { id: 'line-1', itemName: 'Sparkling water', quantity: 5, fulfilledQuantity: 0, unit: 'case', fulfillments: [] };
    const { service, tx } = harness({ state: 'READY', lines: [line] });
    await service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'fulfill',
      reason: 'Two cases remain unavailable from the storeroom.',
      fulfillments: [{ lineId: 'line-1', quantity: 3, substituteItemName: 'Still water', reason: 'The sparkling stock is out.' }],
    }, 'hospitality-fulfillment-key-001');

    expect(tx.hospitalityOrderLine.update).not.toHaveBeenCalled();
    expect(tx.hospitalityOrderFulfillment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: tenantId, eventId, lineId: 'line-1', actorId: kitchen.subject,
        quantity: 3, substituteItemName: 'Still water', reason: 'The sparkling stock is out.',
      }),
    });
    expect(tx.hospitalityOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { state: 'PARTIALLY_DISTRIBUTED' },
    }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'partially_fulfilled' }),
    }));
  });

  it('rejects over-delivery before writing any fulfillment record', async () => {
    const line = { id: 'line-1', itemName: 'Sparkling water', quantity: 5, fulfilledQuantity: 4, unit: 'case', fulfillments: [] };
    const { service, tx } = harness({ state: 'PARTIALLY_DISTRIBUTED', lines: [line] });
    await expect(service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'fulfill', fulfillments: [{ lineId: 'line-1', quantity: 2 }],
    }, 'hospitality-fulfillment-key-002')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityOrderLine.update).not.toHaveBeenCalled();
    expect(tx.hospitalityOrderFulfillment.create).not.toHaveBeenCalled();
  });

  it('requires a reason when a fulfillment leaves quantities outstanding', async () => {
    const line = { id: 'line-1', itemName: 'Sparkling water', quantity: 5, fulfilledQuantity: 0, unit: 'case', fulfillments: [] };
    const { service, tx } = harness({ state: 'READY', lines: [line] });
    await expect(service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'fulfill', fulfillments: [{ lineId: 'line-1', quantity: 2 }],
    }, 'hospitality-fulfillment-key-003')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityOrderLine.update).not.toHaveBeenCalled();
  });

  it('prevents a kitchen user from acting on another assigned operator’s order', async () => {
    const { service, tx } = harness();
    const otherKitchen = { ...kitchen, subject: 'kitchen-2' };
    await expect(service.act(otherKitchen, eventId, '00000000-0000-0000-0000-000000000099', { action: 'accept' }, 'hospitality-action-key-0004'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('rejects skipping preparation states', async () => {
    const { service, tx } = harness();
    await expect(service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', { action: 'ready' }, 'hospitality-action-key-0005'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('requires and records an acknowledged pickup receipt', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Sparkling water', quantity: 2, fulfilledQuantity: 2, unit: 'case', fulfillments: [] }] });
    await service.act(requester, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiptNote: 'Suite 14 host stand', receiverAcknowledged: true,
    }, 'hospitality-pickup-key-0001');
    expect(tx.hospitalityDeliveryReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: tenantId, eventId, actorId: requester.subject, receivedByName: 'Jordan Lee',
      note: 'Suite 14 host stand', receiverAcknowledged: true,
    }) });
    expect(tx.hospitalityOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'PICKED_UP' }) }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'pickup' }) }));
  });

  it('does not record pickup while a line is still outstanding', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Sparkling water', quantity: 2, fulfilledQuantity: 1, unit: 'case', fulfillments: [] }] });
    await expect(service.act(requester, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiverAcknowledged: true,
    }, 'hospitality-pickup-key-0003')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityDeliveryReceipt.create).not.toHaveBeenCalled();
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('does not mark pickup without explicit in-person receiver acknowledgement', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Sparkling water', quantity: 2, fulfilledQuantity: 2, unit: 'case', fulfillments: [] }] });
    await expect(service.act(requester, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiverAcknowledged: false,
    }, 'hospitality-pickup-key-0002')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityDeliveryReceipt.create).not.toHaveBeenCalled();
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('requires a reason when kitchen rejects an order', async () => {
    const { service, tx } = harness();
    await expect(service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', { action: 'reject' }, 'hospitality-action-key-0003'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('keeps order queries inside the caller event scope', async () => {
    const { service, tx } = harness();
    await expect(service.list(requester, '00000000-0000-0000-0000-000000000098')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.hospitalityOrder.findMany).not.toHaveBeenCalled();
  });
});

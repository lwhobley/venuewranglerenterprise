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
const admin: Identity = { ...requester, subject: 'admin-1', capabilities: ['tenant:admin'], assignableUserIds: [] };

function harness(order: Record<string, unknown> = {}, orgSettings: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commandReceipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    event: { findFirst: vi.fn().mockResolvedValue({ id: eventId, venueId }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    venue: { findFirst: vi.fn().mockResolvedValue({ id: venueId, organizationId: tenantId }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'loc-1' }) },
    person: { findFirst: vi.fn().mockResolvedValue({ id: 'person-1' }) },
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: tenantId, hospitalityApprovalThreshold: null, hospitalityCurrencyCode: 'USD', ...orgSettings }),
      update: vi.fn().mockImplementation(({ data }) => ({ id: tenantId, hospitalityCurrencyCode: 'USD', ...orgSettings, ...data })),
    },
    hospitalityMenuItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'menu-1', ...data })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'menu-1', ...data })),
    },
    tenantSetupAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    hospitalityOrder: {
      findFirst: vi.fn().mockResolvedValue({ id: 'order-1', organizationId: tenantId, eventId, venueId, locationId: null, requestedBy: requester.subject, assignedTo: 'kitchen-1', serviceAt: new Date(), state: 'SUBMITTED', instructions: '', rejectionReason: null, lines: [], ...order }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data, include }) => ({ id: 'order-1', ...data, lines: include ? data.lines.create : [] })),
      update: vi.fn().mockImplementation(({ data }) => ({ id: 'order-1', ...order, ...data, eventId, venueId, locationId: null, requestedBy: requester.subject, assignedTo: 'kitchen-1', lines: [] })),
    },
    hospitalityOrderAudit: { create: vi.fn().mockResolvedValue({}) },
    hospitalityOrderLine: { update: vi.fn().mockResolvedValue({}) },
    hospitalityOrderFulfillment: { create: vi.fn().mockResolvedValue({ id: 'fulfillment-1' }) },
    hospitalityMenuRecipeLine: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    hospitalityDeliveryReceipt: { create: vi.fn().mockResolvedValue({ id: 'receipt-1' }) },
    hospitalityDeliveryEvidence: { findFirst: vi.fn().mockResolvedValue(null) },
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
      beoReference: '  BEO-2026-014  ',
      lines: [{ itemName: 'House lemonade', quantity: 2, unit: 'pitcher', note: 'No ice' }],
    }, 'hospitality-create-key-0001');
    expect(order).toMatchObject({ id: 'order-1', state: 'SUBMITTED' });
    expect(tx.hospitalityOrder.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requestedBy: requester.subject, assignedTo: 'kitchen-1', beoReference: 'BEO-2026-014', lines: { create: [expect.objectContaining({ itemName: 'House lemonade', quantity: 2 })] } }) }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'submitted', actorId: requester.subject }) }));
    expect(tx.userNotification.create).toHaveBeenCalled();
    expect(push.deliver).toHaveBeenCalled();
  });

  it('holds unpriced custom lines for manager approval when a monetary threshold is configured', async () => {
    const { service, tx } = harness({}, { hospitalityApprovalThreshold: 10 });
    const order = await service.create(requester, eventId, {
      venueId, serviceAt: '2026-10-20T18:00:00Z', assignedTo: 'kitchen-1',
      beoReference: 'BEO-99',
      lines: [{ itemName: 'Catering wrap tray', quantity: 12, unit: 'platter' }],
    }, 'hospitality-create-threshold-key');
    expect(order).toMatchObject({ id: 'order-1', state: 'AWAITING_APPROVAL' });
    expect(tx.hospitalityOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'AWAITING_APPROVAL' }),
    }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'submitted_awaiting_approval' }),
    }));
  });

  it('uses server-owned menu prices to calculate threshold and snapshots catalog data', async () => {
    const menuItemId = '00000000-0000-0000-0000-000000000010';
    const { service, tx } = harness({}, { hospitalityApprovalThreshold: 50, hospitalityCurrencyCode: 'USD' });
    tx.hospitalityMenuItem.findFirst.mockResolvedValueOnce({ id: menuItemId, name: 'Coffee urn', defaultUnit: 'urn', unitPrice: 30 });
    await service.create(requester, eventId, {
      venueId, serviceAt: '2026-10-20T18:00:00Z',
      lines: [{ menuItemId, itemName: 'tampered item name', quantity: 2, unit: 'each' }],
    }, 'hospitality-priced-menu-key');
    expect(tx.hospitalityOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: 'AWAITING_APPROVAL',
        lines: { create: [expect.objectContaining({ itemName: 'Coffee urn', unit: 'urn', unitPrice: 30, menuItemId })] },
      }),
    }));
  });

  it('allows an operations manager to approve an order in AWAITING_APPROVAL', async () => {
    const { service, tx } = harness({ state: 'AWAITING_APPROVAL' });
    const order = await service.act(requester, eventId, 'order-1', { action: 'approve' }, 'hospitality-approve-key');
    expect(order).toMatchObject({ state: 'SUBMITTED' });
    expect(tx.hospitalityOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { state: 'SUBMITTED' },
    }));
    expect(tx.hospitalityOrderAudit.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'approved' }),
    }));
  });

  it('prevents kitchen from accepting an order while awaiting approval', async () => {
    const { service, tx } = harness({ state: 'AWAITING_APPROVAL' });
    await expect(service.act(kitchen, eventId, 'order-1', { action: 'accept' }, 'hospitality-accept-unapproved'))
      .rejects.toThrow('Action accept is not valid while this order is awaiting approval.');
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
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
      receiverSignature: JSON.stringify([[{ x: 0.12, y: 0.72 }, { x: 0.35, y: 0.4 }, { x: 0.72, y: 0.68 }]]),
    }, 'hospitality-pickup-key-0001');
    expect(tx.hospitalityDeliveryReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: tenantId, eventId, actorId: requester.subject, receivedByName: 'Jordan Lee',
      note: 'Suite 14 host stand', receiverAcknowledged: true,
      receiverSignature: [[{ x: 0.12, y: 0.72 }, { x: 0.35, y: 0.4 }, { x: 0.72, y: 0.68 }]],
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

  it('requires a captured receiver signature for pickup', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Sparkling water', quantity: 2, fulfilledQuantity: 2, unit: 'case', fulfillments: [] }] });
    await expect(service.act(requester, eventId, '00000000-0000-0000-0000-000000000099', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiverAcknowledged: true,
    }, 'hospitality-pickup-key-0004')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityDeliveryReceipt.create).not.toHaveBeenCalled();
  });

  it('attaches only a verified receiver photo uploaded by the pickup actor', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Water', quantity: 1, fulfilledQuantity: 1, unit: 'case', fulfillments: [] }] });
    tx.hospitalityDeliveryEvidence.findFirst.mockResolvedValue({ id: 'photo-1' });
    await service.act(requester, eventId, 'order-1', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiverAcknowledged: true,
      receiverSignature: JSON.stringify([[{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }]]),
      receiverPhotoEvidenceId: 'photo-1',
    }, 'hospitality-pickup-photo-key-01');
    expect(tx.hospitalityDeliveryEvidence.findFirst).toHaveBeenCalledWith({ where: {
      id: 'photo-1', orderId: 'order-1', eventId, organizationId: tenantId,
      uploadedBy: requester.subject, status: 'READY',
    } });
    expect(tx.hospitalityDeliveryReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ photoEvidenceId: 'photo-1' }) });
  });

  it('rejects receipt photo evidence that has not completed upload verification', async () => {
    const { service, tx } = harness({ state: 'DISTRIBUTED', lines: [{ id: 'line-1', itemName: 'Water', quantity: 1, fulfilledQuantity: 1, unit: 'case', fulfillments: [] }] });
    await expect(service.act(requester, eventId, 'order-1', {
      action: 'pickup', receivedByName: 'Jordan Lee', receiverAcknowledged: true,
      receiverSignature: JSON.stringify([[{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }]]),
      receiverPhotoEvidenceId: 'photo-pending',
    }, 'hospitality-pickup-photo-key-02')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityDeliveryReceipt.create).not.toHaveBeenCalled();
  });

  it('requires a reason when kitchen rejects an order', async () => {
    const { service, tx } = harness();
    await expect(service.act(kitchen, eventId, '00000000-0000-0000-0000-000000000099', { action: 'reject' }, 'hospitality-action-key-0003'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('saves an audited recipe scoped to an active stock item at the same venue', async () => {
    const { service, tx } = harness();
    tx.hospitalityMenuItem.findFirst.mockResolvedValueOnce({ id: 'menu-1', name: 'Coffee urn', defaultUnit: 'urn' });
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'stock-1' }]);
    const result = await service.setMenuRecipe(requester, venueId, 'menu-1', {
      lines: [{ stockItemId: 'stock-1', quantityPerMenuUnit: 0.125 }],
    }, 'hospitality-recipe-set-key-001');
    expect(result).toMatchObject({ menuItem: { id: 'menu-1' } });
    expect(tx.hospitalityMenuRecipeLine.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: tenantId, venueId, menuItemId: 'menu-1' },
    });
    expect(tx.hospitalityMenuRecipeLine.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: tenantId, venueId, menuItemId: 'menu-1', stockItemId: 'stock-1', quantityPerMenuUnit: expect.anything() }],
    });
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resourceType: 'hospitality_menu_recipe', changedFields: ['recipe'] }),
    }));
  });

  it('rejects recipe ingredients from another venue', async () => {
    const { service, tx } = harness();
    tx.hospitalityMenuItem.findFirst.mockResolvedValueOnce({ id: 'menu-1', name: 'Coffee urn' });
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.setMenuRecipe(requester, venueId, 'menu-1', {
      lines: [{ stockItemId: 'foreign-stock', quantityPerMenuUnit: 0.125 }],
    }, 'hospitality-recipe-cross-venue')).rejects.toThrow('Every recipe ingredient must be an active stock item at this venue.');
    expect(tx.hospitalityMenuRecipeLine.createMany).not.toHaveBeenCalled();
  });

  it('does not expose recipe stock levels to hospitality fulfillment-only users', async () => {
    const { service, tx } = harness();
    const fulfillmentOnly = { ...kitchen, capabilities: ['hospitality:fulfill'] };
    await expect(service.getMenuRecipe(fulfillmentOnly, venueId, 'menu-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.hospitalityMenuItem.findFirst).not.toHaveBeenCalled();
  });

  it('depletes recipe ingredients atomically and writes an immutable stock movement for fulfillment', async () => {
    const line = { id: 'line-1', menuItemId: 'menu-1', itemName: 'Coffee urn', quantity: 2, fulfilledQuantity: 0, unit: 'urn', fulfillments: [] };
    const { service, tx } = harness({ state: 'READY', lines: [line] });
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ stockItemId: 'stock-1', stockItemName: 'Ground coffee', stockUnit: 'kg', quantityPerMenuUnit: '0.125000', active: true }])
      .mockResolvedValueOnce([{ id: 'stock-1' }]);
    await service.act(kitchen, eventId, 'order-1', {
      action: 'fulfill', fulfillments: [{ lineId: 'line-1', quantity: 2 }],
    }, 'hospitality-recipe-fulfill-key');
    expect(tx.hospitalityOrderFulfillment.create).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('HOSPITALITY_CONSUMPTION');
  });

  it('blocks recipe fulfillment when ingredient stock is insufficient', async () => {
    const line = { id: 'line-1', menuItemId: 'menu-1', itemName: 'Coffee urn', quantity: 2, fulfilledQuantity: 0, unit: 'urn', fulfillments: [] };
    const { service, tx } = harness({ state: 'READY', lines: [line] });
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ stockItemId: 'stock-1', stockItemName: 'Ground coffee', stockUnit: 'kg', quantityPerMenuUnit: '0.125000', active: true }])
      .mockResolvedValueOnce([]);
    await expect(service.act(kitchen, eventId, 'order-1', {
      action: 'fulfill', fulfillments: [{ lineId: 'line-1', quantity: 2 }],
    }, 'hospitality-recipe-insufficient-stock')).rejects.toThrow('Insufficient Ground coffee (kg)');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.hospitalityOrder.update).not.toHaveBeenCalled();
  });

  it('keeps order queries inside the caller event scope', async () => {
    const { service, tx } = harness();
    await expect(service.list(requester, '00000000-0000-0000-0000-000000000098')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.hospitalityOrder.findMany).not.toHaveBeenCalled();
  });

  it('creates and lists venue menu catalog items with audit history', async () => {
    const { service, tx } = harness();
    const item = await service.createMenuItem(admin, {
      venueId, name: 'Premium Coffee Urn', description: 'Fresh brew', category: 'Beverage', unit: 'urn', unitPrice: 32.5,
    }, 'menu-item-create-key-01');
    expect(item).toMatchObject({ id: 'menu-1', name: 'Premium Coffee Urn' });
    expect(tx.hospitalityMenuItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Premium Coffee Urn', venueId, category: 'Beverage', defaultUnit: 'urn', unitPrice: 32.5 }),
    }));
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'created', resourceType: 'hospitality_menu_item' }),
    }));

    await service.listMenuItems(requester, venueId);
    expect(tx.hospitalityMenuItem.findMany).toHaveBeenCalledWith({
      where: { organizationId: tenantId, venueId, active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  });

  it('rejects duplicate menu item names in the same venue', async () => {
    const { service, tx } = harness();
    tx.hospitalityMenuItem.findFirst.mockResolvedValueOnce({ id: 'menu-existing' });
    await expect(service.createMenuItem(admin, {
      venueId, name: 'Premium Coffee Urn', unitPrice: 0,
    }, 'menu-item-create-dup-key')).rejects.toThrow('A menu item with this name already exists in this venue.');
  });

  it('manages tenant hospitality approval threshold policy', async () => {
    const { service, tx } = harness({}, { hospitalityApprovalThreshold: 25 });
    const current = await service.getHospitalityPolicy(admin);
    expect(current).toEqual({ hospitalityApprovalThreshold: 25, hospitalityCurrencyCode: 'USD' });

    const updated = await service.updateHospitalityPolicy(admin, { hospitalityApprovalThreshold: 50, hospitalityCurrencyCode: 'CAD' }, 'policy-update-key');
    expect(updated).toEqual({ hospitalityApprovalThreshold: 50, hospitalityCurrencyCode: 'CAD' });
    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: tenantId },
      data: { hospitalityApprovalThreshold: 50, hospitalityCurrencyCode: 'CAD' },
    }));
    expect(tx.tenantSetupAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'updated', resourceType: 'hospitality_policy' }),
    }));
  });
});

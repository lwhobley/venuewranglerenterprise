import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, HospitalityOrderState } from '@prisma/client';
import { createHash } from 'node:crypto';
import { assertCapability, assertScope, type Identity } from './auth';
import { PrismaService } from './prisma.service';
import { CreateHospitalityOrderDto, HospitalityOrderActionDto } from './hospitality.dto';
import { PushNotificationsService } from './push-notifications.service';

@Injectable()
export class HospitalityService {
  private readonly logger = new Logger(HospitalityService.name);
  constructor(private readonly prisma: PrismaService, private readonly push: PushNotificationsService) {}

  async list(identity: Identity, eventId: string) {
    this.assertCanView(identity, eventId);
    return this.prisma.withTenant(identity, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, this.readCapability(identity), eventId, event.venueId);
      return tx.hospitalityOrder.findMany({
        where: {
          organizationId: identity.tenantId, eventId,
          ...(!identity.capabilities.includes('hospitality:fulfill') && !identity.capabilities.includes('operations:write') && !identity.capabilities.includes('tenant:admin') ? { requestedBy: identity.subject } : {}),
          ...(identity.capabilities.includes('hospitality:fulfill') && !identity.capabilities.includes('tenant:admin') ? { AND: [{ OR: [{ assignedTo: null }, { assignedTo: identity.subject }] }] } : {}),
          ...(!identity.capabilities.includes('tenant:admin') ? {
            venueId: { in: identity.venueIds },
            OR: [{ locationId: null }, { locationId: { in: identity.locationIds } }],
          } : {}),
        },
        include: { lines: { orderBy: { itemName: 'asc' }, include: { fulfillments: { orderBy: { createdAt: 'asc' } } } } },
        orderBy: [{ serviceAt: 'asc' }, { createdAt: 'desc' }],
      });
    });
  }

  async create(identity: Identity, eventId: string, dto: CreateHospitalityOrderDto, key: string) {
    const capability = this.orderCapability(identity);
    assertScope(identity, capability, eventId, dto.venueId, dto.locationId);
    const input = { eventId, ...dto, lines: dto.lines.map(line => ({ ...line, itemName: line.itemName.trim(), unit: line.unit.trim(), note: line.note?.trim() ?? '' })) };
    const result = await this.command(identity, key, 'hospitality.order.create', input, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in this venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Service location not found.');
      if (dto.assignedTo) {
        if (!identity.capabilities.includes('hospitality:fulfill') && !identity.capabilities.includes('operations:write') && !identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('Only an operations manager can route an order to a kitchen operator.');
        if (dto.assignedTo !== identity.subject && !identity.assignableUserIds.includes(dto.assignedTo)) throw new ForbiddenException('The selected kitchen operator is outside your assignment scope.');
        const person = await tx.person.findFirst({ where: { organizationId: identity.tenantId, externalSubject: dto.assignedTo, active: true }, select: { id: true } });
        if (!person) throw new NotFoundException('The selected kitchen operator is not an active tenant user.');
      }
      const order = await tx.hospitalityOrder.create({ data: {
        organizationId: identity.tenantId, venueId: dto.venueId, eventId, locationId: dto.locationId,
        requestedBy: identity.subject, assignedTo: dto.assignedTo, serviceAt: new Date(dto.serviceAt),
        instructions: dto.instructions?.trim() ?? '', state: 'SUBMITTED',
        lines: { create: input.lines },
      }, include: { lines: { orderBy: { itemName: 'asc' }, include: { fulfillments: { orderBy: { createdAt: 'asc' } } } } } });
      await this.audit(tx, identity, order.id, 'submitted', null, order);
      const notification = dto.assignedTo && dto.assignedTo !== identity.subject
        ? await this.notification(tx, identity, order, dto.assignedTo, 'hospitality.order.submitted', 'New hospitality order') : null;
      return { order, notification };
    });
    this.deliver(identity, result.notification);
    return result.order;
  }

  async act(identity: Identity, eventId: string, orderId: string, dto: HospitalityOrderActionDto, key: string) {
    const result = await this.command(identity, key, `hospitality.order.${dto.action}`, { eventId, orderId, ...dto }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hospitality-order:${identity.tenantId}:${orderId}`}, 0))`;
      const current = await tx.hospitalityOrder.findFirst({ where: { id: orderId, eventId, organizationId: identity.tenantId }, include: { lines: { orderBy: { itemName: 'asc' }, include: { fulfillments: { orderBy: { createdAt: 'asc' } } } } } });
      if (!current) throw new NotFoundException('Hospitality order not found.');
      if (identity.capabilities.includes('hospitality:fulfill') && current.assignedTo && current.assignedTo !== identity.subject && !identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('This order is assigned to another kitchen operator.');
      const mustFulfill = ['accept', 'preparing', 'ready', 'distribute', 'fulfill', 'reject'].includes(dto.action);
      if (mustFulfill) {
        const fulfillCapability = identity.capabilities.includes('hospitality:fulfill') ? 'hospitality:fulfill' : 'tenant:admin';
        assertCapability(identity, fulfillCapability);
        assertScope(identity, fulfillCapability, eventId, current.venueId, current.locationId ?? undefined);
      } else {
        if (dto.action === 'pickup' && identity.subject !== current.requestedBy && !identity.capabilities.includes('hospitality:fulfill') && !identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('Only the requester or kitchen team can confirm pickup.');
        if (dto.action === 'cancel' && identity.subject !== current.requestedBy && !identity.capabilities.includes('hospitality:fulfill') && !identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('Only the requester or kitchen team can cancel this order.');
        const capability = identity.subject === current.requestedBy ? this.orderCapability(identity) : identity.capabilities.includes('tenant:admin') ? 'tenant:admin' : 'hospitality:fulfill';
        assertScope(identity, capability, eventId, current.venueId, current.locationId ?? undefined);
      }
      if (dto.action === 'fulfill' || dto.action === 'distribute') {
        const input = dto.action === 'fulfill'
            ? dto
            : {
                reason: dto.reason,
                fulfillments: current.lines
                    .map(line => ({ lineId: line.id, quantity: Number(line.quantity) - Number(line.fulfilledQuantity) }))
                    .filter(line => line.quantity > 0),
              };
        const updated = await this.recordFulfillment(tx, identity, current, input);
        const recipient = identity.subject === current.requestedBy ? current.assignedTo : current.requestedBy;
        const notification = await this.notification(
            tx,
            identity,
            updated,
            recipient,
            'hospitality.order.fulfillment',
            updated.state === 'DISTRIBUTED' ? 'Hospitality order fully fulfilled' : 'Hospitality order partially fulfilled',
        );
        return { order: updated, notification };
      }
      const nextState = this.nextState(current.state, dto.action, identity.subject === current.requestedBy, Boolean(identity.capabilities.includes('hospitality:fulfill') || identity.capabilities.includes('tenant:admin')));
      if (['reject', 'cancel'].includes(dto.action) && !dto.reason?.trim()) throw new ConflictException('A reason is required to reject or cancel an order.');
      const updated = await tx.hospitalityOrder.update({ where: { id: orderId }, data: {
        state: nextState,
        rejectionReason: dto.action === 'reject' ? dto.reason!.trim() : dto.action === 'cancel' ? dto.reason!.trim() : current.rejectionReason,
      }, include: { lines: { orderBy: { itemName: 'asc' }, include: { fulfillments: { orderBy: { createdAt: 'asc' } } } } } });
      await this.audit(tx, identity, orderId, dto.action, current, updated, dto.reason?.trim());
      const recipient = identity.subject === current.requestedBy ? current.assignedTo : current.requestedBy;
      const title = dto.action === 'ready' ? 'Hospitality order ready' : dto.action === 'reject' ? 'Hospitality order rejected' : dto.action === 'cancel' ? 'Hospitality order cancelled' : `Hospitality order ${nextState.toLowerCase().replace('_', ' ')}`;
      const notification = await this.notification(tx, identity, updated, recipient, `hospitality.order.${dto.action}`, title);
      return { order: updated, notification };
    });
    this.deliver(identity, result.notification);
    return result.order;
  }

  private nextState(state: HospitalityOrderState, action: HospitalityOrderActionDto['action'], isRequester: boolean, canFulfill: boolean): HospitalityOrderState {
    const transitions: Record<string, HospitalityOrderState> = {
      'SUBMITTED:accept': 'ACCEPTED', 'SUBMITTED:reject': 'REJECTED', 'SUBMITTED:cancel': 'CANCELLED',
      'ACCEPTED:preparing': 'PREPARING', 'ACCEPTED:cancel': 'CANCELLED',
      'PREPARING:ready': 'READY', 'PREPARING:cancel': 'CANCELLED',
      'READY:distribute': 'DISTRIBUTED', 'READY:cancel': 'CANCELLED',
      'PARTIALLY_DISTRIBUTED:distribute': 'DISTRIBUTED',
      'DISTRIBUTED:pickup': 'PICKED_UP',
    };
    const next = transitions[`${state}:${action}`];
    if (!next) throw new ConflictException(`Action ${action} is not valid while this order is ${state.toLowerCase().replace('_', ' ')}.`);
    if (action === 'cancel' && ((!isRequester && !canFulfill) || (isRequester && state !== 'SUBMITTED'))) throw new ForbiddenException('Requesters can cancel only before kitchen acceptance; kitchen staff may cancel later with a reason.');
    if (action === 'pickup' && !isRequester && !canFulfill) throw new ForbiddenException('Only the requester or kitchen team can confirm pickup.');
    return next;
  }

  private async recordFulfillment(
      tx: Prisma.TransactionClient,
      identity: Identity,
      current: Prisma.HospitalityOrderGetPayload<{ include: { lines: { include: { fulfillments: true } } } }>,
      dto: Pick<HospitalityOrderActionDto, 'fulfillments' | 'reason'>,
  ) {
    if (!['READY', 'PARTIALLY_DISTRIBUTED'].includes(current.state)) {
      throw new ConflictException('Items can be fulfilled only after the order is ready.');
    }
    const entries = dto.fulfillments;
    if (!entries?.length) throw new ConflictException('Enter at least one delivered item quantity.');
    const lines = new Map(current.lines.map(line => [line.id, line]));
    const seen = new Set<string>();
    const normalized = entries.map(entry => {
      if (seen.has(entry.lineId)) throw new ConflictException('Each order line can appear only once in a fulfillment batch.');
      seen.add(entry.lineId);
      const line = lines.get(entry.lineId);
      if (!line) throw new ConflictException('A fulfillment line does not belong to this order.');
      const fulfilledMilli = Math.round(Number(line.fulfilledQuantity) * 1000);
      const requestedMilli = Math.round(Number(line.quantity) * 1000);
      const batchMilli = Math.round(entry.quantity * 1000);
      if (batchMilli <= 0 || fulfilledMilli + batchMilli > requestedMilli) {
        throw new ConflictException(`Delivered quantity for ${line.itemName} must be positive and cannot exceed the remaining ${((requestedMilli - fulfilledMilli) / 1000).toFixed(3)} ${line.unit}.`);
      }
      const substituteItemName = entry.substituteItemName?.trim() || null;
      const reason = entry.reason?.trim() || null;
      if (substituteItemName && (!reason || reason.length < 3)) {
        throw new ConflictException(`A reason is required when ${line.itemName} is substituted.`);
      }
      return { line, batchMilli, fulfilledMilli, requestedMilli, substituteItemName, reason };
    });
    const deliveredMilli = normalized.reduce((total, row) => total + row.batchMilli, 0);
    if (deliveredMilli === 0) throw new ConflictException('At least one delivered quantity is required.');
    const complete = current.lines.every(line => {
      const row = normalized.find(item => item.line.id === line.id);
      const fulfilledMilli = Math.round(Number(line.fulfilledQuantity) * 1000) + (row?.batchMilli ?? 0);
      return fulfilledMilli >= Math.round(Number(line.quantity) * 1000);
    });
    if (!complete && (!dto.reason?.trim() || dto.reason.trim().length < 3)) {
      throw new ConflictException('Explain why this fulfillment is partial so the remaining items can be followed up.');
    }

    for (const row of normalized) {
      await tx.hospitalityOrderFulfillment.create({
        data: {
          organizationId: identity.tenantId,
          eventId: current.eventId,
          orderId: current.id,
          lineId: row.line.id,
          actorId: identity.subject,
          quantity: row.batchMilli / 1000,
          substituteItemName: row.substituteItemName,
          reason: row.reason ?? (complete ? null : dto.reason!.trim()),
        },
      });
    }
    const updated = await tx.hospitalityOrder.update({
      where: { id: current.id },
      data: { state: complete ? 'DISTRIBUTED' : 'PARTIALLY_DISTRIBUTED' },
      include: { lines: { orderBy: { itemName: 'asc' }, include: { fulfillments: { orderBy: { createdAt: 'asc' } } } } },
    });
    await this.audit(tx, identity, current.id, complete ? 'fulfilled' : 'partially_fulfilled', current, updated, dto.reason?.trim());
    return updated;
  }

  private assertCanView(identity: Identity, eventId: string) {
    if (!identity.capabilities.some(capability => ['hospitality:order', 'hospitality:fulfill', 'operations:write', 'tenant:admin'].includes(capability))) throw new ForbiddenException('Hospitality order access is required.');
    if (!identity.eventIds.includes(eventId) && !identity.capabilities.includes('tenant:admin')) throw new ForbiddenException('This event is outside your assigned scope.');
  }
  private readCapability(identity: Identity) {
    return identity.capabilities.includes('hospitality:fulfill') ? 'hospitality:fulfill' : identity.capabilities.includes('hospitality:order') ? 'hospitality:order' : identity.capabilities.includes('operations:write') ? 'operations:write' : 'tenant:admin';
  }
  private orderCapability(identity: Identity) {
    if (identity.capabilities.includes('hospitality:order')) return 'hospitality:order';
    if (identity.capabilities.includes('operations:write')) return 'operations:write';
    if (identity.capabilities.includes('tenant:admin')) return 'tenant:admin';
    throw new ForbiddenException('Hospitality order permission is required.');
  }

  private audit(tx: Prisma.TransactionClient, identity: Identity, orderId: string, action: string, before: unknown, after: unknown, reason?: string) {
    return tx.hospitalityOrderAudit.create({ data: {
      organizationId: identity.tenantId, orderId, actorId: identity.subject, action,
      before: before == null ? undefined : JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
      after: after == null ? undefined : JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue, reason,
    } });
  }
  private notification(tx: Prisma.TransactionClient, identity: Identity, order: { id: string; eventId: string }, recipient: string | null, kind: string, title: string) {
    if (!recipient || recipient === identity.subject) return Promise.resolve(null);
    return tx.userNotification.create({ data: {
      organizationId: identity.tenantId, eventId: order.eventId, hospitalityOrderId: order.id, recipientSubject: recipient, kind, title,
      body: `Review hospitality order ${order.id} in the event service queue.`,
    } });
  }
  private deliver(identity: Identity, notification: { id: string; kind: string; recipientSubject: string } | null) {
    if (notification) void this.push.deliver({ ...identity, subject: notification.recipientSubject }, notification).catch(() => this.logger.warn('Hospitality notification push failed after the durable notification was saved.'));
  }

  private async command<T>(identity: Identity, key: string, action: string, input: unknown, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, actor: identity.subject, input })).digest('hex');
    return this.prisma.withTenant(identity, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const prior = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.');
        return prior.response as T;
      }
      const response = await work(tx);
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: JSON.parse(JSON.stringify(response)) as Prisma.InputJsonValue } });
      return response;
    });
  }
}

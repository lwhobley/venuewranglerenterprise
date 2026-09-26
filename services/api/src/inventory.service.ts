import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { assertCapability, assertScope, assertTenantAdmin, Identity } from './auth';
import { PrismaService } from './prisma.service';
import { ApproveStockCountDto, CancelStockTransferDto, CloseStockPurchaseOrderShortDto, CreateStockItemDto, CreateStockPurchaseOrderDto, CreateStockTransferDto, ReceiveStockPurchaseOrderDto, ReceiveStockTransferDto, RecordStockCountDto, StartStockCountDto } from './inventory.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listItems(identity: Identity, venueId: string, locationId?: string) {
    assertCapability(identity, 'operations:read');
    if (!identity.capabilities.includes('tenant:admin') && !identity.venueIds.includes(venueId)) throw new NotFoundException('Inventory not found.');
    if (locationId && !identity.capabilities.includes('tenant:admin') && !identity.locationIds.includes(locationId)) throw new NotFoundException('Inventory not found.');
    return this.prisma.withTenant(identity, async tx => tx.$queryRaw`
      SELECT id, venue_id AS "venueId", location_id AS "locationId", sku, name, unit, on_hand AS "onHand", active
      FROM stock_items WHERE organization_id = ${identity.tenantId}::uuid AND venue_id = ${venueId}::uuid
      AND location_id IS NOT DISTINCT FROM ${locationId ?? null}::uuid ORDER BY name`);
  }

  async listVenueItems(identity: Identity, venueId: string) {
    if (!identity.capabilities.includes('tenant:admin') &&
        (!identity.capabilities.includes('operations:write') || !identity.venueIds.includes(venueId))) {
      throw new ForbiddenException('Venue inventory administration access is required.');
    }
    return this.prisma.withTenant(identity, async tx => {
      const venue = await tx.venue.findFirst({ where: { id: venueId, organizationId: identity.tenantId }, select: { id: true } });
      if (!venue) throw new NotFoundException('Venue not found.');
      return tx.$queryRaw`
        SELECT i.id, i.venue_id AS "venueId", i.location_id AS "locationId", l.name AS "locationName",
          i.sku, i.name, i.unit, i.on_hand AS "onHand", i.active
        FROM stock_items i
        LEFT JOIN locations l ON l.id = i.location_id AND l.venue_id = i.venue_id AND l.organization_id = i.organization_id
        WHERE i.organization_id = ${identity.tenantId}::uuid AND i.venue_id = ${venueId}::uuid
        ORDER BY i.active DESC, i.name, i.sku`;
    });
  }

  async createItem(identity: Identity, dto: CreateStockItemDto, key: string) {
    assertTenantAdmin(identity);
    return this.command(identity, key, 'stock-item.create', dto, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-item:${identity.tenantId}:${dto.venueId}:${dto.locationId ?? 'venue'}:${dto.sku.trim().toLowerCase()}`}, 0))`;
      const venue = await tx.venue.findFirst({ where: { id: dto.venueId, organizationId: identity.tenantId } });
      if (!venue) throw new NotFoundException('Venue not found.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found in this venue.');
      const existing = await tx.$queryRaw`SELECT id FROM stock_items WHERE organization_id=${identity.tenantId}::uuid AND venue_id=${dto.venueId}::uuid AND location_id IS NOT DISTINCT FROM ${dto.locationId ?? null}::uuid AND lower(sku)=lower(${dto.sku.trim()}) LIMIT 1`;
      if ((existing as unknown[]).length) throw new ConflictException('That SKU already exists at this venue or location.');
      const rows = await tx.$queryRaw`
        INSERT INTO stock_items(organization_id, venue_id, location_id, sku, name, unit)
        VALUES (${identity.tenantId}::uuid, ${dto.venueId}::uuid, ${dto.locationId ?? null}::uuid, ${dto.sku.trim()}, ${dto.name.trim()}, ${dto.unit.trim()})
        RETURNING id, venue_id AS "venueId", location_id AS "locationId", sku, name, unit, on_hand AS "onHand", active`;
      return (rows as Record<string, unknown>[])[0];
    });
  }

  async listCounts(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.prisma.withTenant(identity, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:read', eventId, event.venueId);
      return tx.$queryRaw`
        SELECT c.id, c.event_id AS "eventId", c.venue_id AS "venueId", c.location_id AS "locationId", c.state,
          c.counter_id AS "counterId", c.reviewer_id AS "reviewerId", c.reason, c.created_at AS "createdAt",
          c.submitted_at AS "submittedAt", c.approved_at AS "approvedAt",
          COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'itemId', i.id, 'sku', i.sku, 'name', i.name, 'unit', i.unit,
            'countedQuantity', l.counted_quantity, 'expectedQuantity', CASE WHEN c.state IN ('SUBMITTED','APPROVED') THEN l.expected_quantity ELSE NULL END,
            'note', l.note) ORDER BY i.name) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS lines
        FROM stock_counts c LEFT JOIN stock_count_lines l ON l.count_id=c.id AND l.organization_id=c.organization_id
        LEFT JOIN stock_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
        WHERE c.organization_id=${identity.tenantId}::uuid AND c.event_id=${eventId}::uuid
          AND (${identity.capabilities.includes('tenant:admin')} OR (c.venue_id = ANY(${identity.venueIds}::uuid[]) AND (c.location_id IS NULL OR c.location_id = ANY(${identity.locationIds}::uuid[]))))
        GROUP BY c.id ORDER BY c.created_at DESC`;
    });
  }

  async startCount(identity: Identity, eventId: string, dto: StartStockCountDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    return this.command(identity, key, 'stock-count.start', { eventId, ...dto }, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in this venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Location not found.');
      const countRows = await tx.$queryRaw`INSERT INTO stock_counts(organization_id, venue_id, event_id, location_id, counter_id)
        VALUES (${identity.tenantId}::uuid, ${dto.venueId}::uuid, ${eventId}::uuid, ${dto.locationId ?? null}::uuid, ${identity.subject}) RETURNING id`;
      const countId = (countRows as { id: string }[])[0].id;
      await tx.$executeRaw`INSERT INTO stock_count_lines(organization_id, count_id, item_id, expected_quantity)
        SELECT organization_id, ${countId}::uuid, id, on_hand FROM stock_items WHERE organization_id=${identity.tenantId}::uuid
        AND venue_id=${dto.venueId}::uuid AND active AND location_id IS NOT DISTINCT FROM ${dto.locationId ?? null}::uuid`;
      const lineCount = await tx.$queryRaw`SELECT count(*)::int AS total FROM stock_count_lines WHERE count_id=${countId}::uuid AND organization_id=${identity.tenantId}::uuid` as { total: number }[];
      if (!lineCount[0]?.total) throw new ConflictException('Add at least one active stock item before starting a count.');
      const count = { id: countId, eventId, venueId: dto.venueId, locationId: dto.locationId ?? null, state: 'IN_PROGRESS' };
      await this.audit(tx, identity, countId, 'started', null, count);
      return count;
    });
  }

  async recordCount(identity: Identity, eventId: string, countId: string, lineId: string, dto: RecordStockCountDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-count.record', { eventId, countId, lineId, ...dto }, async tx => {
      const rows = await tx.$queryRaw`SELECT c.venue_id AS "venueId", c.location_id AS "locationId", c.state, c.counter_id AS "counterId", l.id
        FROM stock_counts c JOIN stock_count_lines l ON l.count_id=c.id AND l.organization_id=c.organization_id
        WHERE c.id=${countId}::uuid AND l.id=${lineId}::uuid AND c.event_id=${eventId}::uuid AND c.organization_id=${identity.tenantId}::uuid FOR UPDATE OF c` as { venueId: string; locationId: string | null; state: string; counterId: string; id: string }[];
      const current = rows[0];
      if (!current) throw new NotFoundException('Count line not found.');
      assertScope(identity, 'operations:write', eventId, current.venueId, current.locationId ?? undefined);
      if (current.counterId !== identity.subject || current.state !== 'IN_PROGRESS') throw new ConflictException('Only the original counter can enter quantities while the count is in progress.');
      const before = await tx.$queryRaw`SELECT counted_quantity AS "countedQuantity", note FROM stock_count_lines WHERE id=${lineId}::uuid`;
      await tx.$executeRaw`UPDATE stock_count_lines SET counted_quantity=${dto.quantity}, note=${dto.note ?? null}, counted_at=now() WHERE id=${lineId}::uuid`;
      await this.audit(tx, identity, countId, 'line_counted', before, { lineId, countedQuantity: dto.quantity, note: dto.note ?? null });
      return { lineId, countedQuantity: dto.quantity, note: dto.note ?? null };
    });
  }

  async submit(identity: Identity, eventId: string, countId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-count.submit', { eventId, countId }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId", location_id AS "locationId", state, counter_id AS "counterId" FROM stock_counts WHERE id=${countId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string; counterId: string }[];
      const count = rows[0];
      if (!count) throw new NotFoundException('Count not found.');
      assertScope(identity, 'operations:write', eventId, count.venueId, count.locationId ?? undefined);
      if (count.counterId !== identity.subject || count.state !== 'IN_PROGRESS') throw new ConflictException('Only the counter can submit an in-progress count.');
      const missing = await tx.$queryRaw`SELECT id FROM stock_count_lines WHERE count_id=${countId}::uuid AND organization_id=${identity.tenantId}::uuid AND counted_quantity IS NULL LIMIT 1`;
      if ((missing as unknown[]).length) throw new ConflictException('Enter a quantity for every item before submitting.');
      await tx.$executeRaw`UPDATE stock_counts SET state='SUBMITTED', submitted_at=now() WHERE id=${countId}::uuid`;
      await this.audit(tx, identity, countId, 'submitted', { state: 'IN_PROGRESS' }, { state: 'SUBMITTED' });
      return { id: countId, state: 'SUBMITTED' };
    });
  }

  async approve(identity: Identity, eventId: string, countId: string, dto: ApproveStockCountDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-count.approve', { eventId, countId, ...dto }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId", location_id AS "locationId", state, counter_id AS "counterId" FROM stock_counts WHERE id=${countId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string; counterId: string }[];
      const count = rows[0];
      if (!count) throw new NotFoundException('Count not found.');
      assertScope(identity, 'operations:write', eventId, count.venueId, count.locationId ?? undefined);
      if (count.state !== 'SUBMITTED') throw new ConflictException('Only a submitted count can be approved.');
      if (count.counterId === identity.subject) throw new ConflictException('A different manager must approve this count.');
      const lines = await tx.$queryRaw`SELECT l.item_id AS "itemId", l.expected_quantity AS expected, l.counted_quantity AS counted, i.on_hand AS "onHand"
        FROM stock_count_lines l JOIN stock_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
        WHERE l.count_id=${countId}::uuid AND l.organization_id=${identity.tenantId}::uuid ORDER BY l.item_id FOR UPDATE OF i` as { itemId: string; expected: string; counted: string; onHand: string }[];
      for (const line of lines) {
        if (Number(line.expected) !== Number(line.onHand)) throw new ConflictException('Stock changed after this count began. Cancel it and start a fresh count.');
      }
      for (const line of lines) {
        const delta = Number(line.counted) - Number(line.expected);
        if (delta === 0) continue;
        await tx.$executeRaw`UPDATE stock_items SET on_hand=${line.counted}::numeric, updated_at=now() WHERE id=${line.itemId}::uuid AND organization_id=${identity.tenantId}::uuid`;
        await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,count_id,actor_id,movement_type,quantity_delta,reason)
          VALUES (${identity.tenantId}::uuid,${line.itemId}::uuid,${countId}::uuid,${identity.subject},'COUNT_ADJUSTMENT',${delta},${dto.reason.trim()})`;
      }
      await tx.$executeRaw`UPDATE stock_counts SET state='APPROVED', reviewer_id=${identity.subject}, reason=${dto.reason.trim()}, approved_at=now() WHERE id=${countId}::uuid`;
      await this.audit(tx, identity, countId, 'approved', { state: 'SUBMITTED' }, { state: 'APPROVED', reviewerId: identity.subject }, dto.reason.trim());
      return { id: countId, state: 'APPROVED', adjustments: lines.filter(line => Number(line.counted) !== Number(line.expected)).length };
    });
  }

  async listTransfers(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.prisma.withTenant(identity, async tx => {
      const rows = await tx.$queryRaw`
        SELECT t.id, t.event_id AS "eventId", t.venue_id AS "venueId", t.source_location_id AS "sourceLocationId",
          t.destination_location_id AS "destinationLocationId", t.state, t.requested_by AS "requestedBy",
          t.dispatched_by AS "dispatchedBy", t.received_by AS "receivedBy", t.request_note AS "requestNote",
          t.reconciliation_reason AS "reconciliationReason", t.cancel_reason AS "cancelReason",
          t.created_at AS "createdAt", t.dispatched_at AS "dispatchedAt", t.received_at AS "receivedAt", t.cancelled_at AS "cancelledAt"
        FROM stock_transfers t WHERE t.organization_id=${identity.tenantId}::uuid AND t.event_id=${eventId}::uuid
          AND (${identity.capabilities.includes('tenant:admin')} OR (t.venue_id = ANY(${identity.venueIds}::uuid[])
            AND (t.source_location_id IS NULL OR t.source_location_id = ANY(${identity.locationIds}::uuid[]))
            AND (t.destination_location_id IS NULL OR t.destination_location_id = ANY(${identity.locationIds}::uuid[]))))
        ORDER BY t.created_at DESC LIMIT 100` as Record<string, unknown>[];
      if (!rows.length) return [];
      const transferIds = rows.map(row => row.id as string);
      const lines = await tx.$queryRaw`
        SELECT l.id, l.transfer_id AS "transferId", l.source_item_id AS "sourceItemId", l.destination_item_id AS "destinationItemId",
          i.sku, i.name, i.unit, l.requested_quantity AS "requestedQuantity", l.received_quantity AS "receivedQuantity"
        FROM stock_transfer_lines l JOIN stock_items i ON i.id=l.source_item_id AND i.organization_id=l.organization_id
        WHERE l.organization_id=${identity.tenantId}::uuid AND l.transfer_id=ANY(${transferIds}::uuid[])
        ORDER BY i.name` as Record<string, unknown>[];
      return rows.map(row => ({ ...row, lines: lines.filter(line => line.transferId === row.id) }));
    });
  }

  async createTransfer(identity: Identity, eventId: string, dto: CreateStockTransferDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.sourceLocationId);
    if (dto.destinationLocationId) assertScope(identity, 'operations:write', eventId, dto.venueId, dto.destinationLocationId);
    if ((dto.sourceLocationId ?? null) === (dto.destinationLocationId ?? null)) throw new ConflictException('Choose different source and destination locations.');
    const input = { eventId, ...dto };
    return this.command(identity, key, 'stock-transfer.create', input, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in the selected venue.');
      for (const locationId of [dto.sourceLocationId, dto.destinationLocationId].filter((id): id is string => Boolean(id))) {
        if (!await tx.location.findFirst({ where: { id: locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Transfer location not found in this venue.');
      }
      const rows = await tx.$queryRaw`INSERT INTO stock_transfers(organization_id,venue_id,event_id,source_location_id,destination_location_id,requested_by)
        VALUES (${identity.tenantId}::uuid,${dto.venueId}::uuid,${eventId}::uuid,${dto.sourceLocationId ?? null}::uuid,${dto.destinationLocationId ?? null}::uuid,${identity.subject}) RETURNING id` as { id: string }[];
      const transferId = rows[0].id;
      for (const line of dto.lines) {
        const items = await tx.$queryRaw`SELECT id FROM stock_items WHERE id=${line.itemId}::uuid AND organization_id=${identity.tenantId}::uuid AND venue_id=${dto.venueId}::uuid AND location_id IS NOT DISTINCT FROM ${dto.sourceLocationId ?? null}::uuid AND active` as { id: string }[];
        if (!items.length) throw new NotFoundException('A selected stock item is not active in the source location.');
        await tx.$executeRaw`INSERT INTO stock_transfer_lines(organization_id,transfer_id,source_item_id,requested_quantity)
          VALUES (${identity.tenantId}::uuid,${transferId}::uuid,${line.itemId}::uuid,${line.quantity})`;
      }
      await this.transferAudit(tx, identity, transferId, 'requested', null, { ...input, state: 'REQUESTED' });
      return { id: transferId, eventId, venueId: dto.venueId, sourceLocationId: dto.sourceLocationId ?? null, destinationLocationId: dto.destinationLocationId ?? null, state: 'REQUESTED' };
    });
  }

  async dispatchTransfer(identity: Identity, eventId: string, transferId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-transfer.dispatch', { eventId, transferId }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-transfer:${identity.tenantId}:${transferId}`},0))`;
      const transfers = await tx.$queryRaw`SELECT venue_id AS "venueId",source_location_id AS "sourceLocationId",destination_location_id AS "destinationLocationId",state,requested_by AS "requestedBy"
        FROM stock_transfers WHERE id=${transferId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; sourceLocationId: string | null; destinationLocationId: string | null; state: string; requestedBy: string }[];
      const transfer = transfers[0];
      if (!transfer) throw new NotFoundException('Stock transfer not found.');
      this.assertTransferScope(identity, eventId, transfer);
      if (transfer.state !== 'REQUESTED') throw new ConflictException('Only a requested transfer can be dispatched.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-transfer-dispatch:${identity.tenantId}:${transfer.venueId}`},0))`;
      const lines = await tx.$queryRaw`SELECT l.id,l.source_item_id AS "sourceItemId",l.requested_quantity AS quantity,i.sku,i.name,i.unit,i.on_hand AS "onHand"
        FROM stock_transfer_lines l JOIN stock_items i ON i.id=l.source_item_id AND i.organization_id=l.organization_id
        WHERE l.transfer_id=${transferId}::uuid AND l.organization_id=${identity.tenantId}::uuid ORDER BY l.source_item_id FOR UPDATE OF i` as { id: string; sourceItemId: string; quantity: string; sku: string; name: string; unit: string; onHand: string }[];
      for (const line of lines) if (Number(line.onHand) < Number(line.quantity)) throw new ConflictException(`Insufficient stock for ${line.name}; refresh the inventory and edit the transfer request.`);
      for (const line of lines) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-item:${identity.tenantId}:${transfer.venueId}:${transfer.destinationLocationId ?? 'venue'}:${line.sku.toLowerCase()}`},0))`;
        let destination = await tx.$queryRaw`SELECT id FROM stock_items WHERE organization_id=${identity.tenantId}::uuid AND venue_id=${transfer.venueId}::uuid AND location_id IS NOT DISTINCT FROM ${transfer.destinationLocationId}::uuid AND lower(sku)=lower(${line.sku}) AND active FOR UPDATE` as { id: string }[];
        if (!destination.length) {
          const created = await tx.$queryRaw`INSERT INTO stock_items(organization_id,venue_id,location_id,sku,name,unit)
            VALUES (${identity.tenantId}::uuid,${transfer.venueId}::uuid,${transfer.destinationLocationId}::uuid,${line.sku},${line.name},${line.unit})
            RETURNING id` as { id: string }[];
          destination = created;
        }
        await tx.$executeRaw`UPDATE stock_items SET on_hand=on_hand-${line.quantity}::numeric,updated_at=now() WHERE id=${line.sourceItemId}::uuid AND organization_id=${identity.tenantId}::uuid AND on_hand >= ${line.quantity}::numeric`;
        await tx.$executeRaw`UPDATE stock_transfer_lines SET destination_item_id=${destination[0].id}::uuid WHERE id=${line.id}::uuid AND organization_id=${identity.tenantId}::uuid`;
        await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,transfer_id,actor_id,movement_type,quantity_delta,reason)
          VALUES (${identity.tenantId}::uuid,${line.sourceItemId}::uuid,${transferId}::uuid,${identity.subject},'TRANSFER_OUT',-${line.quantity}::numeric,'Dispatched stock transfer')`;
      }
      await tx.$executeRaw`UPDATE stock_transfers SET state='IN_TRANSIT',dispatched_by=${identity.subject},dispatched_at=now() WHERE id=${transferId}::uuid`;
      await this.transferAudit(tx, identity, transferId, 'dispatched', { state: 'REQUESTED' }, { state: 'IN_TRANSIT', dispatchedBy: identity.subject });
      return { id: transferId, state: 'IN_TRANSIT', dispatchedLines: lines.length };
    });
  }

  async receiveTransfer(identity: Identity, eventId: string, transferId: string, dto: ReceiveStockTransferDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-transfer.receive', { eventId, transferId, ...dto }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-transfer:${identity.tenantId}:${transferId}`},0))`;
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",source_location_id AS "sourceLocationId",destination_location_id AS "destinationLocationId",state,dispatched_by AS "dispatchedBy",requested_by AS "requestedBy"
        FROM stock_transfers WHERE id=${transferId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; sourceLocationId: string | null; destinationLocationId: string | null; state: string; dispatchedBy: string | null; requestedBy: string }[];
      const transfer = rows[0];
      if (!transfer) throw new NotFoundException('Stock transfer not found.');
      this.assertTransferScope(identity, eventId, transfer);
      if (transfer.state !== 'IN_TRANSIT') throw new ConflictException('Only an in-transit transfer can be received.');
      if (transfer.dispatchedBy === identity.subject) throw new ConflictException('A different scoped operator must confirm receipt.');
      const persisted = await tx.$queryRaw`SELECT id,destination_item_id AS "destinationItemId",requested_quantity AS "requestedQuantity"
        FROM stock_transfer_lines WHERE transfer_id=${transferId}::uuid AND organization_id=${identity.tenantId}::uuid ORDER BY id FOR UPDATE` as { id: string; destinationItemId: string; requestedQuantity: string }[];
      if (dto.lines.length !== persisted.length || persisted.some(line => !dto.lines.some(receipt => receipt.lineId === line.id))) throw new ConflictException('Submit a received quantity for every transfer line exactly once.');
      const hasVariance = persisted.some(line => Number(dto.lines.find(receipt => receipt.lineId === line.id)!.quantity) !== Number(line.requestedQuantity));
      if (hasVariance && !dto.reason?.trim()) throw new ConflictException('A reconciliation reason is required when a received quantity differs from the dispatched quantity.');
      for (const line of persisted) {
        const quantity = dto.lines.find(receipt => receipt.lineId === line.id)!.quantity;
        if (quantity > Number(line.requestedQuantity)) throw new ConflictException('Received quantity cannot exceed the dispatched quantity.');
        if (quantity > 0) {
          await tx.$executeRaw`UPDATE stock_items SET on_hand=on_hand+${quantity}::numeric,updated_at=now() WHERE id=${line.destinationItemId}::uuid AND organization_id=${identity.tenantId}::uuid`;
          await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,transfer_id,actor_id,movement_type,quantity_delta,reason)
            VALUES (${identity.tenantId}::uuid,${line.destinationItemId}::uuid,${transferId}::uuid,${identity.subject},'TRANSFER_IN',${quantity}::numeric,'Received stock transfer')`;
        }
        await tx.$executeRaw`UPDATE stock_transfer_lines SET received_quantity=${quantity}::numeric WHERE id=${line.id}::uuid AND organization_id=${identity.tenantId}::uuid`;
      }
      await tx.$executeRaw`UPDATE stock_transfers SET state='RECEIVED',received_by=${identity.subject},received_at=now(),reconciliation_reason=${dto.reason?.trim() ?? null} WHERE id=${transferId}::uuid`;
      await this.transferAudit(tx, identity, transferId, hasVariance ? 'received_with_variance' : 'received', { state: 'IN_TRANSIT' }, { state: 'RECEIVED', quantities: dto.lines }, dto.reason?.trim());
      return { id: transferId, state: 'RECEIVED', varianceLines: persisted.filter(line => Number(dto.lines.find(receipt => receipt.lineId === line.id)!.quantity) !== Number(line.requestedQuantity)).length };
    });
  }

  async cancelTransfer(identity: Identity, eventId: string, transferId: string, dto: CancelStockTransferDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-transfer.cancel', { eventId, transferId, ...dto }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",source_location_id AS "sourceLocationId",destination_location_id AS "destinationLocationId",state,requested_by AS "requestedBy"
        FROM stock_transfers WHERE id=${transferId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; sourceLocationId: string | null; destinationLocationId: string | null; state: string; requestedBy: string }[];
      const transfer = rows[0];
      if (!transfer) throw new NotFoundException('Stock transfer not found.');
      this.assertTransferScope(identity, eventId, transfer);
      if (transfer.state !== 'REQUESTED') throw new ConflictException('Only a requested transfer can be cancelled.');
      await tx.$executeRaw`UPDATE stock_transfers SET state='CANCELLED',cancel_reason=${dto.reason.trim()},cancelled_at=now() WHERE id=${transferId}::uuid`;
      await this.transferAudit(tx, identity, transferId, 'cancelled', { state: 'REQUESTED' }, { state: 'CANCELLED' }, dto.reason.trim());
      return { id: transferId, state: 'CANCELLED' };
    });
  }

  async listPurchaseOrders(identity: Identity, eventId: string) {
    assertScope(identity, 'operations:read', eventId);
    return this.prisma.withTenant(identity, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found.');
      assertScope(identity, 'operations:read', eventId, event.venueId);
      return tx.$queryRaw`
        SELECT p.id, p.event_id AS "eventId", p.venue_id AS "venueId", p.location_id AS "locationId",
          p.supplier_name AS "supplierName", p.supplier_reference AS "supplierReference", p.note,
          p.state, p.requested_by AS "requestedBy", p.approved_by AS "approvedBy", p.received_by AS "receivedBy",
          p.close_reason AS "closeReason", p.created_at AS "createdAt", p.approved_at AS "approvedAt",
          p.last_received_at AS "lastReceivedAt", p.closed_at AS "closedAt",
          COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'itemId', i.id, 'sku', i.sku, 'name', i.name,
            'unit', i.unit, 'orderedQuantity', l.ordered_quantity, 'receivedQuantity', l.received_quantity)
            ORDER BY i.name) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS lines
        FROM stock_purchase_orders p
        LEFT JOIN stock_purchase_order_lines l ON l.purchase_order_id=p.id AND l.organization_id=p.organization_id
        LEFT JOIN stock_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
        WHERE p.organization_id=${identity.tenantId}::uuid AND p.event_id=${eventId}::uuid
          AND (${identity.capabilities.includes('tenant:admin')} OR (p.venue_id=ANY(${identity.venueIds}::uuid[])
            AND (p.location_id IS NULL OR p.location_id=ANY(${identity.locationIds}::uuid[]))))
        GROUP BY p.id ORDER BY p.created_at DESC LIMIT 100`;
    });
  }

  async createPurchaseOrder(identity: Identity, eventId: string, dto: CreateStockPurchaseOrderDto, key: string) {
    assertScope(identity, 'operations:write', eventId, dto.venueId, dto.locationId);
    if (dto.supplierName.trim().length < 2) throw new ConflictException('Enter a supplier name with at least two characters.');
    const input = { eventId, ...dto, supplierName: dto.supplierName.trim(), supplierReference: dto.supplierReference?.trim() ?? '', note: dto.note?.trim() ?? '' };
    return this.command(identity, key, 'stock-purchase-order.create', input, async tx => {
      const event = await tx.event.findFirst({ where: { id: eventId, venueId: dto.venueId, organizationId: identity.tenantId } });
      if (!event) throw new NotFoundException('Event not found in this venue.');
      if (dto.locationId && !await tx.location.findFirst({ where: { id: dto.locationId, venueId: dto.venueId, organizationId: identity.tenantId } })) throw new NotFoundException('Purchase order location not found.');
      const itemIds = dto.lines.map(line => line.itemId);
      const items = await tx.$queryRaw`SELECT id, location_id AS "locationId" FROM stock_items
        WHERE organization_id=${identity.tenantId}::uuid AND venue_id=${dto.venueId}::uuid
          AND active AND id=ANY(${itemIds}::uuid[])` as { id: string; locationId: string | null }[];
      if (items.length !== itemIds.length || items.some(item => item.locationId !== (dto.locationId ?? null))) throw new ConflictException('Every purchase-order item must be active and belong to the selected venue and inventory location.');
      const rows = await tx.$queryRaw`INSERT INTO stock_purchase_orders(organization_id,venue_id,event_id,location_id,supplier_name,supplier_reference,note,requested_by)
        VALUES (${identity.tenantId}::uuid,${dto.venueId}::uuid,${eventId}::uuid,${dto.locationId ?? null}::uuid,${input.supplierName},${input.supplierReference},${input.note},${identity.subject}) RETURNING id` as { id: string }[];
      const orderId = rows[0].id;
      for (const line of dto.lines) {
        await tx.$executeRaw`INSERT INTO stock_purchase_order_lines(organization_id,event_id,venue_id,purchase_order_id,item_id,ordered_quantity)
          VALUES (${identity.tenantId}::uuid,${eventId}::uuid,${dto.venueId}::uuid,${orderId}::uuid,${line.itemId}::uuid,${line.quantity}::numeric)`;
      }
      await this.purchaseOrderAudit(tx, identity, orderId, 'submitted', null, { supplierName: input.supplierName, lineCount: dto.lines.length });
      return { id: orderId, eventId, venueId: dto.venueId, locationId: dto.locationId ?? null, supplierName: input.supplierName, supplierReference: input.supplierReference, note: input.note, state: 'SUBMITTED', requestedBy: identity.subject };
    });
  }

  async approvePurchaseOrder(identity: Identity, eventId: string, orderId: string, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-purchase-order.approve', { eventId, orderId }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",location_id AS "locationId",state,requested_by AS "requestedBy"
        FROM stock_purchase_orders WHERE id=${orderId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string; requestedBy: string }[];
      const order = rows[0];
      if (!order) throw new NotFoundException('Purchase order not found.');
      assertScope(identity, 'operations:write', eventId, order.venueId, order.locationId ?? undefined);
      if (order.state !== 'SUBMITTED') throw new ConflictException('Only a submitted purchase order can be approved.');
      if (order.requestedBy === identity.subject) throw new ConflictException('A different scoped manager must approve the purchase order.');
      await tx.$executeRaw`UPDATE stock_purchase_orders SET state='APPROVED',approved_by=${identity.subject},approved_at=now(),updated_at=now() WHERE id=${orderId}::uuid`;
      await this.purchaseOrderAudit(tx, identity, orderId, 'approved', { state: 'SUBMITTED' }, { state: 'APPROVED' });
      return { id: orderId, state: 'APPROVED' };
    });
  }

  async receivePurchaseOrder(identity: Identity, eventId: string, orderId: string, dto: ReceiveStockPurchaseOrderDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    return this.command(identity, key, 'stock-purchase-order.receive', { eventId, orderId, ...dto }, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-purchase-order:${identity.tenantId}:${orderId}`},0))`;
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",location_id AS "locationId",state,approved_by AS "approvedBy"
        FROM stock_purchase_orders WHERE id=${orderId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string; approvedBy: string | null }[];
      const order = rows[0];
      if (!order) throw new NotFoundException('Purchase order not found.');
      assertScope(identity, 'operations:write', eventId, order.venueId, order.locationId ?? undefined);
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.state)) throw new ConflictException('Only an approved or partially received purchase order can receive stock.');
      if (order.approvedBy === identity.subject) throw new ConflictException('A different scoped operator must verify physical receipt.');
      const persisted = await tx.$queryRaw`SELECT id,item_id AS "itemId",ordered_quantity AS "orderedQuantity",received_quantity AS "receivedQuantity"
        FROM stock_purchase_order_lines WHERE purchase_order_id=${orderId}::uuid AND organization_id=${identity.tenantId}::uuid ORDER BY id FOR UPDATE` as { id: string; itemId: string; orderedQuantity: string; receivedQuantity: string }[];
      if (dto.lines.some(receipt => !persisted.some(line => line.id === receipt.lineId))) throw new ConflictException('A received line is not part of this purchase order.');
      const milliunits = (value: string | number) => Math.round(Number(value) * 1000);
      for (const receipt of dto.lines) {
        const line = persisted.find(row => row.id === receipt.lineId)!;
        if (milliunits(receipt.quantity) > milliunits(line.orderedQuantity) - milliunits(line.receivedQuantity)) throw new ConflictException('Received quantity cannot exceed the remaining ordered quantity.');
        await tx.$executeRaw`UPDATE stock_purchase_order_lines SET received_quantity=received_quantity+${receipt.quantity}::numeric WHERE id=${line.id}::uuid AND organization_id=${identity.tenantId}::uuid`;
        await tx.$executeRaw`UPDATE stock_items SET on_hand=on_hand+${receipt.quantity}::numeric,updated_at=now() WHERE id=${line.itemId}::uuid AND organization_id=${identity.tenantId}::uuid`;
        await tx.$executeRaw`INSERT INTO stock_movements(organization_id,item_id,purchase_order_id,actor_id,movement_type,quantity_delta,reason)
          VALUES (${identity.tenantId}::uuid,${line.itemId}::uuid,${orderId}::uuid,${identity.subject},'PURCHASE_RECEIPT',${receipt.quantity}::numeric,'Purchase order receipt')`;
      }
      const complete = persisted.every(line => milliunits(line.receivedQuantity) + milliunits(dto.lines.find(receipt => receipt.lineId === line.id)?.quantity ?? 0) === milliunits(line.orderedQuantity));
      const nextState = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.$executeRaw`UPDATE stock_purchase_orders SET state=${nextState},received_by=${identity.subject},last_received_at=now(),updated_at=now(),closed_at=CASE WHEN ${complete} THEN now() ELSE NULL END WHERE id=${orderId}::uuid`;
      await this.purchaseOrderAudit(tx, identity, orderId, complete ? 'received' : 'partially_received', { state: order.state }, { state: nextState, lines: dto.lines }, dto.note?.trim());
      return { id: orderId, state: nextState };
    });
  }

  async closePurchaseOrderShort(identity: Identity, eventId: string, orderId: string, dto: CloseStockPurchaseOrderShortDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    if (dto.reason.trim().length < 3) throw new ConflictException('Explain why the remaining purchase quantity is being closed short.');
    return this.command(identity, key, 'stock-purchase-order.close-short', { eventId, orderId, reason: dto.reason.trim() }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",location_id AS "locationId",state FROM stock_purchase_orders
        WHERE id=${orderId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string }[];
      const order = rows[0];
      if (!order) throw new NotFoundException('Purchase order not found.');
      assertScope(identity, 'operations:write', eventId, order.venueId, order.locationId ?? undefined);
      if (order.state !== 'PARTIALLY_RECEIVED') throw new ConflictException('Only a partially received purchase order can be closed short.');
      const remaining = await tx.$queryRaw`SELECT count(*)::int AS count FROM stock_purchase_order_lines
        WHERE purchase_order_id=${orderId}::uuid AND organization_id=${identity.tenantId}::uuid AND received_quantity < ordered_quantity` as { count: number }[];
      if (!remaining[0]?.count) throw new ConflictException('This purchase order has no remaining quantity to reconcile.');
      await tx.$executeRaw`UPDATE stock_purchase_orders SET state='CLOSED_SHORT',close_reason=${dto.reason.trim()},closed_at=now(),updated_at=now() WHERE id=${orderId}::uuid`;
      await this.purchaseOrderAudit(tx, identity, orderId, 'closed_short', { state: order.state }, { state: 'CLOSED_SHORT' }, dto.reason.trim());
      return { id: orderId, state: 'CLOSED_SHORT' };
    });
  }

  async cancelPurchaseOrder(identity: Identity, eventId: string, orderId: string, dto: CancelStockTransferDto, key: string) {
    assertScope(identity, 'operations:write', eventId);
    if (dto.reason.trim().length < 3) throw new ConflictException('Explain why the submitted purchase order is being cancelled.');
    return this.command(identity, key, 'stock-purchase-order.cancel', { eventId, orderId, reason: dto.reason.trim() }, async tx => {
      const rows = await tx.$queryRaw`SELECT venue_id AS "venueId",location_id AS "locationId",state,requested_by AS "requestedBy"
        FROM stock_purchase_orders WHERE id=${orderId}::uuid AND event_id=${eventId}::uuid AND organization_id=${identity.tenantId}::uuid FOR UPDATE` as { venueId: string; locationId: string | null; state: string; requestedBy: string }[];
      const order = rows[0];
      if (!order) throw new NotFoundException('Purchase order not found.');
      assertScope(identity, 'operations:write', eventId, order.venueId, order.locationId ?? undefined);
      if (order.state !== 'SUBMITTED') throw new ConflictException('Only an unapproved purchase order can be cancelled.');
      if (order.requestedBy !== identity.subject && !identity.capabilities.includes('tenant:admin')) throw new ConflictException('Only the requester or a tenant administrator can cancel this purchase order before approval.');
      await tx.$executeRaw`UPDATE stock_purchase_orders SET state='CANCELLED',cancel_reason=${dto.reason.trim()},cancelled_at=now(),updated_at=now() WHERE id=${orderId}::uuid`;
      await this.purchaseOrderAudit(tx, identity, orderId, 'cancelled', { state: 'SUBMITTED' }, { state: 'CANCELLED' }, dto.reason.trim());
      return { id: orderId, state: 'CANCELLED' };
    });
  }

  private async purchaseOrderAudit(tx: any, identity: Identity, orderId: string, action: string, before: unknown, after: unknown, reason?: string) {
    await tx.$executeRaw`INSERT INTO stock_purchase_order_audit(organization_id,purchase_order_id,actor_id,action,before,after,reason)
      VALUES (${identity.tenantId}::uuid,${orderId}::uuid,${identity.subject},${action},${before == null ? null : JSON.stringify(before)}::jsonb,${after == null ? null : JSON.stringify(after)}::jsonb,${reason ?? null})`;
  }

  private assertTransferScope(identity: Identity, eventId: string, transfer: { venueId: string; sourceLocationId: string | null; destinationLocationId: string | null }) {
    assertScope(identity, 'operations:write', eventId, transfer.venueId, transfer.sourceLocationId ?? undefined);
    if (transfer.destinationLocationId) assertScope(identity, 'operations:write', eventId, transfer.venueId, transfer.destinationLocationId);
  }

  private async transferAudit(tx: any, identity: Identity, transferId: string, action: string, before: unknown, after: unknown, reason?: string) {
    await tx.$executeRaw`INSERT INTO stock_transfer_audit(organization_id,transfer_id,actor_id,action,before,after,reason)
      VALUES (${identity.tenantId}::uuid,${transferId}::uuid,${identity.subject},${action},${before == null ? null : JSON.stringify(before)}::jsonb,${after == null ? null : JSON.stringify(after)}::jsonb,${reason ?? null})`;
  }

  private async audit(tx: any, identity: Identity, countId: string, action: string, before: unknown, after: unknown, reason?: string) {
    await tx.$executeRaw`INSERT INTO stock_count_audit(organization_id,count_id,actor_id,action,before,after,reason)
      VALUES (${identity.tenantId}::uuid,${countId}::uuid,${identity.subject},${action},${before == null ? null : JSON.stringify(before)}::jsonb,${after == null ? null : JSON.stringify(after)}::jsonb,${reason ?? null})`;
  }

  private async command<T>(identity: Identity, key: string, action: string, input: unknown, work: (tx: any) => Promise<T>): Promise<T> {
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, actor: identity.subject, input })).digest('hex');
    return this.prisma.withTenant(identity, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`command:${identity.tenantId}:${key}`}, 0))`;
      const prior = await tx.commandReceipt.findUnique({ where: { organizationId_key: { organizationId: identity.tenantId, key } } });
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ConflictException('This Idempotency-Key was already used for a different command.');
        return prior.response as T;
      }
      const result = await work(tx);
      await tx.commandReceipt.create({ data: { organizationId: identity.tenantId, key, fingerprint, action, response: JSON.parse(JSON.stringify(result)) } });
      return result;
    });
  }
}

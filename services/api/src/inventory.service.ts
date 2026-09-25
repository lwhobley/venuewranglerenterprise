import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { assertCapability, assertScope, assertTenantAdmin, Identity } from './auth';
import { PrismaService } from './prisma.service';
import { ApproveStockCountDto, CreateStockItemDto, RecordStockCountDto, StartStockCountDto } from './inventory.dto';

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

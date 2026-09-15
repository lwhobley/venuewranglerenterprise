import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type InventoryDomain, type InventoryLocationKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializableRetry } from '../../common/tx-retry';
import { assertDepartmentAccess, type UserScope } from '../../auth/department-auth.helper';
import { canManageVenue, isCrossDepartmentRole } from '../../auth/roles';
import { InventoryLedgerService } from './inventory-ledger.service';
import { roundQuantity, stockStatus, type MovementType, type StockStatus } from './inventory-movement';
import { SYSTEM_CATEGORIES, mapLegacyBarCategory, normalizeItemName, slugify } from './inventory-taxonomy';

export type InventoryScope = UserScope & { allAccess: boolean };

/** Movements an operator may post directly; the rest come from workflows. */
export const DIRECT_MOVEMENT_TYPES = [
  'receive', 'count_adjustment', 'manual_adjustment', 'waste', 'spoilage', 'breakage', 'spill',
] as const satisfies readonly MovementType[];
export type DirectMovementType = (typeof DIRECT_MOVEMENT_TYPES)[number];

/** Catalogs are listed and filtered in memory up to this many items per domain. */
const CATALOG_SCAN_LIMIT = 5000;

export interface ListItemsFilter {
  domain?: InventoryDomain;
  categoryId?: string;
  locationId?: string;
  status?: StockStatus;
  search?: string;
  includeArchived?: boolean;
  offset?: number;
  limit?: number;
}

export interface CreateItemInput {
  domain: InventoryDomain;
  name: string;
  categoryId?: string;
  description?: string;
  internalSku?: string;
  barcode?: string;
  vendorSku?: string;
  brand?: string;
  baseUnit?: string;
  purchaseUnit?: string;
  purchaseToBase?: number;
  packSize?: string;
  storageCondition?: string;
  unitCostCents?: number;
  supplier?: string;
  trackExpiration?: boolean;
  attributes?: Record<string, unknown>;
  notes?: string;
  /** Optional opening stock, posted as an opening_balance transaction. */
  locationId?: string;
  openingQuantity?: number;
  par?: number;
}

export type UpdateItemInput = Partial<Omit<CreateItemInput, 'domain' | 'locationId' | 'openingQuantity' | 'par'>>;

export interface MovementRequest {
  itemId: string;
  locationId: string;
  type: DirectMovementType;
  quantity: number;
  reasonCode?: string;
  note?: string;
  unitCostCents?: number;
  idempotencyKey?: string;
}

export interface TransferRequest {
  fromLocationId: string;
  toLocationId: string;
  lines: Array<{ itemId: string; quantity: number }>;
  note?: string;
  idempotencyKey?: string;
}

const dec = (value: Prisma.Decimal | null | undefined) => (value == null ? null : value.toNumber());

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  // ── Access ────────────────────────────────────────────────────────────────

  private async tenant(scope: InventoryScope) {
    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: scope.venueId },
      select: { organizationId: true },
    });
    return { organizationId: venue.organizationId, facilityId: scope.venueId };
  }

  private isVenueManager(scope: InventoryScope) {
    return canManageVenue(scope.role, scope.allAccess) || isCrossDepartmentRole(scope.role);
  }

  /** Catalog and settings changes: venue managers and cross-department leads. */
  private assertManager(scope: InventoryScope) {
    if (!this.isVenueManager(scope)) {
      throw new ForbiddenException('Only venue managers can change the inventory catalog');
    }
  }

  /**
   * Stock movements: venue managers anywhere; department members only at
   * locations owned by their department.
   */
  private async assertCanMoveStock(scope: InventoryScope, location: { departmentId: string | null }) {
    if (this.isVenueManager(scope)) return;
    if (!location.departmentId) {
      throw new ForbiddenException('Only venue managers can move stock at venue-wide locations');
    }
    await assertDepartmentAccess(scope, scope.venueId, location.departmentId, this.prisma);
  }

  private async requireLocation(facilityId: string, id: string) {
    const location = await this.prisma.inventoryLocation.findFirst({ where: { id, facilityId } });
    if (!location) throw new NotFoundException('Inventory location not found');
    return location;
  }

  // ── Taxonomy & locations ──────────────────────────────────────────────────

  async ensureTaxonomy(organizationId: string, facilityId: string) {
    const rows = (Object.entries(SYSTEM_CATEGORIES) as [InventoryDomain, string[]][]).flatMap(([domain, names]) =>
      names.map((name, index) => ({
        organizationId, facilityId, domain, name, slug: slugify(name), isSystem: true, sortOrder: index,
      })));
    await this.prisma.inventoryCategory.createMany({ data: rows, skipDuplicates: true });
  }

  async listCategories(scope: InventoryScope, domain?: InventoryDomain) {
    const { organizationId, facilityId } = await this.tenant(scope);
    await this.ensureTaxonomy(organizationId, facilityId);
    return this.prisma.inventoryCategory.findMany({
      where: { facilityId, active: true, ...(domain ? { domain } : {}) },
      orderBy: [{ domain: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(scope: InventoryScope, input: { domain: InventoryDomain; name: string; parentId?: string }) {
    this.assertManager(scope);
    const { organizationId, facilityId } = await this.tenant(scope);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Category name is required');
    try {
      return await this.prisma.inventoryCategory.create({
        data: { organizationId, facilityId, domain: input.domain, name, slug: slugify(name), parentId: input.parentId, sortOrder: 1000 },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A ${input.domain} category named "${name}" already exists`);
      }
      throw err;
    }
  }

  async listLocations(scope: InventoryScope) {
    return this.prisma.inventoryLocation.findMany({
      where: { facilityId: scope.venueId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createLocation(
    scope: InventoryScope,
    input: { name: string; code?: string; kind?: InventoryLocationKind; parentId?: string; departmentId?: string; sortOrder?: number },
  ) {
    this.assertManager(scope);
    const { organizationId, facilityId } = await this.tenant(scope);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Location name is required');
    if (input.parentId) await this.requireLocation(facilityId, input.parentId);
    if (input.departmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: input.departmentId, facilityId } });
      if (!department) throw new NotFoundException('Department not found at this venue');
    }
    const code = (input.code?.trim() || slugify(name)).toUpperCase();
    try {
      return await this.prisma.inventoryLocation.create({
        data: {
          organizationId, facilityId, name, code, kind: input.kind ?? 'storage',
          parentId: input.parentId, departmentId: input.departmentId, sortOrder: input.sortOrder ?? 0,
          createdBy: scope.userId, updatedBy: scope.userId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Location code "${code}" is already in use`);
      }
      throw err;
    }
  }

  // ── Catalog ───────────────────────────────────────────────────────────────

  async listItems(scope: InventoryScope, filter: ListItemsFilter) {
    const facilityId = scope.venueId;
    const search = filter.search?.trim();
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        facilityId,
        ...(filter.includeArchived ? {} : { active: true }),
        ...(filter.domain ? { domain: filter.domain } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.locationId ? { balances: { some: { locationId: filter.locationId } } } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { internalSku: { contains: search, mode: 'insensitive' } },
                { barcode: { equals: search } },
                { vendorSku: { contains: search, mode: 'insensitive' } },
                { brand: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        category: { select: { id: true, name: true } },
        balances: {
          where: filter.locationId ? { locationId: filter.locationId } : undefined,
          include: { location: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: CATALOG_SCAN_LIMIT,
    });

    const rows = items.map((item) => this.summarizeItem(item));
    const filtered = filter.status ? rows.filter((row) => row.status === filter.status) : rows;
    const offset = Math.max(0, filter.offset ?? 0);
    const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      nextOffset: offset + limit < filtered.length ? offset + limit : null,
      truncated: items.length === CATALOG_SCAN_LIMIT,
    };
  }

  private summarizeItem(item: Prisma.InventoryItemGetPayload<{
    include: { category: { select: { id: true; name: true } }; balances: { include: { location: { select: { id: true; name: true } } } } };
  }>) {
    let onHand = new Prisma.Decimal(0);
    let par: Prisma.Decimal | null = null;
    let lastCountedAt: Date | null = null;
    let lastMovementAt: Date | null = null;
    for (const b of item.balances) {
      onHand = onHand.plus(b.onHand);
      if (b.par != null) par = (par ?? new Prisma.Decimal(0)).plus(b.par);
      if (b.lastCountedAt && (!lastCountedAt || b.lastCountedAt > lastCountedAt)) lastCountedAt = b.lastCountedAt;
      if (b.lastMovementAt && (!lastMovementAt || b.lastMovementAt > lastMovementAt)) lastMovementAt = b.lastMovementAt;
    }
    const valueCents = item.unitCostCents ? onHand.times(item.unitCostCents) : null;
    return {
      id: item.id,
      domain: item.domain,
      name: item.name,
      brand: item.brand,
      internalSku: item.internalSku,
      barcode: item.barcode,
      baseUnit: item.baseUnit,
      category: item.category,
      active: item.active,
      supplier: item.supplier,
      unitCostCents: dec(item.unitCostCents),
      onHand: onHand.toNumber(),
      par: dec(par),
      valueCents: dec(valueCents),
      status: stockStatus(onHand, par),
      locations: item.balances.map((b) => ({ id: b.location.id, name: b.location.name, onHand: b.onHand.toNumber() })),
      lastCountedAt,
      lastMovementAt,
    };
  }

  async getItem(scope: InventoryScope, itemId: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, facilityId: scope.venueId },
      include: {
        category: { select: { id: true, name: true } },
        balances: { include: { location: { select: { id: true, name: true, kind: true } } }, orderBy: { location: { sortOrder: 'asc' } } },
      },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    const history = await this.prisma.inventoryTransaction.findMany({
      where: { itemId, facilityId: scope.venueId },
      include: { location: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      ...this.summarizeItem(item),
      description: item.description,
      vendorSku: item.vendorSku,
      purchaseUnit: item.purchaseUnit,
      purchaseToBase: item.purchaseToBase.toNumber(),
      packSize: item.packSize,
      storageCondition: item.storageCondition,
      lastCostCents: dec(item.lastCostCents),
      trackExpiration: item.trackExpiration,
      attributes: item.attributes,
      notes: item.notes,
      balances: item.balances.map((b) => ({
        locationId: b.locationId,
        location: b.location,
        onHand: b.onHand.toNumber(),
        committed: b.committed.toNumber(),
        available: b.onHand.minus(b.committed).toNumber(),
        par: dec(b.par),
        reorderPoint: dec(b.reorderPoint),
        reorderQty: dec(b.reorderQty),
        status: stockStatus(b.onHand, b.par),
        lastCountedAt: b.lastCountedAt,
        lastMovementAt: b.lastMovementAt,
      })),
      history: history.map((t) => ({
        id: t.id,
        type: t.type,
        location: t.location,
        quantityBefore: t.quantityBefore.toNumber(),
        quantityAfter: t.quantityAfter.toNumber(),
        quantityDelta: t.quantityDelta.toNumber(),
        valueDeltaCents: dec(t.valueDeltaCents),
        reasonCode: t.reasonCode,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        note: t.note,
        userId: t.userId,
        createdAt: t.createdAt,
      })),
    };
  }

  async createItem(scope: InventoryScope, input: CreateItemInput) {
    this.assertManager(scope);
    const { organizationId, facilityId } = await this.tenant(scope);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Item name is required');
    if (input.categoryId) await this.requireCategory(facilityId, input.categoryId, input.domain);
    if (input.openingQuantity != null && !input.locationId) {
      throw new BadRequestException('Choose a location for the opening quantity');
    }
    if (input.locationId) await this.requireLocation(facilityId, input.locationId);

    try {
      return await withSerializableRetry(this.prisma, async (tx) => {
        const item = await tx.inventoryItem.create({
          data: {
            organizationId, facilityId, domain: input.domain, name, normalizedName: normalizeItemName(name),
            categoryId: input.categoryId, description: input.description, internalSku: input.internalSku?.trim() || null,
            barcode: input.barcode?.trim() || null, vendorSku: input.vendorSku, brand: input.brand,
            baseUnit: input.baseUnit?.trim() || 'ea', purchaseUnit: input.purchaseUnit,
            purchaseToBase: input.purchaseToBase ?? 1, packSize: input.packSize, storageCondition: input.storageCondition,
            unitCostCents: input.unitCostCents, lastCostCents: input.unitCostCents, supplier: input.supplier,
            trackExpiration: input.trackExpiration ?? false, attributes: input.attributes as Prisma.InputJsonValue | undefined,
            notes: input.notes, createdBy: scope.userId, updatedBy: scope.userId,
          },
        });
        if (input.locationId) {
          await tx.inventoryBalance.create({
            data: { organizationId, facilityId, itemId: item.id, locationId: input.locationId, par: input.par ?? null },
          });
          if (input.openingQuantity && input.openingQuantity > 0) {
            await this.ledger.apply(tx, {
              organizationId, facilityId, itemId: item.id, locationId: input.locationId, userId: scope.userId,
              type: 'opening_balance', quantity: input.openingQuantity, referenceType: 'item', referenceId: item.id,
            });
          }
        }
        return item;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`SKU "${input.internalSku}" is already used by another item`);
      }
      throw err;
    }
  }

  private async requireCategory(facilityId: string, categoryId: string, domain: InventoryDomain) {
    const category = await this.prisma.inventoryCategory.findFirst({ where: { id: categoryId, facilityId } });
    if (!category) throw new NotFoundException('Category not found');
    if (category.domain !== domain) {
      throw new BadRequestException(`That category belongs to ${category.domain}, not ${domain}`);
    }
  }

  async updateItem(scope: InventoryScope, itemId: string, input: UpdateItemInput) {
    this.assertManager(scope);
    const existing = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, facilityId: scope.venueId } });
    if (!existing) throw new NotFoundException('Inventory item not found');
    if (input.categoryId) await this.requireCategory(scope.venueId, input.categoryId, existing.domain);
    const name = input.name?.trim();
    return this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: {
        ...(name ? { name, normalizedName: normalizeItemName(name) } : {}),
        categoryId: input.categoryId, description: input.description, internalSku: input.internalSku,
        barcode: input.barcode, vendorSku: input.vendorSku, brand: input.brand, baseUnit: input.baseUnit,
        purchaseUnit: input.purchaseUnit, purchaseToBase: input.purchaseToBase, packSize: input.packSize,
        storageCondition: input.storageCondition, supplier: input.supplier, trackExpiration: input.trackExpiration,
        attributes: input.attributes as Prisma.InputJsonValue | undefined, notes: input.notes,
        // A cost change keeps the previous cost for price-change reporting.
        ...(input.unitCostCents != null ? { unitCostCents: input.unitCostCents, lastCostCents: existing.unitCostCents } : {}),
        updatedBy: scope.userId,
      },
    });
  }

  /** Soft-delete: history stays traceable, the item leaves the active catalog. */
  async setItemActive(scope: InventoryScope, itemId: string, active: boolean) {
    this.assertManager(scope);
    const existing = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, facilityId: scope.venueId } });
    if (!existing) throw new NotFoundException('Inventory item not found');
    return this.prisma.inventoryItem.update({ where: { id: itemId }, data: { active, updatedBy: scope.userId } });
  }

  async setLocationSettings(
    scope: InventoryScope,
    itemId: string,
    locationId: string,
    input: { par?: number | null; reorderPoint?: number | null; reorderQty?: number | null },
  ) {
    const { organizationId, facilityId } = await this.tenant(scope);
    const location = await this.requireLocation(facilityId, locationId);
    await this.assertCanMoveStock(scope, location);
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, facilityId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    const data = {
      ...(input.par !== undefined ? { par: input.par == null ? null : roundQuantity(input.par) } : {}),
      ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint == null ? null : roundQuantity(input.reorderPoint) } : {}),
      ...(input.reorderQty !== undefined ? { reorderQty: input.reorderQty == null ? null : roundQuantity(input.reorderQty) } : {}),
    };
    return this.prisma.inventoryBalance.upsert({
      where: { itemId_locationId: { itemId, locationId } },
      create: { organizationId, facilityId, itemId, locationId, ...data },
      update: data,
    });
  }

  // ── Movements ─────────────────────────────────────────────────────────────

  async recordMovement(scope: InventoryScope, input: MovementRequest) {
    if (!(DIRECT_MOVEMENT_TYPES as readonly string[]).includes(input.type)) {
      throw new BadRequestException(`${input.type} cannot be posted directly`);
    }
    const { organizationId, facilityId } = await this.tenant(scope);
    const location = await this.requireLocation(facilityId, input.locationId);
    await this.assertCanMoveStock(scope, location);
    const result = await this.ledger.record({
      organizationId, facilityId, itemId: input.itemId, locationId: input.locationId, userId: scope.userId,
      type: input.type, quantity: input.quantity, reasonCode: input.reasonCode, note: input.note,
      unitCostCents: input.unitCostCents, idempotencyKey: input.idempotencyKey,
      referenceType: 'manual', referenceId: null,
    });
    // Receiving at a new cost updates the item's current cost.
    if (input.type === 'receive' && input.unitCostCents != null && !result.replayed) {
      const item = await this.prisma.inventoryItem.findFirst({ where: { id: input.itemId, facilityId }, select: { unitCostCents: true } });
      if (item && !item.unitCostCents?.equals(input.unitCostCents)) {
        await this.prisma.inventoryItem.update({
          where: { id: input.itemId },
          data: { unitCostCents: input.unitCostCents, lastCostCents: item.unitCostCents, updatedBy: scope.userId },
        });
      }
    }
    return result;
  }

  async transfer(scope: InventoryScope, input: TransferRequest) {
    if (input.fromLocationId === input.toLocationId) {
      throw new BadRequestException('Source and destination must be different locations');
    }
    if (!input.lines.length) throw new BadRequestException('Add at least one item to transfer');
    const { organizationId, facilityId } = await this.tenant(scope);
    const [from, to] = await Promise.all([
      this.requireLocation(facilityId, input.fromLocationId),
      this.requireLocation(facilityId, input.toLocationId),
    ]);
    // Sending stock is the controlled side; receiving into another department
    // is part of the same atomic transfer.
    await this.assertCanMoveStock(scope, from);

    const transferId = input.idempotencyKey ? `transfer:${input.idempotencyKey}` : randomUUID();
    const key = (suffix: string) => (input.idempotencyKey ? `${input.idempotencyKey}:${suffix}` : null);
    const note = input.note?.trim() || `Transfer ${from.name} → ${to.name}`;
    const results = await this.ledger.recordMany(input.lines.flatMap((line, index) => [
      {
        organizationId, facilityId, itemId: line.itemId, locationId: from.id, userId: scope.userId,
        type: 'transfer_out' as const, quantity: line.quantity, referenceType: 'transfer', referenceId: transferId,
        idempotencyKey: key(`${index}:out`), note,
      },
      {
        organizationId, facilityId, itemId: line.itemId, locationId: to.id, userId: scope.userId,
        type: 'transfer_in' as const, quantity: line.quantity, referenceType: 'transfer', referenceId: transferId,
        idempotencyKey: key(`${index}:in`), note,
      },
    ]));
    return { transferId, transactions: results.map((r) => r.transaction) };
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  async dashboard(scope: InventoryScope) {
    const facilityId = scope.venueId;
    const [items, recent, locationCount, lastCount] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { facilityId, active: true },
        select: {
          id: true, name: true, domain: true, unitCostCents: true, baseUnit: true,
          balances: { select: { onHand: true, par: true, location: { select: { id: true, name: true } } } },
        },
        take: CATALOG_SCAN_LIMIT,
      }),
      this.prisma.inventoryTransaction.findMany({
        where: { facilityId },
        include: { item: { select: { id: true, name: true, baseUnit: true } }, location: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.inventoryLocation.count({ where: { facilityId, active: true } }),
      this.prisma.inventoryBalance.aggregate({ where: { facilityId }, _max: { lastCountedAt: true } }),
    ]);

    const valueByDomain: Record<string, number> = { food: 0, beverage: 0, equipment: 0, packaging: 0, supply: 0 };
    const valueByLocation = new Map<string, { id: string; name: string; valueCents: number }>();
    const itemsByDomain: Record<string, number> = { food: 0, beverage: 0, equipment: 0, packaging: 0, supply: 0 };
    const attention: Array<{ itemId: string; name: string; domain: InventoryDomain; locationId: string; location: string; onHand: number; par: number; unit: string; status: StockStatus }> = [];
    let belowPar = 0;
    let atRisk = 0;

    for (const item of items) {
      itemsByDomain[item.domain] += 1;
      for (const b of item.balances) {
        const value = item.unitCostCents ? b.onHand.times(item.unitCostCents).toNumber() : 0;
        valueByDomain[item.domain] += value;
        const loc = valueByLocation.get(b.location.id) ?? { id: b.location.id, name: b.location.name, valueCents: 0 };
        loc.valueCents += value;
        valueByLocation.set(b.location.id, loc);
        const status = stockStatus(b.onHand, b.par);
        if (status === 'low' || status === 'critical' || (status === 'out' && b.par != null)) {
          belowPar += 1;
          if (status !== 'low') atRisk += 1;
          attention.push({
            itemId: item.id, name: item.name, domain: item.domain, locationId: b.location.id, location: b.location.name,
            onHand: b.onHand.toNumber(), par: b.par?.toNumber() ?? 0, unit: item.baseUnit, status,
          });
        }
      }
    }

    const severity: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, ok: 3, untracked: 4 };
    attention.sort((a, b) => severity[a.status] - severity[b.status] || a.onHand / (a.par || 1) - b.onHand / (b.par || 1));
    const totalValueCents = Object.values(valueByDomain).reduce((sum, v) => sum + v, 0);

    return {
      totals: {
        valueCents: Math.round(totalValueCents),
        foodValueCents: Math.round(valueByDomain.food),
        beverageValueCents: Math.round(valueByDomain.beverage),
        equipmentValueCents: Math.round(valueByDomain.equipment),
        otherValueCents: Math.round(valueByDomain.packaging + valueByDomain.supply),
        itemCount: items.length,
        itemsByDomain,
        locationCount,
        belowParCount: belowPar,
        atRiskCount: atRisk,
        lastCountedAt: lastCount._max.lastCountedAt,
      },
      attention: attention.slice(0, 25),
      valueByLocation: [...valueByLocation.values()]
        .map((l) => ({ ...l, valueCents: Math.round(l.valueCents) }))
        .sort((a, b) => b.valueCents - a.valueCents),
      recentActivity: recent.map((t) => ({
        id: t.id, type: t.type, item: t.item, location: t.location, quantityDelta: t.quantityDelta.toNumber(),
        quantityAfter: t.quantityAfter.toNumber(), reasonCode: t.reasonCode, createdAt: t.createdAt,
      })),
      // Modules not built yet report null rather than a fabricated zero.
      pending: { purchaseOrders: null, receiving: null, countSessions: null, unresolvedVarianceCents: null, posSync: null },
    };
  }

  // ── Legacy migration ──────────────────────────────────────────────────────

  /**
   * Copies BarInventoryItem and DepartmentInventoryItem rows into the ledger.
   * Idempotent: items already linked by legacy id are skipped, so this is safe
   * to re-run after a partial failure or after more legacy writes.
   */
  async migrateLegacy(scope: InventoryScope) {
    this.assertManager(scope);
    const { organizationId, facilityId } = await this.tenant(scope);
    await this.ensureTaxonomy(organizationId, facilityId);
    const categories = await this.prisma.inventoryCategory.findMany({ where: { facilityId }, select: { id: true, domain: true, slug: true } });
    const categoryId = (domain: InventoryDomain, slug: string | null) =>
      (slug ? categories.find((c) => c.domain === domain && c.slug === slug)?.id : undefined) ?? null;

    const locationIds = new Map<string, string>();
    const ensureLocation = async (code: string, name: string, kind: InventoryLocationKind, departmentId?: string) => {
      const cached = locationIds.get(code);
      if (cached) return cached;
      const location = await this.prisma.inventoryLocation.upsert({
        where: { facilityId_code: { facilityId, code } },
        create: { organizationId, facilityId, code, name, kind, departmentId, createdBy: scope.userId, updatedBy: scope.userId },
        update: {},
      });
      locationIds.set(code, location.id);
      return location.id;
    };

    const summary = { barItems: 0, departmentItems: 0, skipped: 0, failed: [] as Array<{ source: string; id: string; error: string }> };

    const linkedBar = new Set((await this.prisma.inventoryItem.findMany({
      where: { facilityId, legacyBarItemId: { not: null } }, select: { legacyBarItemId: true },
    })).map((i) => i.legacyBarItemId));
    const barItems = await this.prisma.barInventoryItem.findMany({ where: { venueId: facilityId }, orderBy: { name: 'asc' } });
    for (const bar of barItems) {
      if (linkedBar.has(bar.id)) { summary.skipped += 1; continue; }
      try {
        const { domain, categorySlug } = mapLegacyBarCategory(bar.category, bar.name);
        const area = bar.area?.trim() || 'Main Bar';
        const locationId = await ensureLocation(`BAR-${slugify(area).toUpperCase()}`, area, 'bar');
        await this.importLegacyItem({
          organizationId, facilityId, locationId, userId: scope.userId,
          data: {
            domain, categoryId: categoryId(domain, categorySlug), name: bar.name, baseUnit: bar.unit || 'ea',
            internalSku: null, vendorSku: bar.sku, supplier: bar.supplier, notes: bar.notes,
            unitCostCents: bar.unitCostCents, legacyBarItemId: bar.id,
          },
          onHand: bar.onHand, par: bar.parLevel, lastCountedAt: bar.lastCountedAt, reference: `bar:${bar.id}`,
        });
        summary.barItems += 1;
      } catch (err) {
        summary.failed.push({ source: 'bar', id: bar.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const linkedDept = new Set((await this.prisma.inventoryItem.findMany({
      where: { facilityId, legacyDepartmentItemId: { not: null } }, select: { legacyDepartmentItemId: true },
    })).map((i) => i.legacyDepartmentItemId));
    const deptItems = await this.prisma.departmentInventoryItem.findMany({
      where: { facilityId }, include: { department: { select: { id: true, code: true, name: true } } }, orderBy: { name: 'asc' },
    });
    for (const d of deptItems) {
      if (linkedDept.has(d.id)) { summary.skipped += 1; continue; }
      try {
        const { domain, categorySlug } = mapLegacyBarCategory(d.category?.toLowerCase() ?? '', d.name);
        const locationId = await ensureLocation(`DEPT-${d.department.code.toUpperCase()}`, d.department.name, 'department', d.department.id);
        await this.importLegacyItem({
          organizationId, facilityId, locationId, userId: scope.userId,
          data: {
            domain, categoryId: categoryId(domain, categorySlug), name: d.name, baseUnit: d.unit || 'ea',
            internalSku: null, vendorSku: d.sku, supplier: null, notes: d.location ? `Legacy location: ${d.location}` : null,
            unitCostCents: d.costCents, legacyDepartmentItemId: d.id, active: d.status !== 'archived',
          },
          onHand: d.onHand, par: d.par, lastCountedAt: null, reference: `department:${d.id}`,
        });
        summary.departmentItems += 1;
      } catch (err) {
        summary.failed.push({ source: 'department', id: d.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.logger.log(`Legacy inventory migration for ${facilityId}: ${JSON.stringify({ ...summary, failed: summary.failed.length })}`);
    return summary;
  }

  private importLegacyItem(args: {
    organizationId: string; facilityId: string; locationId: string; userId: string;
    data: {
      domain: InventoryDomain; categoryId: string | null; name: string; baseUnit: string; internalSku: null;
      vendorSku: string | null; supplier: string | null; notes: string | null; unitCostCents: number | null;
      legacyBarItemId?: string; legacyDepartmentItemId?: string; active?: boolean;
    };
    onHand: number; par: number; lastCountedAt: Date | null; reference: string;
  }) {
    const { organizationId, facilityId, locationId, userId, data } = args;
    return withSerializableRetry(this.prisma, async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          organizationId, facilityId, ...data, active: data.active ?? true,
          normalizedName: normalizeItemName(data.name), lastCostCents: data.unitCostCents,
          createdBy: userId, updatedBy: userId,
        },
      });
      await tx.inventoryBalance.create({
        data: {
          organizationId, facilityId, itemId: item.id, locationId,
          par: args.par > 0 ? roundQuantity(args.par) : null, lastCountedAt: args.lastCountedAt,
        },
      });
      // Negative legacy balances (possible in the old Float tables) are not
      // carried as stock; the item lands at zero and a manager recounts it.
      const opening = roundQuantity(args.onHand);
      if (opening.gt(0)) {
        await this.ledger.apply(tx, {
          organizationId, facilityId, itemId: item.id, locationId, userId, type: 'opening_balance',
          quantity: opening, referenceType: 'legacy_migration', referenceId: args.reference,
          idempotencyKey: `legacy:${args.reference}`, note: 'Opening balance migrated from legacy inventory',
        });
      }
      return item;
    });
  }
}

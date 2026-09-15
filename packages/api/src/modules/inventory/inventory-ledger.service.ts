import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializableRetry } from '../../common/tx-retry';
import { MovementError, computeMovement, type MovementType } from './inventory-movement';

type TxClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

export interface LedgerMovement {
  organizationId: string;
  facilityId: string;
  itemId: string;
  locationId: string;
  userId?: string | null;
  type: MovementType;
  quantity: Prisma.Decimal.Value;
  reasonCode?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Same key → same transaction, never a second movement. */
  idempotencyKey?: string | null;
  note?: string | null;
  unitCostCents?: Prisma.Decimal.Value | null;
  allowNegative?: boolean;
}

/**
 * The only code path that changes an InventoryBalance. Each movement locks the
 * balance row, derives before/after/delta from the locked value, and writes the
 * append-only transaction in the same Serializable transaction, so concurrent
 * counts, transfers and POS depletion cannot lose an update.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Applies one movement in its own transaction. */
  record(movement: LedgerMovement) {
    return withSerializableRetry(this.prisma, (tx) => this.apply(tx, movement));
  }

  /** Applies several movements atomically: all land or none do. */
  recordMany(movements: LedgerMovement[]) {
    return withSerializableRetry(this.prisma, async (tx) => {
      const results = [];
      for (const movement of movements) results.push(await this.apply(tx, movement));
      return results;
    });
  }

  async apply(tx: TxClient, m: LedgerMovement) {
    if (m.idempotencyKey) {
      const replay = await tx.inventoryTransaction.findUnique({
        where: { facilityId_idempotencyKey: { facilityId: m.facilityId, idempotencyKey: m.idempotencyKey } },
      });
      if (replay) {
        if (replay.itemId !== m.itemId || replay.locationId !== m.locationId || replay.type !== m.type) {
          throw new ConflictException('This idempotency key was already used for a different movement');
        }
        return { transaction: replay, replayed: true as const };
      }
    }

    const [item, location] = await Promise.all([
      tx.inventoryItem.findFirst({ where: { id: m.itemId, facilityId: m.facilityId }, select: { id: true, active: true, unitCostCents: true } }),
      tx.inventoryLocation.findFirst({ where: { id: m.locationId, facilityId: m.facilityId }, select: { id: true, active: true } }),
    ]);
    if (!item) throw new NotFoundException('Inventory item not found');
    if (!location) throw new NotFoundException('Inventory location not found');
    if (!location.active) throw new BadRequestException('Location is inactive');
    if (!item.active && !['opening_balance', 'count_adjustment', 'equipment_retirement'].includes(m.type)) {
      throw new BadRequestException('Item is archived');
    }

    await tx.inventoryBalance.upsert({
      where: { itemId_locationId: { itemId: m.itemId, locationId: m.locationId } },
      create: { organizationId: m.organizationId, facilityId: m.facilityId, itemId: m.itemId, locationId: m.locationId },
      update: {},
    });
    const [locked] = await tx.$queryRaw<{ id: string; onHand: Prisma.Decimal }[]>`
      SELECT "id", "onHand" FROM "InventoryBalance"
      WHERE "itemId" = ${m.itemId} AND "locationId" = ${m.locationId}
      FOR UPDATE`;

    const unitCostCents = m.unitCostCents ?? item.unitCostCents;
    let result;
    try {
      result = computeMovement(locked.onHand, {
        type: m.type,
        quantity: m.quantity,
        reasonCode: m.reasonCode,
        allowNegative: m.allowNegative,
        unitCostCents,
      });
    } catch (err) {
      if (err instanceof MovementError) {
        throw err.code === 'negative_stock' ? new ConflictException(err.message) : new BadRequestException(err.message);
      }
      throw err;
    }

    const now = new Date();
    const balance = await tx.inventoryBalance.update({
      where: { id: locked.id },
      data: {
        onHand: result.quantityAfter,
        lastMovementAt: now,
        ...(m.type === 'count_adjustment' ? { lastCountedAt: now } : {}),
      },
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        organizationId: m.organizationId,
        facilityId: m.facilityId,
        itemId: m.itemId,
        locationId: m.locationId,
        userId: m.userId ?? null,
        type: m.type,
        quantityBefore: result.quantityBefore,
        quantityAfter: result.quantityAfter,
        quantityDelta: result.quantityDelta,
        unitCostCents: unitCostCents ?? null,
        valueDeltaCents: result.valueDeltaCents,
        reasonCode: m.reasonCode?.trim() || null,
        referenceType: m.referenceType ?? null,
        referenceId: m.referenceId ?? null,
        idempotencyKey: m.idempotencyKey ?? null,
        note: m.note?.trim() || null,
      },
    });
    return { transaction, balance, replayed: false as const };
  }
}

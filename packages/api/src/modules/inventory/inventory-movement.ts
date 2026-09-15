import { Prisma } from '@prisma/client';

/**
 * Pure, DB-free ledger arithmetic. InventoryLedgerService applies the result
 * inside a Serializable transaction; keeping the maths here lets every rule
 * that decides a balance be unit-tested without a database.
 */

type Decimal = Prisma.Decimal;
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Quantities are stored at 4 decimal places (Decimal(14,4)). */
export const QUANTITY_SCALE = 4;

export const INBOUND_TYPES = [
  'opening_balance', 'receive', 'transfer_in', 'event_return', 'vendor_credit', 'equipment_checkin',
] as const;

export const OUTBOUND_TYPES = [
  'transfer_out', 'waste', 'spoilage', 'breakage', 'spill', 'return_to_vendor', 'event_issue',
  'pos_estimated_depletion', 'equipment_checkout', 'equipment_loss', 'equipment_retirement',
] as const;

/** Signed: the caller supplies the delta, positive or negative. */
export const SIGNED_TYPES = ['manual_adjustment'] as const;

/** Absolute: the caller supplies the counted quantity; the delta is derived. */
export const ABSOLUTE_TYPES = ['count_adjustment'] as const;

export type MovementType =
  | (typeof INBOUND_TYPES)[number]
  | (typeof OUTBOUND_TYPES)[number]
  | (typeof SIGNED_TYPES)[number]
  | (typeof ABSOLUTE_TYPES)[number];

/** Types that reduce stock for a reason operators must be able to report on separately. */
export const LOSS_TYPES: ReadonlySet<MovementType> = new Set([
  'waste', 'spoilage', 'breakage', 'spill', 'equipment_loss',
]);

/** Movements that must carry a reason code, per the brief's adjustment rules. */
export const REASON_REQUIRED_TYPES: ReadonlySet<MovementType> = new Set([
  'manual_adjustment', 'count_adjustment', ...LOSS_TYPES,
]);

export class MovementError extends Error {
  constructor(message: string, readonly code: 'invalid_quantity' | 'negative_stock' | 'reason_required') {
    super(message);
  }
}

export interface MovementInput {
  type: MovementType;
  /** Positive magnitude for inbound/outbound, signed for manual, absolute for counts. */
  quantity: Prisma.Decimal.Value;
  reasonCode?: string | null;
  allowNegative?: boolean;
  unitCostCents?: Prisma.Decimal.Value | null;
}

export interface MovementResult {
  quantityBefore: Decimal;
  quantityAfter: Decimal;
  quantityDelta: Decimal;
  valueDeltaCents: Decimal | null;
}

export function roundQuantity(value: Prisma.Decimal.Value): Decimal {
  return D(value).toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function computeMovement(before: Prisma.Decimal.Value, input: MovementInput): MovementResult {
  const quantityBefore = roundQuantity(before);
  const quantity = roundQuantity(input.quantity);
  if (!quantity.isFinite()) throw new MovementError('Quantity must be a number', 'invalid_quantity');

  if (REASON_REQUIRED_TYPES.has(input.type) && !input.reasonCode?.trim()) {
    throw new MovementError(`A reason is required for ${input.type.replace(/_/g, ' ')}`, 'reason_required');
  }

  let quantityDelta: Decimal;
  if ((INBOUND_TYPES as readonly string[]).includes(input.type)) {
    if (quantity.lte(0)) throw new MovementError('Quantity must be greater than zero', 'invalid_quantity');
    quantityDelta = quantity;
  } else if ((OUTBOUND_TYPES as readonly string[]).includes(input.type)) {
    if (quantity.lte(0)) throw new MovementError('Quantity must be greater than zero', 'invalid_quantity');
    quantityDelta = quantity.negated();
  } else if ((ABSOLUTE_TYPES as readonly string[]).includes(input.type)) {
    if (quantity.lt(0)) throw new MovementError('A counted quantity cannot be negative', 'invalid_quantity');
    quantityDelta = quantity.minus(quantityBefore);
  } else {
    if (quantity.isZero()) throw new MovementError('Adjustment cannot be zero', 'invalid_quantity');
    quantityDelta = quantity;
  }

  const quantityAfter = quantityBefore.plus(quantityDelta);
  // Refuse rather than clamp: the legacy tables silently floored at zero,
  // which hid shortages and broke before/after traceability.
  if (quantityAfter.lt(0) && !input.allowNegative) {
    throw new MovementError(
      `Only ${quantityBefore.toString()} on hand; this would leave ${quantityAfter.toString()}`,
      'negative_stock',
    );
  }

  const valueDeltaCents = input.unitCostCents == null
    ? null
    : quantityDelta.times(D(input.unitCostCents)).toDecimalPlaces(QUANTITY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

  return { quantityBefore, quantityAfter, quantityDelta, valueDeltaCents };
}

export type StockStatus = 'out' | 'critical' | 'low' | 'ok' | 'untracked';

/** Critical below half of par, low at or below par, out at zero. */
export function stockStatus(onHand: Prisma.Decimal.Value, par: Prisma.Decimal.Value | null | undefined): StockStatus {
  const qty = D(onHand);
  if (qty.lte(0)) return 'out';
  if (par == null) return 'untracked';
  const p = D(par);
  if (p.lte(0)) return 'untracked';
  if (qty.lt(p.dividedBy(2))) return 'critical';
  if (qty.lte(p)) return 'low';
  return 'ok';
}

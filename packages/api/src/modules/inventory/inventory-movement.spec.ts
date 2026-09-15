import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { MovementError, computeMovement, roundQuantity, stockStatus } from './inventory-movement';

const str = (d: Prisma.Decimal | null) => d?.toString() ?? null;

describe('computeMovement', () => {
  it('adds inbound quantities', () => {
    const r = computeMovement('10', { type: 'receive', quantity: '2.5' });
    expect(str(r.quantityDelta)).toBe('2.5');
    expect(str(r.quantityAfter)).toBe('12.5');
  });

  it('subtracts outbound quantities given as a positive magnitude', () => {
    const r = computeMovement('10', { type: 'transfer_out', quantity: 4 });
    expect(str(r.quantityDelta)).toBe('-4');
    expect(str(r.quantityAfter)).toBe('6');
  });

  it('derives the delta from a counted quantity', () => {
    const r = computeMovement('10', { type: 'count_adjustment', quantity: '7.25', reasonCode: 'count_correction' });
    expect(str(r.quantityDelta)).toBe('-2.75');
    expect(str(r.quantityAfter)).toBe('7.25');
  });

  it('accepts a signed manual adjustment in either direction', () => {
    expect(str(computeMovement('3', { type: 'manual_adjustment', quantity: -1, reasonCode: 'x' }).quantityAfter)).toBe('2');
    expect(str(computeMovement('3', { type: 'manual_adjustment', quantity: 1, reasonCode: 'x' }).quantityAfter)).toBe('4');
  });

  it('keeps decimal precision instead of floating-point drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    const r = computeMovement('0.1', { type: 'receive', quantity: '0.2' });
    expect(str(r.quantityAfter)).toBe('0.3');
  });

  it('refuses to take stock negative instead of clamping to zero', () => {
    expect(() => computeMovement('2', { type: 'waste', quantity: 5, reasonCode: 'spoiled' }))
      .toThrowError(expect.objectContaining({ code: 'negative_stock' }));
  });

  it('allows negative stock only when explicitly permitted', () => {
    const r = computeMovement('2', { type: 'pos_estimated_depletion', quantity: 5, allowNegative: true });
    expect(str(r.quantityAfter)).toBe('-3');
  });

  it('requires a reason for losses and adjustments', () => {
    for (const type of ['waste', 'breakage', 'spill', 'spoilage', 'manual_adjustment', 'count_adjustment'] as const) {
      expect(() => computeMovement('10', { type, quantity: 1 }), type).toThrow(MovementError);
    }
    expect(() => computeMovement('10', { type: 'receive', quantity: 1 })).not.toThrow();
  });

  it('rejects zero and non-positive magnitudes', () => {
    expect(() => computeMovement('10', { type: 'receive', quantity: 0 })).toThrow(MovementError);
    expect(() => computeMovement('10', { type: 'transfer_out', quantity: -2 })).toThrow(MovementError);
    expect(() => computeMovement('10', { type: 'manual_adjustment', quantity: 0, reasonCode: 'x' })).toThrow(MovementError);
    expect(() => computeMovement('10', { type: 'count_adjustment', quantity: -1, reasonCode: 'x' })).toThrow(MovementError);
  });

  it('values the movement at unit cost, signed with the delta', () => {
    const r = computeMovement('10', { type: 'waste', quantity: 2, reasonCode: 'spoiled', unitCostCents: '125.5' });
    expect(str(r.valueDeltaCents)).toBe('-251');
    expect(computeMovement('1', { type: 'receive', quantity: 1 }).valueDeltaCents).toBeNull();
  });

  it('rounds quantities to four decimal places', () => {
    expect(roundQuantity('1.23456').toString()).toBe('1.2346');
  });
});

describe('stockStatus', () => {
  it('classifies against par', () => {
    expect(stockStatus(0, 10)).toBe('out');
    expect(stockStatus(4, 10)).toBe('critical');
    expect(stockStatus(10, 10)).toBe('low');
    expect(stockStatus(11, 10)).toBe('ok');
    expect(stockStatus(5, null)).toBe('untracked');
  });
});

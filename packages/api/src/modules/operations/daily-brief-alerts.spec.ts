import { describe, expect, it } from 'vitest';
import { buildDailyBriefAlerts } from './daily-brief-alerts';

const ZERO = { pendingRequestCount: 0, lowStockCount: 0, eightySixCount: 0 };

describe('buildDailyBriefAlerts', () => {
  it('returns an empty list when nothing needs attention', () => {
    expect(buildDailyBriefAlerts(ZERO)).toEqual([]);
  });

  it('singularizes a count of exactly 1 for every alert kind', () => {
    expect(buildDailyBriefAlerts({ ...ZERO, pendingRequestCount: 1 })).toEqual(['1 staff request pending']);
    expect(buildDailyBriefAlerts({ ...ZERO, lowStockCount: 1 })).toEqual(['1 low-stock bar item']);
    expect(buildDailyBriefAlerts({ ...ZERO, eightySixCount: 1 })).toEqual(['1 item on the 86 list']);
  });

  it('pluralizes counts greater than 1', () => {
    expect(buildDailyBriefAlerts({ ...ZERO, pendingRequestCount: 2 })).toEqual(['2 staff requests pending']);
    expect(buildDailyBriefAlerts({ ...ZERO, lowStockCount: 5 })).toEqual(['5 low-stock bar items']);
    expect(buildDailyBriefAlerts({ ...ZERO, eightySixCount: 2 })).toEqual(['2 items on the 86 list']);
  });

  it('omits any alert whose count is zero, keeping only the active ones', () => {
    expect(buildDailyBriefAlerts({ pendingRequestCount: 0, lowStockCount: 1, eightySixCount: 0 }))
      .toEqual(['1 low-stock bar item']);
  });

  it('preserves a fixed, operationally-prioritized order when all are active', () => {
    expect(buildDailyBriefAlerts({ pendingRequestCount: 1, lowStockCount: 1, eightySixCount: 1 })).toEqual([
      '1 staff request pending',
      '1 low-stock bar item',
      '1 item on the 86 list',
    ]);
  });

  it('never emits negative-count phrasing (defensive: treats non-positive as inactive)', () => {
    expect(buildDailyBriefAlerts({ ...ZERO, lowStockCount: -1 })).toEqual([]);
  });
});

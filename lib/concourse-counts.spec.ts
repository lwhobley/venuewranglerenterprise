import { describe, expect, it } from 'vitest';
import { requiredCents, requiredCount } from './concourse-counts';

describe('reconciliation inputs', () => {
  it('requires explicit zero counts instead of silently assuming none', () => {
    expect(() => requiredCount('', 'returns')).toThrow();
    expect(() => requiredCount(undefined, 'returns')).toThrow();
    expect(requiredCount('0', 'returns')).toBe(0);
    expect(requiredCount('2.5', 'returns')).toBe(2.5);
  });
  it.each(['-1', 'NaN', 'Infinity', '12abc', '1e3'])('rejects invalid count %s', value => {
    expect(() => requiredCount(value, 'count')).toThrow();
  });
  it('converts actual tender to cents without truncation', () => {
    expect(requiredCents('10.29', 'cash')).toBe(1029);
    expect(requiredCents('0', 'card')).toBe(0);
  });
  it.each(['', '-1', '1.005', '12abc', 'Infinity', '999999999999999999'])('rejects invalid tender %s', value => {
    expect(() => requiredCents(value, 'cash')).toThrow();
  });
});

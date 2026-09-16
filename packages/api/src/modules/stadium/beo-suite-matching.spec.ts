import { describe, expect, it } from 'vitest';
import { matchSuite, normalizeSuiteLabel, suiteNumber, type SuiteCandidate } from './beo-suite-matching';

/**
 * Catering delivered to the wrong suite is worse than a manager being asked
 * which suite was meant, so the property these tests defend is that an
 * ambiguous label never silently resolves.
 */

const SUITES: SuiteCandidate[] = [
  { id: 'sv_312', zoneId: 'zone_300', code: 'S-312', name: 'Suite 312' },
  { id: 'sv_314', zoneId: 'zone_300', code: 'S-314', name: 'Suite 314' },
  { id: 'sv_owner', zoneId: 'zone_300', code: 'OWNERS', name: "Owner's Box" },
];

describe('normalizeSuiteLabel', () => {
  it('strips the casing, punctuation and wording that vary between documents', () => {
    expect(normalizeSuiteLabel('Suite 312')).toBe('312');
    expect(normalizeSuiteLabel('STE-312')).toBe('312');
    expect(normalizeSuiteLabel('  suite   312 ')).toBe('312');
    expect(normalizeSuiteLabel("Owner's Box")).toBe('owners');
  });

  it('is empty for a label with nothing identifying in it', () => {
    expect(normalizeSuiteLabel('')).toBe('');
    expect(normalizeSuiteLabel('  suite  ')).toBe('');
  });
});

describe('suiteNumber', () => {
  it('takes the suite number, not a level or floor sharing the label', () => {
    expect(suiteNumber('Suite 312')).toBe('312');
    expect(suiteNumber('S-312')).toBe('312');
    // The level number appears first in one ordering and last in the other, so
    // neither end of the string is the right answer on its own.
    expect(suiteNumber('Level 3 Suite 312')).toBe('312');
    expect(suiteNumber('Suite #314 (Level 3)')).toBe('314');
  });

  it('is null when the label carries no number', () => {
    expect(suiteNumber("Owner's Box")).toBeNull();
  });
});

describe('matchSuite', () => {
  it('matches the venue code however the document spelled it', () => {
    expect(matchSuite('S-312', SUITES).match).toMatchObject({ subVenueId: 'sv_312', confidence: 'exact_code' });
    expect(matchSuite('s312', SUITES).match).toMatchObject({ subVenueId: 'sv_312' });
  });

  it('matches a suite that has no number, by code or name', () => {
    // 'OWNERS' and "Owner's Box" normalize alike, so the code tier resolves it.
    expect(matchSuite("Owner's Box", SUITES).match).toMatchObject({
      subVenueId: 'sv_owner',
      confidence: 'exact_code',
    });
  });

  it('matches on name when the code is nothing like the label', () => {
    const suites: SuiteCandidate[] = [{ id: 'sv_fl', zoneId: 'z', code: 'X-9', name: 'Founders Lounge' }];
    expect(matchSuite('Founders Lounge', suites).match).toMatchObject({
      subVenueId: 'sv_fl',
      confidence: 'exact_name',
    });
  });

  it('falls back to the suite number when neither code nor name matches outright', () => {
    expect(matchSuite('Suite #314 (Level 3)', SUITES).match).toMatchObject({
      subVenueId: 'sv_314',
      confidence: 'number',
    });
  });

  it('returns no match for a suite the venue does not have', () => {
    const result = matchSuite('Suite 999', SUITES);
    expect(result.match).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('returns no match for an empty or meaningless label', () => {
    expect(matchSuite('', SUITES).match).toBeNull();
    expect(matchSuite('suite', SUITES).match).toBeNull();
  });

  it('refuses to guess between two suites that fit equally, and hands both back', () => {
    const twins: SuiteCandidate[] = [
      { id: 'sv_a', zoneId: 'zone_300', code: 'A-312', name: 'Suite 312' },
      { id: 'sv_b', zoneId: 'zone_400', code: 'B-312', name: 'Suite 312' },
    ];

    const result = matchSuite('Suite 312', twins);

    expect(result.match).toBeNull();
    expect(result.candidates.map((c) => c.id)).toEqual(['sv_a', 'sv_b']);
  });

  it('prefers a code match over a number match that points elsewhere', () => {
    const tricky: SuiteCandidate[] = [
      { id: 'sv_code', zoneId: 'z', code: '312', name: 'Founders Lounge' },
      { id: 'sv_number', zoneId: 'z', code: 'FL-9', name: 'Suite 312' },
    ];

    // '312' is an exact code on one and a number hit on both; the code wins.
    expect(matchSuite('312', tricky).match).toMatchObject({ subVenueId: 'sv_code', confidence: 'exact_code' });
  });
});

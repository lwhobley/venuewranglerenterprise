/**
 * Resolving the suite an uploaded BEO row refers to.
 *
 * A BEO document names its suite however the caterer types it — "Suite 312",
 * "STE-312", "312", "Owner's Box". The venue knows it as a `SubVenue` with a
 * code and a name. This module is the only place that guesses between the two,
 * kept pure so the guess can be tested without a database.
 *
 * It never picks between two equally good candidates: an ambiguous label is
 * returned unmatched with its candidates, for a manager to settle.
 */

export interface SuiteCandidate {
  id: string;
  zoneId: string;
  code: string;
  name: string;
}

export interface SuiteMatch {
  subVenueId: string;
  zoneId: string;
  code: string;
  name: string;
  /** How the label was resolved, so the review screen can say why. */
  confidence: 'exact_code' | 'exact_name' | 'number';
}

export interface SuiteMatchResult {
  match: SuiteMatch | null;
  /** Everything that plausibly fits, for a manager to choose from. */
  candidates: SuiteCandidate[];
}

/**
 * Strips the noise that varies between documents — case, punctuation, spacing,
 * and the word "suite" itself — leaving the part that actually identifies it.
 */
export function normalizeSuiteLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(suite|ste|box|loge)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * The number that identifies the suite, which is what most are known by.
 *
 * Labels often carry a second, shorter number that is not the suite — a level
 * or a floor ("Suite #314 (Level 3)", "Level 3 Suite 312"). The longest run of
 * digits is the suite in both orderings, where "first" or "last" is wrong in
 * one of them; ties break to the last, which reads as the more specific.
 */
export function suiteNumber(value: string): string | null {
  const matches = value.match(/\d+/g);
  if (!matches?.length) return null;
  return matches.reduce((best, current) => (current.length >= best.length ? current : best));
}

function toMatch(candidate: SuiteCandidate, confidence: SuiteMatch['confidence']): SuiteMatch {
  return {
    subVenueId: candidate.id,
    zoneId: candidate.zoneId,
    code: candidate.code,
    name: candidate.name,
    confidence,
  };
}

/**
 * Resolves one label against the venue's suites.
 *
 * Tried in descending order of certainty: the venue's own code, then the full
 * name, then the suite number. A tier that produces more than one hit is
 * ambiguous and stops the search rather than picking arbitrarily — catering for
 * the wrong suite is worse than asking.
 */
export function matchSuite(label: string, candidates: SuiteCandidate[]): SuiteMatchResult {
  const normalized = normalizeSuiteLabel(label ?? '');
  if (!normalized) return { match: null, candidates: [] };

  const byCode = candidates.filter((c) => normalizeSuiteLabel(c.code) === normalized);
  if (byCode.length === 1) return { match: toMatch(byCode[0], 'exact_code'), candidates: byCode };
  if (byCode.length > 1) return { match: null, candidates: byCode };

  const byName = candidates.filter((c) => normalizeSuiteLabel(c.name) === normalized);
  if (byName.length === 1) return { match: toMatch(byName[0], 'exact_name'), candidates: byName };
  if (byName.length > 1) return { match: null, candidates: byName };

  const number = suiteNumber(label ?? '');
  if (number) {
    const byNumber = candidates.filter(
      (c) => suiteNumber(c.code) === number || suiteNumber(c.name) === number
    );
    if (byNumber.length === 1) return { match: toMatch(byNumber[0], 'number'), candidates: byNumber };
    if (byNumber.length > 1) return { match: null, candidates: byNumber };
  }

  return { match: null, candidates: [] };
}

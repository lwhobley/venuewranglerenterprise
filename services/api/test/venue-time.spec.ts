import { describe, expect, it } from 'vitest';
import { formatVenueLocal, isAbsoluteInstant, venueLocalToUtc } from '../src/venue-time';

describe('venue local event time', () => {
  it('converts a winter wall-clock time using the venue offset, not UTC', () => {
    expect(venueLocalToUtc('2027-01-01T20:00', 'America/Chicago').toISOString()).toBe('2027-01-02T02:00:00.000Z');
  });

  it('converts a summer wall-clock time using daylight-saving offset', () => {
    expect(venueLocalToUtc('2026-07-01T19:00', 'America/New_York').toISOString()).toBe('2026-07-01T23:00:00.000Z');
  });

  it('rejects a spring-forward time that does not exist', () => {
    expect(() => venueLocalToUtc('2026-03-08T02:30', 'America/Chicago')).toThrow('does not exist');
  });

  it('rejects a fall-back time that occurs twice', () => {
    expect(() => venueLocalToUtc('2026-11-01T01:30', 'America/Chicago')).toThrow('twice');
  });

  it('formats a stored instant back to the venue wall clock', () => {
    expect(formatVenueLocal(new Date('2027-01-02T02:00:00.000Z'), 'America/Chicago')).toBe('2027-01-01T20:00');
  });

  it('accepts only instants that carry a zone', () => {
    expect(isAbsoluteInstant('2027-01-02T02:00:00.000Z')).toBe(true);
    expect(isAbsoluteInstant('2027-01-01T20:00:00-06:00')).toBe(true);
    expect(isAbsoluteInstant('2027-01-01T20:00')).toBe(false);
  });
});

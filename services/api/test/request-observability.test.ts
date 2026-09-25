import { describe, expect, it } from 'vitest';
import { correlationId } from '../src/request-observability';

describe('request observability helpers', () => {
  it('preserves a bounded, safe correlation id', () => {
    expect(correlationId('req-123_safe')).toBe('req-123_safe');
  });

  it('replaces untrusted or oversized correlation ids', () => {
    expect(correlationId('bad id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationId('x'.repeat(81))).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

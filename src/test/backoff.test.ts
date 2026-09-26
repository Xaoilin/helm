import { describe, expect, it } from 'vitest';
import { backoffDelayMs, retryAfterMs } from '../services/backoff';

describe('backoff', () => {
  const policy = { baseDelayMs: 500, maxDelayMs: 8_000 };

  it('doubles the ceiling per retry up to the maximum, with jitter below it', () => {
    expect([0, 1, 2, 3, 4, 5].map(attempt => backoffDelayMs(attempt, policy, () => 1)))
      .toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(backoffDelayMs(3, policy, () => 0.25)).toBe(1000);
    expect(backoffDelayMs(3, policy, () => 0)).toBe(0);
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(retryAfterMs('3', now)).toBe(3000);
    expect(retryAfterMs('Sat, 26 Sep 2026 12:00:10 GMT', now)).toBe(10_000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs('soon', now)).toBeNull();
  });
});

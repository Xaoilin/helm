/**
 * Exponential backoff with full jitter: each wait is a random point between zero and a ceiling
 * that doubles per attempt, so clients that failed together do not retry together.
 */
export interface BackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
}

/** The wait before retry number `attempt` (0 for the first retry). */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy, random: () => number = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/** A `Retry-After` header (seconds or an HTTP date) in milliseconds; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

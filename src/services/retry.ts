/**
 * Retry with exponential backoff — for transient network failures.
 *
 * Only retries on transient errors (network, 503, 502, 504).
 * Does NOT retry on: 400, 401, 403, 404, 422 (client errors).
 */

import { logWarn } from './logger';

export interface RetryOptions {
  /** Max number of retries (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000). Doubles each retry. */
  initialDelayMs?: number;
  /** Name for logging */
  name?: string;
}

/**
 * Determine if an error is transient (worth retrying).
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) return true; // Network error
  if (error instanceof DOMException && error.name === 'AbortError') return false; // Timeout — don't retry
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('failed to fetch')) return true;
    if (msg.includes('503') || msg.includes('502') || msg.includes('504')) return true;
    if (msg.includes('429')) return true; // Rate limited — retry after backoff
    // Don't retry client errors
    if (msg.includes('401') || msg.includes('403') || msg.includes('400') || msg.includes('404')) return false;
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry.
 *
 * @param fn — async function to execute
 * @param options — retry configuration
 * @returns the result of fn()
 * @throws the last error if all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 1000, name = 'unknown' } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      const delay = initialDelayMs * Math.pow(2, attempt);
      logWarn('Retry', `${name}: attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

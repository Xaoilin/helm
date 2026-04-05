import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../services/circuitBreaker';
import { withRetry } from '../services/retry';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ name: 'test', maxFailures: 3, cooldownMs: 1000 });
  });

  it('should pass through calls when closed', async () => {
    const result = await breaker.call(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('should stay closed after fewer failures than threshold', async () => {
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    // 2 failures < 3 threshold — still closed
    const result = await breaker.call(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('should open after max failures', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    }
    // Circuit is now open — should throw CircuitOpenError
    await expect(breaker.call(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('should transition to half-open after cooldown', async () => {
    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    }

    // Fast-forward past cooldown
    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);

    // isAvailable should be true (half-open)
    expect(breaker.isAvailable).toBe(true);

    vi.useRealTimers();
  });

  it('should close after successful half-open request', async () => {
    // Use a breaker with very short cooldown for testing
    const fastBreaker = new CircuitBreaker({ name: 'fast', maxFailures: 1, cooldownMs: 10 });

    await expect(fastBreaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    // Circuit open
    await expect(fastBreaker.call(async () => 'ok')).rejects.toThrow(CircuitOpenError);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 20));

    // Half-open — this should succeed and close the circuit
    const result = await fastBreaker.call(async () => 'recovered');
    expect(result).toBe('recovered');

    // Now fully closed — should work normally
    const result2 = await fastBreaker.call(async () => 'still ok');
    expect(result2).toBe('still ok');
  });

  it('should re-open if half-open request fails', async () => {
    const fastBreaker = new CircuitBreaker({ name: 'fast', maxFailures: 1, cooldownMs: 10 });

    await expect(fastBreaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 20));

    // Half-open — this fails, should re-open
    await expect(fastBreaker.call(async () => { throw new Error('still broken'); })).rejects.toThrow('still broken');

    // Should be open again
    await expect(fastBreaker.call(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('should reset to closed state', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    }
    breaker.reset();
    const result = await breaker.call(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('should reset failure count on success', async () => {
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    // 2 failures, then success resets counter
    await breaker.call(async () => 'ok');
    // Now 2 more failures should NOT open (counter was reset)
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    await expect(breaker.call(async () => { throw new Error('fail'); })).rejects.toThrow();
    // Still closed (only 2 failures since last success)
    const result = await breaker.call(async () => 'still ok');
    expect(result).toBe('still ok');
  });
});

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const result = await withRetry(async () => 'ok', { name: 'test' });
    expect(result).toBe('ok');
  });

  it('should retry on transient errors', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new TypeError('Failed to fetch');
      return 'ok';
    }, { name: 'test', maxRetries: 3, initialDelayMs: 10 });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('should not retry on client errors (401)', async () => {
    const fn = vi.fn(async () => { throw new Error('401 Unauthorized'); });
    await expect(withRetry(fn, { name: 'test', maxRetries: 3 })).rejects.toThrow('401');
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it('should not retry on client errors (403)', async () => {
    const fn = vi.fn(async () => { throw new Error('403 Forbidden'); });
    await expect(withRetry(fn, { name: 'test', maxRetries: 3 })).rejects.toThrow('403');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not retry on client errors (400)', async () => {
    const fn = vi.fn(async () => { throw new Error('400 Bad Request'); });
    await expect(withRetry(fn, { name: 'test', maxRetries: 3 })).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw last error after all retries exhausted', async () => {
    const fn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(withRetry(fn, { name: 'test', maxRetries: 2, initialDelayMs: 10 })).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('should not retry AbortError (timeout)', async () => {
    const fn = vi.fn(async () => {
      const err = new DOMException('Signal timed out', 'AbortError');
      throw err;
    });
    await expect(withRetry(fn, { name: 'test', maxRetries: 3 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/**
 * Circuit Breaker — prevents cascading failures by fast-failing
 * when an external service is down.
 *
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Service is down, requests fail immediately (fast-fail)
 * - HALF_OPEN: Testing if service recovered (one request goes through)
 *
 * After `maxFailures` consecutive failures, circuit opens for `cooldownMs`.
 * After cooldown, circuit enters half-open state and lets one request through.
 * If that request succeeds, circuit closes. If it fails, circuit re-opens.
 */

import { logWarn } from './logger';

type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Name for logging */
  name: string;
  /** Number of consecutive failures before opening circuit (default: 3) */
  maxFailures?: number;
  /** Time in ms to stay open before trying again (default: 60000) */
  cooldownMs?: number;
}

export interface CircuitCallOptions {
  /** Return false to avoid counting a failure against the circuit breaker. */
  shouldRecordFailure?: (error: unknown) => boolean;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly maxFailures: number;
  private readonly cooldownMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.maxFailures = options.maxFailures ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
  }

  /**
   * Execute a function through the circuit breaker.
   * Returns null if circuit is open (fast-fail).
   * Throws if the function throws and circuit is still closed.
   */
  async call<T>(fn: () => Promise<T>, options: CircuitCallOptions = {}): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'half_open';
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const shouldRecordFailure = options.shouldRecordFailure?.(error) ?? true;
      if (shouldRecordFailure) {
        this.onFailure();
      }
      throw error;
    }
  }

  /**
   * Check if the circuit breaker would allow a request through.
   */
  get isAvailable(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      return Date.now() - this.lastFailureTime >= this.cooldownMs;
    }
    return true; // half_open allows one request
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'half_open') {
      this.state = 'closed';
      logWarn('CircuitBreaker', `${this.name}: circuit closed (service recovered)`);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      this.state = 'open';
      logWarn('CircuitBreaker', `${this.name}: circuit re-opened (still failing)`);
    } else if (this.failures >= this.maxFailures) {
      this.state = 'open';
      logWarn('CircuitBreaker', `${this.name}: circuit opened after ${this.failures} failures`);
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(serviceName: string) {
    super(`Circuit breaker open for ${serviceName} — service temporarily unavailable`);
    this.name = 'CircuitOpenError';
  }
}

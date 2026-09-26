/**
 * Authenticated JSON calls to the Spring Boot services. The signed-in user's Supabase access
 * token is the only credential; every response is checked against its contract schema.
 *
 * Session rules: the token is renewed before it expires, and a 401 renews the session and retries
 * once. A service call never signs the user out; only the auth server ending the session does.
 *
 * Availability rules (`SERVICE_RETRY`): a transient failure (network, timeout, 429, 502, 503, 504)
 * is retried with exponential backoff and jitter, honouring `Retry-After`. Reads always retry;
 * writes only with an Idempotency-Key. After repeated failures a service's circuit opens and
 * every call to it fails fast until a cool-down passes, so a struggling service is not hammered.
 */
import type { z } from 'zod';
import { API_TIMEOUT, SERVICE_RETRY } from '../../config/constants';
import { getFreshAccessToken, SessionUnavailableError } from '../../store/supabase';
import { backoffDelayMs, retryAfterMs } from '../backoff';
import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker';
import { apiErrorSchema } from './contracts';

/** A failed service call. `code` is the service's error code, or a client-side reason. */
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  /** How long the service asked callers to wait (`Retry-After`), when it said. */
  readonly retryAfterMs: number | null;

  constructor(status: number, code: string, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const TRANSIENT_STATUSES = new Set([0, 429, 502, 503, 504]);

/** Whether a failed call may succeed if repeated shortly. */
export function isTransientServiceError(error: unknown): boolean {
  return error instanceof ServiceError && TRANSIENT_STATUSES.has(error.status);
}

/** One circuit per service base URL, shared by every caller of that service. */
const breakers = new Map<string, CircuitBreaker>();

function breakerFor(baseUrl: string): CircuitBreaker {
  let breaker = breakers.get(baseUrl);
  if (!breaker) {
    breaker = new CircuitBreaker({
      name: baseUrl,
      maxFailures: SERVICE_RETRY.BREAKER_FAILURES,
      cooldownMs: SERVICE_RETRY.BREAKER_COOLDOWN_MS,
    });
    breakers.set(baseUrl, breaker);
  }
  return breaker;
}

/** Closes every circuit; for tests. */
export function resetServiceCircuits(): void {
  breakers.clear();
}

export interface CallOptions {
  /** Names the user action a write performs; the service applies a repeated key once. */
  idempotencyKey?: string;
  /** Overrides the default timeout, for calls that wait on Google. */
  timeoutMs?: number;
}

export async function callService<T>(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
  options: CallOptions = {},
): Promise<T> {
  const base = baseUrl.trim().replace(/\/+$/u, '');
  const url = `${base}${path}`;
  const breaker = breakerFor(base);
  const retryable = method === 'GET' || Boolean(options.idempotencyKey);
  const startedAt = Date.now();
  for (let retry = 0; ; retry += 1) {
    let response: Response;
    try {
      response = await breaker.call(() => attempt(url, method, body, options), {
        shouldRecordFailure: isTransientServiceError,
      });
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new ServiceError(503, 'service_unavailable',
          'This service is temporarily unavailable; Sabah One will try again shortly.');
      }
      const delay = error instanceof ServiceError ? nextDelay(error, retry, retryable, startedAt) : null;
      if (delay === null) throw error;
      await sleep(delay);
      continue;
    }
    if (response.status === 204 || schema === null) return undefined as T;
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ServiceError(response.status, 'contract_violation',
        `The service returned an unexpected response for ${method} ${path}.`);
    }
    return parsed.data;
  }
}

/** One request, including the single session renewal after a 401; a failure is a ServiceError. */
async function attempt(url: string, method: HttpMethod, body: unknown, options: CallOptions): Promise<Response> {
  let response = await send(url, method, await accessToken(false), body, options);
  if (response.status === 401) {
    // The token was rejected (expired in a sleeping tab, or revoked): renew once and retry.
    // A 401 is refused before the request is handled, so the retry cannot apply a write twice.
    response = await send(url, method, await accessToken(true), body, options);
  }
  if (!response.ok) throw await toServiceError(response);
  return response;
}

/** How long to wait before retrying, or null to give up. */
function nextDelay(error: ServiceError, retry: number, retryable: boolean, startedAt: number): number | null {
  if (!retryable || !isTransientServiceError(error) || retry >= SERVICE_RETRY.MAX_RETRIES) return null;
  const delay = Math.min(SERVICE_RETRY.MAX_DELAY_MS, Math.max(
    backoffDelayMs(retry, { baseDelayMs: SERVICE_RETRY.BASE_DELAY_MS, maxDelayMs: SERVICE_RETRY.MAX_DELAY_MS }),
    error.retryAfterMs ?? 0,
  ));
  return Date.now() - startedAt + delay > SERVICE_RETRY.BUDGET_MS ? null : delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function accessToken(forceRefresh: boolean): Promise<string> {
  let token: string | null;
  try {
    token = await getFreshAccessToken({ forceRefresh });
  } catch (error) {
    if (error instanceof SessionUnavailableError) {
      throw new ServiceError(0, 'session_unavailable', 'Your session could not be renewed right now; try again shortly.');
    }
    throw error;
  }
  if (!token) throw new ServiceError(401, 'not_signed_in', 'Sign in to Sabah One to continue.');
  return token;
}

async function send(
  url: string,
  method: HttpMethod,
  token: string,
  body: unknown,
  options: CallOptions,
): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT.SERVICE_API),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new ServiceError(0, timedOut ? 'timeout' : 'network', timedOut
      ? 'The service did not respond in time.'
      : 'The service could not be reached.');
  }
}

async function toServiceError(response: Response): Promise<ServiceError> {
  const retryAfter = retryAfterMs(response.headers.get('Retry-After'));
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success
    ? new ServiceError(response.status, parsed.data.code, parsed.data.message, retryAfter)
    : new ServiceError(response.status, 'http_error', `HTTP ${response.status}.`, retryAfter);
}

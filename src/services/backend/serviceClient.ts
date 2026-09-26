/**
 * Authenticated JSON calls to the Spring Boot services. The signed-in user's Supabase access
 * token is the only credential; every response is checked against its contract schema.
 *
 * Session rules: the token is renewed before it expires, and a 401 renews the session and retries
 * once. A service call never signs the user out; only the auth server ending the session does.
 */
import type { z } from 'zod';
import { API_TIMEOUT } from '../../config/constants';
import { getFreshAccessToken, SessionUnavailableError } from '../../store/supabase';
import { apiErrorSchema } from './contracts';

/** A failed service call. `code` is the service's error code, or a client-side reason. */
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  const url = `${baseUrl.trim().replace(/\/+$/u, '')}${path}`;
  let response = await send(url, method, await accessToken(false), body, options);
  if (response.status === 401) {
    // The token was rejected (expired in a sleeping tab, or revoked): renew once and retry.
    // A 401 is refused before the request is handled, so the retry cannot apply a write twice.
    response = await send(url, method, await accessToken(true), body, options);
  }

  if (!response.ok) throw await toServiceError(response);
  if (response.status === 204 || schema === null) return undefined as T;

  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ServiceError(response.status, 'contract_violation',
      `The service returned an unexpected response for ${method} ${path}.`);
  }
  return parsed.data;
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
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success
    ? new ServiceError(response.status, parsed.data.code, parsed.data.message)
    : new ServiceError(response.status, 'http_error', `HTTP ${response.status}.`);
}

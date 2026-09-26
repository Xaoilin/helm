/**
 * Authenticated JSON calls to the Spring Boot services. The signed-in user's Supabase access
 * token is the only credential; every response is checked against its contract schema.
 */
import type { z } from 'zod';
import { API_TIMEOUT } from '../../config/constants';
import { getCurrentAccessToken } from '../../store/supabase';
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

export async function callService<T>(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  schema: z.ZodType<T> | null,
  body?: unknown,
): Promise<T> {
  const accessToken = getCurrentAccessToken();
  if (!accessToken) throw new ServiceError(401, 'not_signed_in', 'Sign in to load your prayer data.');

  let response: Response;
  try {
    response = await fetch(`${baseUrl.trim().replace(/\/+$/u, '')}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT.SERVICE_API),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new ServiceError(0, timedOut ? 'timeout' : 'network', timedOut
      ? 'The service did not respond in time.'
      : 'The service could not be reached.');
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

async function toServiceError(response: Response): Promise<ServiceError> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success
    ? new ServiceError(response.status, parsed.data.code, parsed.data.message)
    : new ServiceError(response.status, 'http_error', `HTTP ${response.status}.`);
}

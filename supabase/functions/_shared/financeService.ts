// Calls the finance service (`/api/finance/v1`) with the agent's own OAuth token. The service rechecks
// the agent's Finance or Equity approval on every request; each write carries the tool's requestId as
// its Idempotency-Key, so an exact retry is applied once.

const FINANCE_API_URL = (Deno.env.get('SABAH_ONE_FINANCE_API_URL') || 'https://57.129.161.248').replace(/\/+$/, '');
const FINANCE_BASE_URL = `${FINANCE_API_URL}/api/finance/v1`;
const FINANCE_TIMEOUT_MS = 15_000;
const AGENT_NOT_APPROVED = 'agent_not_approved';

type QueryValue = string | number | undefined;

export interface FinanceCall {
  method: 'GET' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  requestId?: string;
}

/** A refused or failed finance-service call; `status` 0 means the service could not be reached. */
export class FinanceServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'FinanceServiceError';
  }
}

/** Whether the agent may use this part of the finance service right now. */
export type FinanceAccess = 'approved' | 'not_approved' | 'invalid_token' | 'unavailable';

export function financeUrl(path: string, query: Record<string, QueryValue> = {}): URL {
  const url = new URL(`${FINANCE_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export const segment = (value: string) => encodeURIComponent(value);

async function readError(response: Response): Promise<{ code: string; message?: string }> {
  try {
    const body = await response.json();
    return {
      code: typeof body?.code === 'string' ? body.code : 'http_error',
      message: typeof body?.message === 'string' && body.message ? body.message : undefined,
    };
  } catch {
    return { code: 'http_error' };
  }
}

export async function callFinance(token: string, rejected: string, call: FinanceCall): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (call.requestId) headers['Idempotency-Key'] = call.requestId;
  if (call.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(financeUrl(call.path, call.query), {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(FINANCE_TIMEOUT_MS),
    });
  } catch {
    throw new FinanceServiceError(0, 'unreachable', rejected);
  }
  if (!response.ok) {
    const error = await readError(response);
    throw new FinanceServiceError(response.status, error.code, error.message ?? rejected);
  }
  return response.status === 204 ? null : await response.json();
}

/** One cheap read decides access: the service refuses an unapproved agent with 403 agent_not_approved. */
export async function probeFinanceAccess(token: string, call: FinanceCall): Promise<FinanceAccess> {
  try {
    await callFinance(token, 'Access check failed.', call);
    return 'approved';
  } catch (error) {
    if (!(error instanceof FinanceServiceError)) return 'unavailable';
    if (error.status === 403 || error.code === AGENT_NOT_APPROVED) return 'not_approved';
    if (error.status === 401) return 'invalid_token';
    return 'unavailable';
  }
}

export function toolResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
  };
}

export function toolFailure(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

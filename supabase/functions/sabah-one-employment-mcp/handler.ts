import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import { createMcpHandler, McpServer, type AuthInfo } from 'npm:@modelcontextprotocol/server@2.0.0';
import { z } from 'npm:zod@4.4.3';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';
import { probeServiceAccess } from '../_shared/serviceAccess.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1/sabah-one-employment-mcp`;
const RESOURCE_URL = `${FUNCTION_BASE_URL}/mcp`;
const RESOURCE_METADATA_URL = `${FUNCTION_BASE_URL}/.well-known/oauth-protected-resource`;
const LIFE_API_URL = (Deno.env.get('SABAH_ONE_LIFE_API_URL') || 'https://51.38.83.48').replace(/\/+$/, '');
const LIFE_JOBS_URL = `${LIFE_API_URL}/api/life/v1/jobs`;
const LIFE_TIMEOUT_MS = 15_000;
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('SABAH_ONE_MCP_ALLOWED_ORIGINS') || [
    'https://xaoilin.github.io', 'http://localhost:5173', 'http://localhost:5174',
  ].join(',')).split(',').map(origin => origin.trim()).filter(Boolean),
);

const idSchema = z.string().trim().min(1).max(256);
const requestIdSchema = z.uuid().describe(
  'Required idempotency key. Reuse the same UUID and exact input when retrying a write; use a new UUID for new evidence.',
);
const statusSchema = z.enum(['lead', 'recruiter', 'applied', 'interview', 'offer', 'closed']);
const workTypeSchema = z.enum(['contract', 'permanent', 'unknown']);
const remoteStatusSchema = z.enum(['confirmed', 'needs_verification']);
const dateSchema = z.iso.date().refine(value => !value.startsWith('0000-'), 'Calendar years must be 0001 or later.')
  .describe('Confirmed local calendar date, YYYY-MM-DD. Omit when the source does not supply a date.');
const urlSchema = z.string().trim().min(1).max(2_048).refine(value => {
  try {
    const url = new URL(value);
    return /^https?:\/\/[^\s/]+[^\s]*$/.test(value) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Use a valid HTTP or HTTPS evidence URL without embedded credentials.');
// Pretty JSON adds at least the separators used by PostgreSQL's jsonb text
// representation, so this conservative cap stays within the RPC's 256 KiB cap.
const withinPayloadLimit = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 1)).byteLength <= 262_144;
const historySchema = z.object({
  id: idSchema.optional(),
  kind: z.enum(['application', 'contact', 'document', 'remote_evidence', 'note']),
  date: dateSchema.optional(),
  summary: z.string().trim().min(1).max(500),
  details: z.string().max(4_000).optional(),
  evidenceUrl: urlSchema.optional(),
}).strict().refine(withinPayloadLimit, 'Employment input must fit within 256 KiB.');
const applicationFields = {
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  url: urlSchema.optional(),
  workType: workTypeSchema.optional(),
  remoteRegion: z.enum(['uk', 'emea', 'global', 'unknown']).optional(),
  remoteStatus: remoteStatusSchema.optional(),
  remoteEvidence: z.string().trim().min(1).max(4_000).optional(),
  remoteCaveat: z.string().max(2_000).optional(),
  compensation: z.string().max(500).optional(),
  status: statusSchema.optional(),
  applicationDate: dateSchema.optional(),
  nextAction: z.string().trim().min(1).max(2_000).optional(),
  nextActionDate: dateSchema.optional(),
  notes: z.string().max(8_000).optional(),
};
const applicationSchema = z.object({
  ...applicationFields,
  id: idSchema.optional(),
  history: z.array(historySchema).max(100).optional(),
}).strict().refine(value => value.remoteStatus !== 'confirmed' || (
  value.remoteRegion !== undefined && value.remoteRegion !== 'unknown'
), 'Confirmed remote eligibility requires a known remote region.')
  .refine(withinPayloadLimit, 'Employment input must fit within 256 KiB.');
const patchSchema = z.object({
  ...applicationFields,
  company: applicationFields.company.optional(),
  role: applicationFields.role.optional(),
  url: urlSchema.nullable().optional(),
  remoteCaveat: z.string().max(2_000).nullable().optional(),
  compensation: z.string().max(500).nullable().optional(),
  applicationDate: dateSchema.nullable().optional(),
  nextActionDate: dateSchema.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Supply at least one field to update.')
  .refine(withinPayloadLimit, 'Employment input must fit within 256 KiB.');

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'mcp-protocol-version, mcp-session-id, www-authenticate',
    Vary: 'Origin',
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function oauthChallenge(status: 401 | 403, message: string): Response {
  return jsonResponse({
    error: status === 401 ? 'invalid_token' : 'insufficient_access',
    error_description: message,
  }, status, { 'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}"` });
}

function createUserClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

async function verifyAccess(request: Request): Promise<AuthInfo | Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse({ error: 'Sabah One Employment is not configured.' }, 503);
  const token = request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) return oauthChallenge(401, 'A Sabah One OAuth access token is required.');
  const client = createUserClient(token);
  const { data, error } = await client.auth.getUser(token);
  const claims = decodeJwtClaims(token);
  const clientId = typeof claims?.client_id === 'string' ? claims.client_id : '';
  const expiresAt = typeof claims?.exp === 'number' ? claims.exp : 0;
  if (error || !data.user || !clientId || claims?.sub !== data.user.id) {
    return oauthChallenge(401, 'The Sabah One OAuth access token is invalid.');
  }
  if (expiresAt <= Math.floor(Date.now() / 1_000)) return oauthChallenge(401, 'The Sabah One OAuth access token has expired.');

  // An Inventory approval never authorizes Employment. The life service rechecks this agent's own
  // Employment approval; a one-application read of the job list asks it.
  const access = await probeServiceAccess(lifeUrl('/applications', { limit: 1 }), token);
  if (access === 'not_approved') return oauthChallenge(403, 'This OAuth client is not approved for Sabah One Employment.');
  if (access === 'invalid_token') return oauthChallenge(401, 'The Sabah One OAuth access token is invalid.');
  if (access === 'unavailable') return jsonResponse({ error: 'Sabah One Employment could not verify access.' }, 503);
  return {
    token, clientId, expiresAt,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [],
    resource: new URL(RESOURCE_URL),
    extra: { userId: data.user.id },
  };
}

type QueryValue = string | number | boolean | undefined;

interface LifeCall {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  requestId?: string;
}

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { result: data } };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function lifeUrl(path: string, query: Record<string, QueryValue> = {}): URL {
  const url = new URL(`${LIFE_JOBS_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json();
    return typeof body?.message === 'string' && body.message ? body.message : undefined;
  } catch {
    return undefined;
  }
}

// Forwards the agent's own OAuth token; the Life admin service rechecks the
// Employment approval itself, and writes carry the caller's idempotency key.
async function callLife(token: string, tool: string, call: LifeCall) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (call.requestId) {
    headers['Idempotency-Key'] = call.requestId;
    headers['Content-Type'] = 'application/json';
  }
  const rejected = `Sabah One Employment rejected ${tool}.`;
  try {
    const response = await fetch(lifeUrl(call.path, call.query), {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(LIFE_TIMEOUT_MS),
    });
    if (!response.ok) return toolError((await readErrorMessage(response)) ?? rejected);
    return toolResult(response.status === 204 ? null : await response.json());
  } catch {
    return toolError(rejected);
  }
}

const applicationPath = (applicationId: string) => `/applications/${encodeURIComponent(applicationId)}`;

// The tool clears an optional field with JSON null; the service takes set
// fields plus the names of fields to clear.
function toLifePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) clear.push(key);
    else fields[key] = value;
  }
  return clear.length > 0 ? { ...fields, clear } : fields;
}

function registerEmploymentTools(server: McpServer, token: string): void {
  const readAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
  const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('employment_list_applications', {
    title: 'List Sabah One Employment Applications',
    description: 'Search this account’s job and freelance applications. Match recruiting updates to an existing application before adding one. Results and history are bounded; use offset to page.',
    inputSchema: z.object({
      query: z.string().trim().max(160).default(''),
      status: statusSchema.optional(), workType: workTypeSchema.optional(), remoteStatus: remoteStatusSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10_000).default(0),
    }).strict(),
    annotations: readAnnotations,
  }, input => callLife(token, 'employment_list_applications', {
    method: 'GET', path: '/applications',
    query: {
      query: input.query, status: input.status, workType: input.workType, remoteStatus: input.remoteStatus,
      limit: input.limit, offset: input.offset,
    },
  }));
  server.registerTool('employment_get_application', {
    title: 'Get Sabah One Employment Application',
    description: 'Read one application and its evidence history by exact account-owned ID.',
    inputSchema: z.object({ applicationId: idSchema }).strict(), annotations: readAnnotations,
  }, input => callLife(token, 'employment_get_application', { method: 'GET', path: applicationPath(input.applicationId) }));
  server.registerTool('employment_add_application', {
    title: 'Add Sabah One Employment Application',
    description: 'Record one verified job or freelance lead/application after searching for an existing record. Preserve unknown dates and remote eligibility; a recruiting email is not a confirmed offer. Reuse requestId only for an exact retry.',
    inputSchema: z.object({ requestId: requestIdSchema, application: applicationSchema }).strict(), annotations: writeAnnotations,
  }, input => callLife(token, 'employment_add_application', {
    method: 'POST', path: '/applications', body: input.application, requestId: input.requestId,
  }));
  server.registerTool('employment_update_application', {
    title: 'Update Sabah One Employment Application',
    description: 'Patch an existing job record from verified evidence. Omitted fields and all history are preserved; null clears an optional field. Append source evidence with employment_add_history. Never infer an offer, submission, or date.',
    inputSchema: z.object({ requestId: requestIdSchema, applicationId: idSchema, patch: patchSchema }).strict(), annotations: writeAnnotations,
  }, input => callLife(token, 'employment_update_application', {
    method: 'PATCH', path: applicationPath(input.applicationId), body: toLifePatch(input.patch), requestId: input.requestId,
  }));
  server.registerTool('employment_add_history', {
    title: 'Add Sabah One Employment Evidence',
    description: 'Append a concise sourced recruiting update without changing status or inventing a date. Include the email/job evidence URL when available; repeated history IDs or evidence URLs are deduplicated.',
    inputSchema: z.object({ requestId: requestIdSchema, applicationId: idSchema, history: historySchema }).strict(), annotations: writeAnnotations,
  }, input => callLife(token, 'employment_add_history', {
    method: 'POST', path: `${applicationPath(input.applicationId)}/history`, body: input.history, requestId: input.requestId,
  }));
  server.registerTool('employment_remove_application', {
    title: 'Remove Sabah One Employment Application',
    description: 'Remove one application and its history only after the user explicitly confirms that exact record. A rejection normally means setting status to closed, retaining history.',
    inputSchema: z.object({
      requestId: requestIdSchema, applicationId: idSchema,
      confirmed: z.literal(true).describe('Must reflect explicit user confirmation to remove this exact application.'),
    }).strict(), annotations: { ...writeAnnotations, destructiveHint: true },
  }, input => callLife(token, 'employment_remove_application', {
    method: 'DELETE', path: applicationPath(input.applicationId), query: { confirm: input.confirmed }, requestId: input.requestId,
  }));
}

const mcpHandler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error('A verified Sabah One OAuth access token is required.');
  const server = new McpServer({ name: 'sabah-one-employment', version: '0.1.0' });
  registerEmploymentTools(server, authInfo.token);
  return server;
}, { responseMode: 'json' });

export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return withCors(jsonResponse({
      resource: RESOURCE_URL, resource_name: 'Sabah One Employment',
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'], scopes_supported: ['openid'], deploymentSha: ASSISTANT_DEPLOY_SHA,
    }), origin);
  }
  if (!pathname.endsWith('/mcp')) return withCors(jsonResponse({ error: 'Not found.' }, 404), origin);
  const access = await verifyAccess(request);
  if (access instanceof Response) return withCors(access, origin);
  return withCors(await mcpHandler.fetch(request, { authInfo: access }), origin);
}

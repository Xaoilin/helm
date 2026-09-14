import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import { createMcpHandler, McpServer, type AuthInfo } from 'npm:@modelcontextprotocol/server@2.0.0';
import { z } from 'npm:zod@4.4.3';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1/sabah-one-employment-mcp`;
const RESOURCE_URL = `${FUNCTION_BASE_URL}/mcp`;
const RESOURCE_METADATA_URL = `${FUNCTION_BASE_URL}/.well-known/oauth-protected-resource`;
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

  // An Inventory approval never authorizes Employment. Recheck the independent
  // account/client approval through the same guarded RPC used by each tool.
  const { error: approvalError } = await client.rpc('employment_list_applications', {
    p_query: '', p_status: null, p_limit: 1, p_offset: 0, p_work_type: null, p_remote_status: null,
  });
  if (approvalError) {
    return approvalError.code === '42501'
      ? oauthChallenge(403, 'This OAuth client is not approved for Sabah One Employment.')
      : jsonResponse({ error: 'Sabah One Employment could not verify access.' }, 503);
  }
  return {
    token, clientId, expiresAt,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [],
    resource: new URL(RESOURCE_URL),
    extra: { userId: data.user.id },
  };
}

async function callRpc(client: SupabaseClient, name: string, parameters: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error.message || `Sabah One Employment rejected ${name}.` }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: { result: data },
  };
}

function registerEmploymentTools(server: McpServer, client: SupabaseClient): void {
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
  }, input => callRpc(client, 'employment_list_applications', {
    p_query: input.query, p_status: input.status ?? null, p_limit: input.limit, p_offset: input.offset,
    p_work_type: input.workType ?? null, p_remote_status: input.remoteStatus ?? null,
  }));
  server.registerTool('employment_get_application', {
    title: 'Get Sabah One Employment Application',
    description: 'Read one application and its evidence history by exact account-owned ID.',
    inputSchema: z.object({ applicationId: idSchema }).strict(), annotations: readAnnotations,
  }, input => callRpc(client, 'employment_get_application', { p_application_id: input.applicationId }));
  server.registerTool('employment_add_application', {
    title: 'Add Sabah One Employment Application',
    description: 'Record one verified job or freelance lead/application after searching for an existing record. Preserve unknown dates and remote eligibility; a recruiting email is not a confirmed offer. Reuse requestId only for an exact retry.',
    inputSchema: z.object({ requestId: requestIdSchema, application: applicationSchema }).strict(), annotations: writeAnnotations,
  }, input => callRpc(client, 'employment_add_application', { p_request_id: input.requestId, p_application: input.application }));
  server.registerTool('employment_update_application', {
    title: 'Update Sabah One Employment Application',
    description: 'Patch an existing job record from verified evidence. Omitted fields and all history are preserved; null clears an optional field. Append source evidence with employment_add_history. Never infer an offer, submission, or date.',
    inputSchema: z.object({ requestId: requestIdSchema, applicationId: idSchema, patch: patchSchema }).strict(), annotations: writeAnnotations,
  }, input => callRpc(client, 'employment_update_application', {
    p_request_id: input.requestId, p_application_id: input.applicationId, p_patch: input.patch,
  }));
  server.registerTool('employment_add_history', {
    title: 'Add Sabah One Employment Evidence',
    description: 'Append a concise sourced recruiting update without changing status or inventing a date. Include the email/job evidence URL when available; repeated history IDs or evidence URLs are deduplicated.',
    inputSchema: z.object({ requestId: requestIdSchema, applicationId: idSchema, history: historySchema }).strict(), annotations: writeAnnotations,
  }, input => callRpc(client, 'employment_add_history', {
    p_request_id: input.requestId, p_application_id: input.applicationId, p_history: input.history,
  }));
  server.registerTool('employment_remove_application', {
    title: 'Remove Sabah One Employment Application',
    description: 'Remove one application and its history only after the user explicitly confirms that exact record. A rejection normally means setting status to closed, retaining history.',
    inputSchema: z.object({
      requestId: requestIdSchema, applicationId: idSchema,
      confirmed: z.literal(true).describe('Must reflect explicit user confirmation to remove this exact application.'),
    }).strict(), annotations: { ...writeAnnotations, destructiveHint: true },
  }, input => callRpc(client, 'employment_remove_application', {
    p_request_id: input.requestId, p_application_id: input.applicationId, p_confirm: input.confirmed,
  }));
}

const mcpHandler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error('A verified Sabah One OAuth access token is required.');
  const server = new McpServer({ name: 'sabah-one-employment', version: '0.1.0' });
  registerEmploymentTools(server, createUserClient(authInfo.token));
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

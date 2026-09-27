import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import { createMcpHandler, McpServer, type AuthInfo } from 'npm:@modelcontextprotocol/server@2.0.0';
import { z } from 'npm:zod@4.4.3';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';
import { callFinance, probeFinanceAccess, segment, toolFailure, toolResult, type FinanceCall } from '../_shared/financeService.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1/sabah-one-equity-mcp`;
const RESOURCE_URL = `${FUNCTION_BASE_URL}/mcp`;
const RESOURCE_METADATA_URL = `${FUNCTION_BASE_URL}/.well-known/oauth-protected-resource`;
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('SABAH_ONE_MCP_ALLOWED_ORIGINS') || [
    'https://xaoilin.github.io', 'http://localhost:5173', 'http://localhost:5174',
  ].join(',')).split(',').map(origin => origin.trim()).filter(Boolean),
);

const idSchema = z.string().trim().min(1).max(256);
const requestIdSchema = z.uuid().describe(
  'Required idempotency key. Reuse the same UUID and exact input when retrying a write; use a new UUID for a new change.',
);
const dateSchema = z.iso.date().refine(value => !value.startsWith('0000-'), 'Calendar years must be 0001 or later.');
const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
const textSchema = z.string().max(4_000);
const titleSchema = textSchema.trim().min(1);
const quantitySchema = z.number().int().min(0).max(1_000_000_000_000);
const moneySchema = z.number().min(0).max(1_000_000_000_000);
const urlSchema = z.string().max(2_048).refine(value => {
  try {
    const url = new URL(value);
    return /^https?:\/\/[^\s/]+[^\s]*$/.test(value) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}, 'Use an HTTP or HTTPS source URL without embedded credentials.');
const planSchema = z.object({
  summary: textSchema, status: z.enum(['agreed', 'tentative', 'undecided']),
  waitingFor: textSchema, nextAction: textSchema, reviewMonth: monthSchema.optional(),
}).strict();
const grantSchema = z.object({
  id: idSchema, grantDate: dateSchema, vested: quantitySchema, unvested: quantitySchema,
  strikeUsd: moneySchema, originalExpiry: dateSchema, postEmploymentExpiry: dateSchema.optional(),
  nextVest: z.object({ date: dateSchema, alternateDate: dateSchema.optional(), quantity: quantitySchema, condition: textSchema }).strict().optional(),
}).strict();
const positionFields = {
  company: z.string().trim().min(1).max(200), asOf: dateSchema, ownedShares: quantitySchema,
  stockPlan: planSchema, optionPlan: planSchema, employmentNote: z.string().max(16_000),
  grants: z.array(grantSchema).max(100),
  actions: z.array(z.object({ id: idSchema, title: titleSchema, timing: textSchema, dueDate: dateSchema.optional(), done: z.boolean() }).strict()).max(100),
  details: z.array(z.object({ id: idSchema, title: titleSchema, body: z.string().max(16_000) }).strict()).max(100),
  sources: z.array(z.object({ id: idSchema, label: titleSchema, url: urlSchema, asOf: dateSchema }).strict()).max(100),
  scenario: z.object({ pricesUsd: z.array(moneySchema).max(20), withholdingRate: z.number().min(0).max(1),
    usdToGbp: z.number().positive().max(1_000_000), asOf: dateSchema, notes: z.string().max(16_000) }).strict(),
};
// Pretty JSON conservatively bounds PostgreSQL jsonb's encoded text overhead.
const withinPayloadLimit = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 1)).byteLength <= 262_144;
const draftSchema = z.object(positionFields).strict().refine(withinPayloadLimit, 'Equity input must fit within 256 KiB.');
const addSchema = z.object({ ...positionFields, id: idSchema.optional() }).strict().refine(withinPayloadLimit, 'Equity input must fit within 256 KiB.');
const expectedUpdatedAtSchema = z.string().min(1).max(64).describe('Exact updatedAt from the latest equity_get_position response. Reload after a conflict.');

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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse({ error: 'Sabah One Equity is not configured.' }, 503);
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

  // Inventory, Employment and Finance approval never authorize Equity. The finance service rechecks
  // this client's independent Equity approval on every request; one cheap read asks it now.
  const access = await probeFinanceAccess(token, { method: 'GET', path: '/equity/positions', query: { limit: 1 } });
  if (access === 'not_approved') return oauthChallenge(403, 'This OAuth client is not approved for Sabah One Equity.');
  if (access === 'invalid_token') return oauthChallenge(401, 'The Sabah One OAuth access token is invalid.');
  if (access === 'unavailable') return jsonResponse({ error: 'Sabah One Equity could not verify access.' }, 503);
  return {
    token, clientId, expiresAt,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [],
    resource: new URL(RESOURCE_URL),
    extra: { userId: data.user.id },
  };
}

type Shape = (body: unknown) => unknown;

async function forward(token: string, tool: string, call: FinanceCall, shape: Shape = body => body) {
  try {
    return toolResult(shape(await callFinance(token, `Sabah One Equity rejected ${tool}.`, call)));
  } catch (error) {
    return toolFailure(error, `Sabah One Equity rejected ${tool}.`);
  }
}

const positionPath = (positionId: string) => `/equity/positions/${segment(positionId)}`;

// Tool results keep the receipts agents already rely on: a position read is `{ position }`, and a
// write answers with the position's ID and its saved state (null once removed).
const readReceipt: Shape = position => ({ position });
const writeReceipt: Shape = position => ({ positionId: (position as { id: string }).id, position });
const removalReceipt: Shape = removed => ({ positionId: (removed as { id: string }).id, position: null });

function registerEquityTools(server: McpServer, token: string): void {
  const readAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
  const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('equity_list_positions', {
    title: 'List Sabah One Equity Positions',
    description: 'List this account’s private stock and option planning records. Search by company before adding a position. These are dated records, not live quotes or cash balances.',
    inputSchema: z.object({ query: z.string().trim().max(160).default(''), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10_000).default(0) }).strict(),
    annotations: readAnnotations,
  }, input => forward(token, 'equity_list_positions', {
    method: 'GET', path: '/equity/positions', query: { query: input.query, limit: input.limit, offset: input.offset },
  }, page => ({ ...(page as object), limit: input.limit, offset: input.offset })));
  server.registerTool('equity_get_position', {
    title: 'Get Sabah One Equity Position',
    description: 'Read one account-owned position, distinct stock/option plans, grant details, dated scenarios and sources. Use the returned updatedAt when editing.',
    inputSchema: z.object({ positionId: idSchema }).strict(), annotations: readAnnotations,
  }, input => forward(token, 'equity_get_position', { method: 'GET', path: positionPath(input.positionId) }, readReceipt));
  server.registerTool('equity_add_position', {
    title: 'Add Sabah One Equity Position',
    description: 'Record verified holdings and the user’s plan. Keep owned shares separate from unexercised grants. Never auto-vest, infer a departure deadline, treat scenarios as cash, or place trades. Reuse requestId only for the exact same retry.',
    inputSchema: z.object({ requestId: requestIdSchema, position: addSchema }).strict(), annotations: writeAnnotations,
  }, input => {
    // Without an ID the requestId names the new position, so an exact retry targets the same record.
    const { id, ...position } = input.position;
    return forward(token, 'equity_add_position', {
      method: 'PUT', path: positionPath(id ?? input.requestId), requestId: input.requestId,
      body: { position, expectedUpdatedAt: null },
    }, writeReceipt);
  });
  server.registerTool('equity_update_position', {
    title: 'Update Sabah One Equity Position',
    description: 'Replace one position’s editable details after reading it. Supply the complete draft and exact latest updatedAt, preserving other grants, plans, sources and uncertainties. A stale edit is rejected. No trade or exercise is performed.',
    inputSchema: z.object({ requestId: requestIdSchema, positionId: idSchema, position: draftSchema, expectedUpdatedAt: expectedUpdatedAtSchema }).strict(), annotations: writeAnnotations,
  }, input => forward(token, 'equity_update_position', {
    method: 'PUT', path: positionPath(input.positionId), requestId: input.requestId,
    body: { position: input.position, expectedUpdatedAt: input.expectedUpdatedAt },
  }, writeReceipt));
  server.registerTool('equity_remove_position', {
    title: 'Remove Sabah One Equity Position',
    description: 'Remove this exact planning record only after explicit user confirmation. This does not sell holdings or exercise options.',
    inputSchema: z.object({ requestId: requestIdSchema, positionId: idSchema, expectedUpdatedAt: expectedUpdatedAtSchema,
      confirmed: z.literal(true).describe('Must reflect explicit user confirmation to remove this exact record.') }).strict(),
    annotations: { ...writeAnnotations, destructiveHint: true },
  }, input => forward(token, 'equity_remove_position', {
    method: 'DELETE', path: positionPath(input.positionId), requestId: input.requestId,
    query: { expectedUpdatedAt: input.expectedUpdatedAt },
  }, removalReceipt));
}

const mcpHandler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error('A verified Sabah One OAuth access token is required.');
  const server = new McpServer({ name: 'sabah-one-equity', version: '0.1.0' });
  registerEquityTools(server, authInfo.token);
  return server;
}, { responseMode: 'json' });

export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return withCors(jsonResponse({
      resource: RESOURCE_URL, resource_name: 'Sabah One Equity',
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'], scopes_supported: ['openid'], deploymentSha: ASSISTANT_DEPLOY_SHA,
    }), origin);
  }
  if (!pathname.endsWith('/mcp')) return withCors(jsonResponse({ error: 'Not found.' }, 404), origin);
  const access = await verifyAccess(request);
  if (access instanceof Response) return withCors(access, origin);
  return withCors(await mcpHandler.fetch(request, { authInfo: access }), origin);
}

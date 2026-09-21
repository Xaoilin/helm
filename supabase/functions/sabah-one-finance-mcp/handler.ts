import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import { createMcpHandler, McpServer, type AuthInfo } from 'npm:@modelcontextprotocol/server@2.0.0';
import { z } from 'npm:zod@4.4.3';
import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1/sabah-one-finance-mcp`;
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
const labelSchema = textSchema.trim().min(1);
const signedPence = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const pence = signedPence.nonnegative();
const count = z.number().int().min(0).max(10_000_000);
const urlSchema = z.string().max(2_048).refine(value => {
  try {
    const url = new URL(value);
    return /^https?:\/\/[^\s/?#]+[^\s]*$/.test(value) && !value.includes('\\') && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}, 'Use an HTTP or HTTPS source URL without embedded credentials.');
const sourceSchema = z.object({ id: idSchema, label: labelSchema, url: urlSchema, asOf: dateSchema }).strict();
const loanSchema = z.object({
  id: idSchema, lender: labelSchema, purpose: textSchema, status: z.enum(['active', 'repaid', 'closed']),
  monthlyPaymentPence: pence.optional(), userSharePence: pence.optional(), balancePence: pence.optional(), balanceAsOf: dateSchema.optional(),
  balanceKind: z.enum(['statement', 'settlement', 'estimate', 'unknown']),
  startDate: dateSchema.optional(), endDate: dateSchema.optional(), aprPercent: z.number().min(0).max(1000).optional(),
  settlementPence: pence.optional(), settlementAsOf: dateSchema.optional(), nextPaymentDate: dateSchema.optional(),
  paymentsRemaining: count.optional(), originalPrincipalPence: pence.optional(),
  rateNote: textSchema, notes: textSchema, sourceIds: z.array(idSchema).max(100),
}).strict().refine(value => (value.balancePence === undefined) === (value.balanceAsOf === undefined)
  && (value.settlementPence === undefined) === (value.settlementAsOf === undefined), 'Balances and settlements require their own dates.')
  .refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, 'Loan end precedes its start.');
const monthReviewSchema = z.object({
  month: monthSchema, incomePence: pence, outflowPence: pence, netPence: signedPence, salaryPence: pence,
  categories: z.array(z.object({ label: labelSchema, amountPence: signedPence }).strict()).max(100),
}).strict().refine(value => value.incomePence - value.outflowPence === value.netPence, 'Monthly net must equal income minus outflow.');
const uniqueIds = (entries: { id: string }[]) => new Set(entries.map(entry => entry.id)).size === entries.length;
const draftSchema = z.object({
  asOf: dateSchema, currency: z.literal('GBP'),
  coverage: z.object({ from: dateSchema, to: dateSchema, completeThrough: monthSchema, transactionCount: count, accountCount: count, note: textSchema }).strict()
    .refine(value => value.from <= value.to && value.completeThrough <= value.to.slice(0, 7), 'Coverage dates are inconsistent.'),
  accounts: z.array(z.object({ id: idSchema, label: labelSchema, ownership: z.enum(['personal', 'household']), balancePence: signedPence, asOf: dateSchema }).strict()).max(50).refine(uniqueIds, 'Duplicate account IDs.'),
  months: z.array(monthReviewSchema).max(120).refine(entries => new Set(entries.map(entry => entry.month)).size === entries.length, 'Duplicate months.'),
  budget: z.object({ incomePence: pence, incomeBasis: textSchema,
    essentials: z.array(z.object({ label: labelSchema, amountPence: pence, note: textSchema }).strict()).max(100),
    workCostsPence: pence, workCostsNote: textSchema,
    scenarios: z.array(z.object({ label: labelSchema, status: z.enum(['planned', 'confirmed']), monthlyAdjustmentPence: signedPence, note: textSchema }).strict()).max(50),
  }).strict(),
  opportunities: z.array(z.object({ label: labelSchema, monthlyPence: pence, note: textSchema, suggestedCapPence: pence.optional() }).strict()).max(100),
  loans: z.array(loanSchema).max(50).refine(uniqueIds, 'Duplicate loan IDs.'), notes: z.array(textSchema).max(100),
  sources: z.array(sourceSchema).max(100).refine(uniqueIds, 'Duplicate source IDs.'),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value, null, 1)).byteLength <= 262_144, 'Finance input must fit within 256 KiB.')
  .refine(value => value.loans.every(loan => loan.sourceIds.every(id => value.sources.some(source => source.id === id))), 'Loan references an unknown source.');
const expectedUpdatedAtSchema = z.string().min(1).max(64).nullable().describe('Exact updatedAt from finance_get_review, or null only when no review exists. Reload after a conflict.');

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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse({ error: 'Sabah One Finance is not configured.' }, 503);
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

  // Inventory, Employment and Equity approval never authorize Finance. Recheck the independent
  // account/client approval through the same guarded RPC used by each tool.
  const { error: approvalError } = await client.rpc('finance_get_review');
  if (approvalError) {
    return approvalError.code === '42501'
      ? oauthChallenge(403, 'This OAuth client is not approved for Sabah One Finance.')
      : jsonResponse({ error: 'Sabah One Finance could not verify access.' }, 503);
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
    return { isError: true, content: [{ type: 'text' as const, text: error.message || `Sabah One Finance rejected ${name}.` }] };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: { result: data },
  };
}

function registerFinanceTools(server: McpServer, client: SupabaseClient): void {
  server.registerTool('finance_get_review', {
    title: 'Get Sabah One Banking Review and Loans',
    description: 'Read this account’s current dated banking review, monthly cash flow, budget assumptions, spending opportunities and loans, or null when none exists. Dated information is not a live bank balance. Read before replacing the review.',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, () => callRpc(client, 'finance_get_review', {}));
  server.registerTool('finance_save_review', {
    title: 'Save Sabah One Banking Review and Loans',
    description: 'Replace the complete current private review with source-dated verified information and explicit uncertainty. Amounts are integer pence. Preserve loans and sources; keep household transfers separate to prevent double counting and loan balances separate from settlement quotes. Supply the exact updatedAt from the latest read, or null for the first save. Reuse requestId only for an exact retry. This cannot access banks, move money, change borrowing or make payments.',
    inputSchema: z.object({ requestId: requestIdSchema, review: draftSchema, expectedUpdatedAt: expectedUpdatedAtSchema }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, input => callRpc(client, 'finance_save_review', { p_request_id: input.requestId, p_review: input.review, p_expected_updated_at: input.expectedUpdatedAt }));
}

const mcpHandler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error('A verified Sabah One OAuth access token is required.');
  const server = new McpServer({ name: 'sabah-one-finance', version: '0.1.0' });
  registerFinanceTools(server, createUserClient(authInfo.token));
  return server;
}, { responseMode: 'json' });

export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return withCors(jsonResponse({
      resource: RESOURCE_URL, resource_name: 'Sabah One Finance',
      authorization_servers: [`${SUPABASE_URL}/auth/v1`],
      bearer_methods_supported: ['header'], scopes_supported: ['openid'], deploymentSha: ASSISTANT_DEPLOY_SHA,
    }), origin);
  }
  if (!pathname.endsWith('/mcp')) return withCors(jsonResponse({ error: 'Not found.' }, 404), origin);
  const access = await verifyAccess(request);
  if (access instanceof Response) return withCors(access, origin);
  return withCors(await mcpHandler.fetch(request, { authInfo: access }), origin);
}

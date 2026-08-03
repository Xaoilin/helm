import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.100.1';
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
} from 'npm:@modelcontextprotocol/server@2.0.0';
import { z } from 'npm:zod@4.4.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FUNCTION_BASE_URL = `${SUPABASE_URL}/functions/v1/sabah-one-inventory-mcp`;
const RESOURCE_URL = `${FUNCTION_BASE_URL}/mcp`;
const RESOURCE_METADATA_URL = `${FUNCTION_BASE_URL}/.well-known/oauth-protected-resource`;
const AUTHORIZATION_SERVER_URL = `${SUPABASE_URL}/auth/v1`;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://xaoilin.github.io',
  'http://localhost:5173',
  'http://localhost:5174',
];
const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('SABAH_ONE_MCP_ALLOWED_ORIGINS') || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);

const itemCategorySchema = z.enum([
  'machine',
  'tool',
  'electronics',
  'component',
  'material',
  'consumable',
  'fastener',
  'safety',
  'storage',
  'other',
]);
const quantitySchema = z.number().finite().nonnegative().max(1_000_000_000);
const unitSchema = z.string().trim().min(1).max(32);
const specificationsSchema = z.record(
  z.string().trim().min(1).max(60),
  z.string().trim().min(1).max(200),
).refine(value => Object.keys(value).length <= 30, 'At most 30 specifications are allowed.');
const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(25);
const projectKeysSchema = z.array(z.string().trim().min(1).max(160)).max(25);
const stableIdSchema = z.uuid().optional();
const requestIdSchema = z.uuid().optional().describe(
  'Optional idempotency key. Reuse the same UUID only when retrying the same write.',
);

const itemCandidateSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(160),
  category: itemCategorySchema.default('other'),
  trackingMode: z.enum(['durable', 'counted', 'measured']).default('counted'),
  quantity: quantitySchema,
  unit: unitSchema.default('units'),
  lowStockThreshold: quantitySchema.optional(),
  brand: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  specifications: specificationsSchema.default({}),
  condition: z.enum(['unknown', 'new', 'good', 'worn', 'needs_repair']).default('unknown'),
  location: z.string().trim().min(1).max(160).optional(),
  tags: tagsSchema.default([]),
  notes: z.string().max(4_000).default(''),
  projectCatalogKeys: projectKeysSchema.default([]),
}).strict();

const needCandidateSchema = z.object({
  id: stableIdSchema,
  name: z.string().trim().min(1).max(160),
  linkedItemId: z.string().trim().min(1).max(256).optional(),
  projectCatalogKey: z.string().trim().min(1).max(160).optional(),
  requiredQuantity: quantitySchema.default(1),
  unit: unitSchema.default('units'),
  specifications: specificationsSchema.default({}),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  status: z.enum(['needed', 'ordered']).default('needed'),
  notes: z.string().max(4_000).default(''),
}).strict();

interface VerifiedAccess {
  authInfo: AuthInfo;
  client: SupabaseClient;
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'mcp-protocol-version, mcp-session-id, www-authenticate',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function oauthChallenge(status: 401 | 403, message: string): Response {
  return jsonResponse(
    { error: status === 401 ? 'invalid_token' : 'insufficient_access', error_description: message },
    status,
    {
      'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
    },
  );
}

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

function createUserClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function verifyAccess(request: Request): Promise<VerifiedAccess | Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ error: 'Sabah One Inventory is not configured.' }, 503);
  }
  const token = readBearerToken(request);
  if (!token) return oauthChallenge(401, 'A Sabah One OAuth access token is required.');

  const client = createUserClient(token);
  const { data: userResult, error: userError } = await client.auth.getUser(token);
  const claims = decodeJwtClaims(token);
  const clientId = typeof claims?.client_id === 'string' ? claims.client_id : '';
  const subject = typeof claims?.sub === 'string' ? claims.sub : '';
  const expiresAt = typeof claims?.exp === 'number' ? claims.exp : undefined;
  if (userError || !userResult.user || !claims || !clientId || subject !== userResult.user.id) {
    return oauthChallenge(401, 'The Sabah One OAuth access token is invalid.');
  }
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1_000)) {
    return oauthChallenge(401, 'The Sabah One OAuth access token has expired.');
  }

  // This bounded read doubles as the deny-by-default approval gate. It is
  // evaluated through the same RLS/RPC path that every tool uses.
  const { error: approvalError } = await client.rpc('inventory_search', {
    p_query: '',
    p_project_catalog_key: null,
    p_category: null,
    p_location: null,
    p_limit: 1,
  });
  if (approvalError) {
    if (approvalError.code === '42501') {
      return oauthChallenge(403, 'This OAuth client is not approved for Sabah One Inventory.');
    }
    return jsonResponse({ error: 'Sabah One Inventory could not verify access.' }, 503);
  }

  const scopeClaim = typeof claims.scope === 'string' ? claims.scope : '';
  return {
    client,
    authInfo: {
      token,
      clientId,
      scopes: scopeClaim.split(/\s+/).filter(Boolean),
      expiresAt,
      resource: new URL(RESOURCE_URL),
      extra: { userId: userResult.user.id },
    },
  };
}

async function callRpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw new Error(error.message || `Sabah One Inventory rejected ${name}.`);
  return data;
}

function result(value: unknown) {
  const wrapped = { result: value };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: wrapped,
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'Sabah One Inventory request failed.';
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

function registerInventoryTools(server: McpServer, client: SupabaseClient): void {
  server.registerTool(
    'inventory_search',
    {
      title: 'Search Sabah One Inventory',
      description: 'Search live owned items and open needs, optionally filtered by project, category, or location.',
      inputSchema: z.object({
        query: z.string().trim().max(160).default(''),
        projectCatalogKey: z.string().trim().min(1).max(160).optional(),
        category: itemCategorySchema.optional(),
        location: z.string().trim().min(1).max(160).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }).strict(),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      try {
        return result(await callRpc(client, 'inventory_search', {
          p_query: input.query,
          p_project_catalog_key: input.projectCatalogKey ?? null,
          p_category: input.category ?? null,
          p_location: input.location ?? null,
          p_limit: input.limit,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_check',
    {
      title: 'Check Inventory Stock',
      description: 'Check whether Sabah One has enough of a named item for a required quantity and unit.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(160),
        requiredQuantity: quantitySchema.default(1),
        unit: unitSchema.optional(),
      }).strict(),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      try {
        return result(await callRpc(client, 'inventory_check', {
          p_name: input.name,
          p_required_quantity: input.requiredQuantity,
          p_unit: input.unit ?? null,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_resolve_project',
    {
      title: 'Resolve Sabah One Project',
      description: 'Resolve a project name to minimal catalogue keys for Inventory linking.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(160) }).strict(),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      try {
        return result(await callRpc(client, 'inventory_resolve_project', { p_query: input.query }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_save_items',
    {
      title: 'Save Owned Inventory Items',
      description: 'Save one or more explicitly approved owned items. Multi-item batches require prior review.',
      inputSchema: z.object({
        requestId: requestIdSchema,
        items: z.array(itemCandidateSchema).min(1).max(100),
        reviewed: z.boolean().default(false).describe('Must be true after the user reviews a multi-item batch.'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      if (input.items.length > 1 && !input.reviewed) {
        return failure(new Error('Review the multi-item candidates with the user before saving them.'));
      }
      const timestamp = new Date().toISOString();
      const items = input.items.map(item => ({
        ...item,
        id: item.id ?? crypto.randomUUID(),
        lastVerifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));
      try {
        return result(await callRpc(client, 'inventory_save_items', {
          p_request_id: input.requestId ?? crypto.randomUUID(),
          p_items: items,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_save_need',
    {
      title: 'Save Inventory Need',
      description: 'Save one explicitly requested Inventory need without purchasing or consuming stock.',
      inputSchema: z.object({ requestId: requestIdSchema, need: needCandidateSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      const timestamp = new Date().toISOString();
      const need = {
        ...input.need,
        id: input.need.id ?? crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(input.need.status === 'ordered' ? { orderedAt: timestamp } : {}),
      };
      try {
        return result(await callRpc(client, 'inventory_save_need', {
          p_request_id: input.requestId ?? crypto.randomUUID(),
          p_need: need,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_complete_need',
    {
      title: 'Mark Inventory Need Acquired',
      description: 'Atomically close an open need and add its quantity to linked or newly created owned stock.',
      inputSchema: z.object({
        requestId: requestIdSchema,
        needId: z.string().trim().min(1).max(256),
        newItemId: z.uuid().optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      try {
        return result(await callRpc(client, 'inventory_complete_need', {
          p_request_id: input.requestId ?? crypto.randomUUID(),
          p_need_id: input.needId,
          p_new_item_id: input.newItemId ?? crypto.randomUUID(),
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'inventory_archive_item',
    {
      title: 'Archive Inventory Item',
      description: 'Archive an owned item only after the user explicitly confirms the exact item.',
      inputSchema: z.object({
        requestId: requestIdSchema,
        itemId: z.string().trim().min(1).max(256),
        confirmed: z.literal(true).describe('Proof that the user explicitly confirmed this archive action.'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async input => {
      try {
        return result(await callRpc(client, 'inventory_archive_item', {
          p_request_id: input.requestId ?? crypto.randomUUID(),
          p_item_id: input.itemId,
        }));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

const mcpHandler = createMcpHandler(
  ({ requestInfo }) => {
    const token = requestInfo ? readBearerToken(requestInfo) : null;
    if (!token) throw new Error('A Sabah One OAuth access token is required.');
    const server = new McpServer({ name: 'sabah-one-inventory', version: '0.1.0' });
    registerInventoryTools(server, createUserClient(token));
    return server;
  },
  { responseMode: 'json' },
);

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origin is not allowed.' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return withCors(jsonResponse({
      resource: RESOURCE_URL,
      resource_name: 'Sabah One Inventory',
      authorization_servers: [AUTHORIZATION_SERVER_URL],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid'],
    }), origin);
  }
  if (!pathname.endsWith('/mcp')) {
    return withCors(jsonResponse({ error: 'Not found.' }, 404), origin);
  }

  const access = await verifyAccess(request);
  if (access instanceof Response) return withCors(access, origin);
  return withCors(await mcpHandler.fetch(request, { authInfo: access.authInfo }), origin);
});

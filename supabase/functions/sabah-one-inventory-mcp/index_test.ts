import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://inventory-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SABAH_ONE_LIFE_API_URL', 'https://life-test.example/');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://inventory-test.supabase.co/functions/v1/sabah-one-inventory-mcp';
const userId = '10000000-0000-4000-8000-000000000001';

function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'inventory-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
  return `header.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

interface LifeCall { method: string; path: string; search: string; authorization: string | null }
interface Backend {
  lifeCalls: LifeCall[];
  userError?: boolean;
  /** The life service's answer to the approval check: an HTTP status, or 'unreachable'. */
  approval?: number | 'unreachable';
}

async function withBackend(run: (backend: Backend) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const backend: Backend = { lifeCalls: [] };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://life-test.example') {
      backend.lifeCalls.push({
        method: request.method, path: url.pathname, search: url.search, authorization: request.headers.get('authorization'),
      });
      if (backend.approval === 'unreachable') throw new TypeError('connection refused');
      if (typeof backend.approval === 'number') {
        return Response.json({ code: 'agent_not_approved', message: 'Refused.' }, { status: backend.approval });
      }
      return Response.json({ items: [], needs: [] });
    }
    assert.equal(url.origin, 'https://inventory-test.supabase.co');
    assert.equal(url.pathname, '/auth/v1/user', 'the only Supabase call is the token check');
    return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
      status: backend.userError ? 401 : 200,
    });
  };
  try {
    await run(backend);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function mcp(method: string, params: Record<string, unknown>, accessToken = token()) {
  const response = await handleRequest(new Request(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  const text = await response.text();
  const messages = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
    : [JSON.parse(text)];
  return { response, message: messages.at(-1) };
}

Deno.test('public Inventory metadata names the exact protected resource', async () => {
  const response = await handleRequest(new Request(`${baseUrl}/.well-known/oauth-protected-resource`));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.resource, `${baseUrl}/mcp`);
  assert.equal(metadata.resource_name, 'Sabah One Inventory');
});

Deno.test('requires a valid OAuth user token before checking approval', async () => {
  await withBackend(async backend => {
    const missing = await handleRequest(new Request(`${baseUrl}/mcp`, { method: 'POST' }));
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get('www-authenticate')!, /oauth-protected-resource/);
    await missing.body?.cancel();
    for (const claims of [{ client_id: null }, { sub: 'another-user' }, { exp: 1 }]) {
      const { response } = await mcp('tools/list', {}, token(claims));
      assert.equal(response.status, 401);
    }
    backend.userError = true;
    assert.equal((await mcp('tools/list', {})).response.status, 401);
    assert.deepEqual(backend.lifeCalls, []);
  });
});

Deno.test('checks the agent\'s Inventory approval with the life service and fails closed', async () => {
  await withBackend(async backend => {
    backend.approval = 403;
    const { response: refused, message } = await mcp('tools/list', {});
    assert.equal(refused.status, 403);
    assert.match(refused.headers.get('www-authenticate')!, /oauth-protected-resource/);
    assert.equal(message.error, 'insufficient_access');
    backend.approval = 401;
    assert.equal((await mcp('tools/list', {})).response.status, 401);
    backend.approval = 500;
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    backend.approval = 'unreachable';
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.lifeCalls.length, 4);
    for (const call of backend.lifeCalls) {
      assert.deepEqual([call.method, call.path, call.search], ['GET', '/api/life/v1/inventory/search', '?limit=1']);
      assert.match(call.authorization!, /^Bearer header\./);
    }
  });
});

Deno.test('an approved agent sees exactly the seven Inventory tools', async () => {
  await withBackend(async backend => {
    const { response, message } = await mcp('tools/list', {});
    assert.equal(response.status, 200);
    assert.deepEqual(message.result.tools.map((tool: { name: string }) => tool.name).sort(), [
      'inventory_archive_item', 'inventory_check', 'inventory_complete_need', 'inventory_resolve_project',
      'inventory_save_items', 'inventory_save_need', 'inventory_search',
    ]);
    assert.equal(backend.lifeCalls.length, 1, 'approval is checked once per request');
  });
});

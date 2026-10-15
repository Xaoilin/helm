import assert from 'node:assert/strict';
import inventoryAccess from '../../../contracts/life-service/inventory-access.json' with { type: 'json' };
import jobsAccess from '../../../contracts/life-service/jobs-access.json' with { type: 'json' };
import reviewAccess from '../../../contracts/finance-service/review-access.json' with { type: 'json' };
import equityAccess from '../../../contracts/finance-service/equity-access.json' with { type: 'json' };
import { probeServiceAccess } from './serviceAccess.ts';

Deno.env.set('SUPABASE_URL', 'https://access-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-key');
Deno.env.set('SABAH_ONE_LIFE_API_URL', 'https://life.example.test');
Deno.env.set('SABAH_ONE_FINANCE_API_URL', 'https://finance.example.test');
const handlers = await Promise.all([
  import('../sabah-one-inventory-mcp/handler.ts'), import('../sabah-one-employment-mcp/handler.ts'),
  import('../sabah-one-finance-mcp/handler.ts'), import('../sabah-one-equity-mcp/handler.ts'),
]);
const userId = '10000000-0000-4000-8000-000000000001';
const claims = { sub: userId, client_id: 'synthetic-client', exp: Math.floor(Date.now() / 1000) + 3600, scope: 'openid' };
const token = `header.${btoa(JSON.stringify(claims))}.signature`;
const domains = [
  { name: 'inventory', fixture: inventoryAccess, tool: 'inventory_search', args: { limit: 1 },
    businessPath: '/api/life/v1/inventory/search', body: { items: [], needs: [] } },
  { name: 'employment', fixture: jobsAccess, tool: 'employment_list_applications', args: { limit: 1 },
    businessPath: '/api/life/v1/jobs/applications', body: { applications: [], total: 0, limit: 1, offset: 0 } },
  { name: 'finance', fixture: reviewAccess, tool: 'finance_get_review', args: {},
    businessPath: '/api/finance/v1/review', body: { review: null } },
  { name: 'equity', fixture: equityAccess, tool: 'equity_list_positions', args: { limit: 1 },
    businessPath: '/api/finance/v1/equity/positions', body: { positions: [], total: 0 } },
];

for (const [index, domain] of domains.entries()) {
  const { handleRequest } = handlers[index];
  Deno.test(`${domain.name}: actual MCP runtime checks access only, performs business read once and refuses revocation`, async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    let status: number | 'network' = 204;
    let users = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(request.headers.get('authorization'), `Bearer ${token}`);
      if (url.origin === 'https://access-test.supabase.co') {
        assert.equal(url.pathname, '/auth/v1/user');
        users++;
        return Response.json({ id: userId, role: 'authenticated', aud: 'authenticated' });
      }
      assert.equal(url.origin, domain.name === 'inventory' || domain.name === 'employment'
        ? 'https://life.example.test' : 'https://finance.example.test');
      calls.push(url.pathname);
      if (url.pathname === domain.fixture.request.path) {
        assert.equal(request.method, domain.fixture.request.method);
        assert.equal(url.search, '');
        if (status === 'network') throw new TypeError('synthetic network failure');
        return status === domain.fixture.status ? new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
          : Response.json({ code: 'agent_not_approved' }, { status });
      }
      assert.equal(url.pathname, domain.businessPath);
      return Response.json(domain.body);
    };
    const send = async (method: string, params: unknown = {}) => {
      const notification = method.startsWith('notifications/');
      const response = await handleRequest(new Request(`https://access-test.supabase.co/functions/v1/sabah-one-${domain.name}-mcp/mcp`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: 1 }), method, params }),
      }));
      const text = await response.text();
      const data = response.headers.get('content-type')?.includes('text/event-stream')
        ? text.split('\n').filter(line => line.startsWith('data: ')).at(-1)?.slice(6) : text;
      return { response, body: data ? JSON.parse(data) : null };
    };
    try {
      const initialized = await send('initialize', { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'access-test', version: '1.0.0' } });
      assert.equal(initialized.response.status, 200);
      assert.equal(initialized.body.result.protocolVersion, '2025-11-25');
      assert.equal((await send('notifications/initialized')).response.status, 202);
      assert.equal((await send('tools/list')).response.status, 200);
      assert.deepEqual(calls, Array(3).fill(domain.fixture.request.path), 'protocol requests must never load business data');
      const tool = await send('tools/call', { name: domain.tool, arguments: domain.args });
      assert.equal(tool.response.status, 200);
      assert.equal(tool.body.result.isError, undefined);
      assert.deepEqual(tool.body.result.structuredContent, { result: domain.name === 'finance' ? null : domain.name === 'equity'
        ? { ...domain.body, limit: 1, offset: 0 } : domain.body });
      assert.deepEqual(calls.slice(3), [domain.fixture.request.path, domain.businessPath], 'one tool business read only');
      for (const failure of [403, 401, 404, 500, 'network'] as const) {
        status = failure;
        for (const method of ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']) {
          const before = calls.length;
          const denied = await send(method, { name: domain.tool, arguments: domain.args });
          assert.equal(denied.response.status, failure === 403 || failure === 401 ? failure : 503);
          if (failure === 401 || failure === 403) assert.match(denied.response.headers.get('www-authenticate')!, /oauth-protected-resource/);
          else assert.match(denied.body.error, /could not verify access/);
          assert.deepEqual(calls.slice(before), [domain.fixture.request.path], 'fail closed without business fallback');
        }
      }
      assert.equal(users, 24, 'each request validates the account anew');
      assert.equal(calls.filter(path => path === domain.businessPath).length, 1);
    } finally { globalThis.fetch = originalFetch; }
  });
}

Deno.test('access transport does not consume business payloads and always makes a fresh request', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let cancelled = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  };
  try {
    for (let i = 0; i < 2; i++) assert.equal(await probeServiceAccess(new URL('https://access.example.test'), token), 'approved');
    assert.equal(requests, 2);
    assert.equal(cancelled, 2);
  } finally { globalThis.fetch = originalFetch; }
});

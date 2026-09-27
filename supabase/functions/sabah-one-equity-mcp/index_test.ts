import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://equity-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SABAH_ONE_FINANCE_API_URL', 'https://finance-service.example.test');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://equity-test.supabase.co/functions/v1/sabah-one-equity-mcp';
const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const positionId = 'example-position';

function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'equity-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
  return `header.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

interface ServiceCall {
  method: string;
  path: string;
  search: string;
  body: unknown;
  authorization: string | null;
  idempotencyKey: string | null;
}
interface ServiceFailure { status: number; code: string; message: string }
interface Backend {
  calls: ServiceCall[];
  userError?: boolean;
  approvalError?: ServiceFailure;
  toolError?: ServiceFailure;
}

/** The access check reads one position and nothing else. */
const isProbe = (call: Pick<ServiceCall, 'method' | 'search'>) => call.method === 'GET' && call.search === '?limit=1';

async function withBackend(run: (backend: Backend) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const backend: Backend = { calls: [] };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://equity-test.supabase.co') {
      assert.equal(request.headers.get('apikey'), 'test-anon-key');
      assert.equal(url.pathname, '/auth/v1/user');
      return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
        status: backend.userError ? 401 : 200,
      });
    }
    // Only the finance service is called for account data: never a Supabase RPC.
    assert.equal(url.origin, 'https://finance-service.example.test');
    assert.match(url.pathname, /^\/api\/finance\/v1\/equity\/positions/);
    const call: ServiceCall = {
      method: request.method, path: url.pathname, search: url.search,
      body: request.method === 'PUT' ? await request.json() : undefined,
      authorization: request.headers.get('authorization'), idempotencyKey: request.headers.get('idempotency-key'),
    };
    backend.calls.push(call);
    const error = isProbe(call) ? backend.approvalError : backend.toolError;
    if (error) return Response.json({ code: error.code, message: error.message }, { status: error.status });
    if (request.method === 'DELETE') return Response.json({ id: positionId });
    return Response.json(request.method === 'GET' && url.pathname.endsWith('/positions') ? { positions: [], total: 0 } : { id: positionId });
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

Deno.test('public Equity metadata names the exact protected resource and deployment', async () => {
  const response = await handleRequest(new Request(`${baseUrl}/.well-known/oauth-protected-resource`));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.resource, `${baseUrl}/mcp`);
  assert.equal(metadata.resource_name, 'Sabah One Equity');
  assert.deepEqual(metadata.scopes_supported, ['openid']);
  assert.equal(typeof metadata.deploymentSha, 'string');
});

Deno.test('requires OAuth user identity, valid expiry, and trusted origin before any account read', async () => {
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
    const badOrigin = await handleRequest(new Request(`${baseUrl}/mcp`, { headers: { Origin: 'https://untrusted.example' } }));
    assert.equal(badOrigin.status, 403);
    await badOrigin.body?.cancel();
    assert.deepEqual(backend.calls, []);
  });
});

Deno.test('asks the finance service for independent Equity approval every request and fails closed', async () => {
  await withBackend(async backend => {
    backend.approvalError = { status: 403, code: 'agent_not_approved', message: 'This agent is not approved for this part of Sabah One.' };
    const refused = await mcp('tools/list', {});
    assert.equal(refused.response.status, 403);
    assert.match(refused.response.headers.get('www-authenticate')!, /oauth-protected-resource/);
    backend.approvalError = { status: 401, code: 'unauthorized', message: 'Sign in.' };
    assert.equal((await mcp('tools/list', {})).response.status, 401);
    backend.approvalError = { status: 503, code: 'unavailable', message: 'Service unavailable.' };
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.calls.length, 3);
    assert(backend.calls.every(call => isProbe(call) && call.path === '/api/finance/v1/equity/positions'));
  });
});

const plan = { summary: 'Keep under review', status: 'tentative', waitingFor: 'Verified information', nextAction: 'Review plan' };
const position = {
  company: 'Example Co', asOf: '2026-09-21', ownedShares: 100, stockPlan: plan, optionPlan: plan,
  employmentNote: 'Active employee',
  grants: [{ id: 'grant-a', grantDate: '2025-01-01', vested: 10, unvested: 20, strikeUsd: 5, originalExpiry: '2035-01-01', nextVest: { date: '2026-11-15', alternateDate: '2026-11-14', quantity: 5, condition: 'Subject to employment' } }],
  actions: [{ id: 'action-a', title: 'Review terms', timing: 'Before departure', done: false }],
  details: [{ id: 'detail-a', title: 'Policy', body: 'Verify grant terms.' }],
  sources: [{ id: 'source-a', label: 'Grant document', url: 'https://example.com/grant', asOf: '2026-09-21' }],
  scenario: { pricesUsd: [4, 10], withholdingRate: 0.4, usdToGbp: 0.75, asOf: '2026-09-21', notes: 'Illustrative before fees' },
};
const expectedUpdatedAt = '2026-09-21T12:00:00.000000+00:00';

Deno.test('publishes exactly five domain tools with retry, stale-write and deletion safeguards', async () => {
  await withBackend(async () => {
    const { response, message } = await mcp('tools/list', {});
    assert.equal(response.status, 200);
    const listed = message.result.tools;
    assert.deepEqual(listed.map((tool: { name: string }) => tool.name).sort(), [
      'equity_add_position', 'equity_get_position', 'equity_list_positions', 'equity_remove_position', 'equity_update_position',
    ]);
    for (const tool of listed.filter((tool: { annotations: { readOnlyHint: boolean } }) => !tool.annotations.readOnlyHint)) {
      assert(tool.inputSchema.required.includes('requestId'));
      assert.equal(tool.annotations.idempotentHint, true);
      if (tool.name !== 'equity_add_position') assert(tool.inputSchema.required.includes('expectedUpdatedAt'));
    }
    const remove = listed.find((tool: { name: string }) => tool.name === 'equity_remove_position');
    assert(remove.inputSchema.required.includes('confirmed'));
    assert.equal(remove.annotations.destructiveHint, true);
  });
});

Deno.test('initializes OAuth MCP and forwards exact bounded semantic inputs, user token and Idempotency-Key', async () => {
  await withBackend(async backend => {
    const init = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'equity-test-agent', version: '1.0.0' } });
    assert.equal(init.message.result.serverInfo.name, 'sabah-one-equity');
    const accessToken = token();
    await mcp('tools/call', { name: 'equity_list_positions', arguments: { query: 'Example', limit: 20, offset: 40 } });
    await mcp('tools/call', { name: 'equity_get_position', arguments: { positionId } });
    for (let retry = 0; retry < 2; retry++) {
      await mcp('tools/call', { name: 'equity_add_position', arguments: { requestId, position } }, accessToken);
    }
    await mcp('tools/call', { name: 'equity_add_position', arguments: { requestId, position: { ...position, id: positionId } } });
    await mcp('tools/call', { name: 'equity_update_position', arguments: { requestId, positionId, position, expectedUpdatedAt } });
    await mcp('tools/call', { name: 'equity_remove_position', arguments: { requestId, positionId, confirmed: true, expectedUpdatedAt } });
    const calls = backend.calls.filter(call => !isProbe(call));
    assert.equal(calls.length, 7);
    const positions = '/api/finance/v1/equity/positions';
    assert.deepEqual([calls[0].path, calls[0].search], [positions, '?query=Example&limit=20&offset=40']);
    assert.deepEqual([calls[1].method, calls[1].path, calls[1].idempotencyKey], ['GET', `${positions}/${positionId}`, null]);
    // Without an ID the requestId names the position, so the exact retry is the same request.
    assert.deepEqual(calls[2], calls[3]);
    assert.deepEqual([calls[2].method, calls[2].path], ['PUT', `${positions}/${requestId}`]);
    assert.deepEqual(calls[2].body, { position, expectedUpdatedAt: null });
    assert.equal(calls[2].idempotencyKey, requestId);
    assert.equal(calls[2].authorization, `Bearer ${accessToken}`);
    assert.deepEqual([calls[4].path, calls[4].body], [`${positions}/${positionId}`, { position, expectedUpdatedAt: null }]);
    assert.deepEqual([calls[5].method, calls[5].path], ['PUT', `${positions}/${positionId}`]);
    assert.deepEqual(calls[5].body, { position, expectedUpdatedAt });
    assert.deepEqual([calls[6].method, calls[6].path, calls[6].idempotencyKey], ['DELETE', `${positions}/${positionId}`, requestId]);
    assert.equal(new URLSearchParams(calls[6].search).get('expectedUpdatedAt'), expectedUpdatedAt);
  });
});

Deno.test('keeps the position receipts agents rely on', async () => {
  await withBackend(async () => {
    const result = async (name: string, args: Record<string, unknown>) =>
      (await mcp('tools/call', { name, arguments: args })).message.result.structuredContent.result;
    assert.deepEqual(await result('equity_list_positions', { limit: 5 }), { positions: [], total: 0, limit: 5, offset: 0 });
    assert.deepEqual(await result('equity_get_position', { positionId }), { position: { id: positionId } });
    assert.deepEqual(await result('equity_update_position', { requestId, positionId, position, expectedUpdatedAt }),
      { positionId, position: { id: positionId } });
    assert.deepEqual(await result('equity_remove_position', { requestId, positionId, confirmed: true, expectedUpdatedAt }),
      { positionId, position: null });
  });
});

Deno.test('rejects malformed quantities, dates, sources, ownership fields and unconfirmed deletion before mutation', async () => {
  await withBackend(async backend => {
    const invalid = [
      { name: 'equity_add_position', arguments: { position } },
      ...[
        { ownedShares: -1 }, { ownedShares: 1.5 }, { asOf: '2026-02-30' }, { asOf: '0000-01-01' },
        { userId: 'another-user' }, { createdAt: expectedUpdatedAt },
        { stockPlan: { ...plan, status: 'guaranteed' } }, { optionPlan: { ...plan, reviewMonth: '2026-13' } },
        { sources: [{ ...position.sources[0], url: 'https://user:password@example.com' }] },
        { grants: [{ ...position.grants[0], vested: -1 }] },
        { scenario: { ...position.scenario, withholdingRate: 1.1 } },
        { scenario: { ...position.scenario, usdToGbp: 0 } },
        { details: Array.from({ length: 100 }, (_, i) => ({ id: String(i), title: 'Bounded', body: 'x'.repeat(16_000) })) },
      ].map(patch => ({ name: 'equity_add_position', arguments: { requestId, position: { ...position, ...patch } } })),
      { name: 'equity_update_position', arguments: { requestId, positionId, position } },
      { name: 'equity_remove_position', arguments: { requestId, positionId, expectedUpdatedAt, confirmed: false } },
      { name: 'equity_list_positions', arguments: { limit: 101 } },
      { name: 'equity_get_position', arguments: { positionId, userId } },
    ];
    for (const input of invalid) {
      const { message } = await mcp('tools/call', input);
      assert(message.error || message.result?.isError, `${input.name} should reject malformed input`);
    }
    assert(backend.calls.every(isProbe));
  });
});

Deno.test('surfaces concurrency and idempotency failures from the service', async () => {
  await withBackend(async backend => {
    backend.toolError = { status: 409, code: 'position_changed', message: 'Equity position changed; reload before saving.' };
    const { message } = await mcp('tools/call', { name: 'equity_update_position', arguments: { requestId, positionId, position, expectedUpdatedAt } });
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /reload before saving/);
  });
});

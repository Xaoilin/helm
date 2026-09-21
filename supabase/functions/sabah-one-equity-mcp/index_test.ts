import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://equity-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://equity-test.supabase.co/functions/v1/sabah-one-equity-mcp';
const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const positionId = 'example-position';

function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'equity-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
  return `header.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

interface RpcCall { name: string; body: Record<string, unknown>; authorization: string | null }
interface Backend {
  calls: RpcCall[];
  userError?: boolean;
  approvalError?: { code: string; message: string };
  toolError?: { code: string; message: string };
}

async function withBackend(run: (backend: Backend) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const backend: Backend = { calls: [] };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://equity-test.supabase.co');
    assert.equal(request.headers.get('apikey'), 'test-anon-key');
    if (url.pathname === '/auth/v1/user') {
      return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
        status: backend.userError ? 401 : 200,
      });
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/equity_/);
    const name = url.pathname.split('/').at(-1)!;
    const body = await request.json();
    backend.calls.push({ name, body, authorization: request.headers.get('authorization') });
    const isApproval = name === 'equity_list_positions' && body.p_limit === 1;
    const error = isApproval ? backend.approvalError : backend.toolError;
    if (error) return Response.json(error, { status: error.code === '42501' ? 403 : 400 });
    return Response.json(isApproval ? { positions: [], total: 0, limit: 1, offset: 0 } : { positionId, duplicate: false });
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

Deno.test('checks independent Equity approval every request and fails closed on unavailable approval', async () => {
  await withBackend(async backend => {
    backend.approvalError = { code: '42501', message: 'Equity approval required' };
    assert.equal((await mcp('tools/list', {})).response.status, 403);
    backend.approvalError = { code: '08006', message: 'Database unavailable' };
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.calls.length, 2);
    assert(backend.calls.every(call => call.name === 'equity_list_positions' && call.body.p_limit === 1));
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

Deno.test('initializes OAuth MCP and forwards exact bounded semantic inputs and user token', async () => {
  await withBackend(async backend => {
    const init = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'equity-test-agent', version: '1.0.0' } });
    assert.equal(init.message.result.serverInfo.name, 'sabah-one-equity');
    const accessToken = token();
    await mcp('tools/call', { name: 'equity_list_positions', arguments: { query: 'Example', limit: 20, offset: 40 } });
    await mcp('tools/call', { name: 'equity_get_position', arguments: { positionId } });
    for (let retry = 0; retry < 2; retry++) {
      await mcp('tools/call', { name: 'equity_add_position', arguments: { requestId, position } }, accessToken);
    }
    await mcp('tools/call', { name: 'equity_update_position', arguments: { requestId, positionId, position, expectedUpdatedAt } });
    await mcp('tools/call', { name: 'equity_remove_position', arguments: { requestId, positionId, confirmed: true, expectedUpdatedAt } });
    const calls = backend.calls.filter(call => call.body.p_limit !== 1);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls[0].body, { p_query: 'Example', p_limit: 20, p_offset: 40 });
    assert.deepEqual(calls[1].body, { p_position_id: positionId });
    assert.deepEqual(calls[2].body, { p_request_id: requestId, p_position: position });
    assert.deepEqual(calls[2], calls[3]);
    assert.equal(calls[2].authorization, `Bearer ${accessToken}`);
    assert.deepEqual(calls[4].body, { p_request_id: requestId, p_position_id: positionId, p_position: position, p_expected_updated_at: expectedUpdatedAt });
    assert.deepEqual(calls[5].body, { p_request_id: requestId, p_position_id: positionId, p_confirm: true, p_expected_updated_at: expectedUpdatedAt });
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
    assert(backend.calls.every(call => call.body.p_limit === 1));
  });
});

Deno.test('surfaces concurrency and idempotency failures from the database', async () => {
  await withBackend(async backend => {
    backend.toolError = { code: '40001', message: 'Equity position changed; reload before saving.' };
    const { message } = await mcp('tools/call', { name: 'equity_update_position', arguments: { requestId, positionId, position, expectedUpdatedAt } });
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /reload before saving/);
  });
});

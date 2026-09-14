import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://employment-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://employment-test.supabase.co/functions/v1/sabah-one-employment-mcp';
const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const applicationId = 'existing-job';

function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'employment-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
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
    assert.equal(url.origin, 'https://employment-test.supabase.co');
    assert.equal(request.headers.get('apikey'), 'test-anon-key');
    if (url.pathname === '/auth/v1/user') {
      return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
        status: backend.userError ? 401 : 200,
      });
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/employment_/);
    const name = url.pathname.split('/').at(-1)!;
    const body = await request.json();
    backend.calls.push({ name, body, authorization: request.headers.get('authorization') });
    const isApproval = name === 'employment_list_applications' && body.p_limit === 1;
    const error = isApproval ? backend.approvalError : backend.toolError;
    if (error) return Response.json(error, { status: error.code === '42501' ? 403 : 400 });
    return Response.json(isApproval ? { applications: [], total: 0, limit: 1, offset: 0 } : { applicationId, duplicate: false });
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

Deno.test('public Employment metadata names the exact protected resource and deployment', async () => {
  const response = await handleRequest(new Request(`${baseUrl}/.well-known/oauth-protected-resource`));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.resource, `${baseUrl}/mcp`);
  assert.equal(metadata.resource_name, 'Sabah One Employment');
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

Deno.test('checks independent Employment approval every request and fails closed on unavailable approval', async () => {
  await withBackend(async backend => {
    backend.approvalError = { code: '42501', message: 'Employment approval required' };
    assert.equal((await mcp('tools/list', {})).response.status, 403);
    backend.approvalError = { code: '08006', message: 'Database unavailable' };
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.calls.length, 2);
    assert(backend.calls.every(call => call.name === 'employment_list_applications' && call.body.p_limit === 1));
  });
});

Deno.test('actual MCP SDK exposes exactly six narrow tools with required replay and delete safeguards', async () => {
  await withBackend(async () => {
    const { response, message } = await mcp('tools/list', {});
    assert.equal(response.status, 200);
    assert.equal(message.error, undefined);
    const tools = message.result.tools;
    assert.deepEqual(tools.map((tool: { name: string }) => tool.name).sort(), [
      'employment_add_application', 'employment_add_history', 'employment_get_application',
      'employment_list_applications', 'employment_remove_application', 'employment_update_application',
    ]);
    for (const tool of tools.filter((tool: { annotations: { readOnlyHint: boolean } }) => !tool.annotations.readOnlyHint)) {
      assert(tool.inputSchema.required.includes('requestId'));
      assert.equal(tool.annotations.idempotentHint, true);
    }
    const remove = tools.find((tool: { name: string }) => tool.name === 'employment_remove_application');
    assert(remove.inputSchema.required.includes('confirmed'));
    assert.equal(remove.annotations.destructiveHint, true);
  });
});

Deno.test('supports the OAuth MCP initialize and initialized exchange used by connected agents', async () => {
  await withBackend(async backend => {
    const { response, message } = await mcp('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'employment-test-agent', version: '1.0.0' },
    });
    assert.equal(response.status, 200);
    assert.equal(message.result.protocolVersion, '2025-11-25');
    assert.equal(message.result.serverInfo.name, 'sabah-one-employment');
    const initialized = await handleRequest(new Request(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }));
    assert.equal(initialized.status, 202);
    await initialized.body?.cancel();
    assert.equal(backend.calls.length, 2, 'approval is checked even for initialization and notification requests');
  });
});

Deno.test('maps bounded list filters and exact IDs to account-scoped semantic RPCs', async () => {
  await withBackend(async backend => {
    await mcp('tools/call', { name: 'employment_list_applications', arguments: { query: 'Example', status: 'applied', workType: 'contract', remoteStatus: 'needs_verification', limit: 20, offset: 40 } });
    await mcp('tools/call', { name: 'employment_get_application', arguments: { applicationId } });
    const calls = backend.calls.filter(call => call.body.p_limit !== 1);
    assert.deepEqual(calls.map(call => ({ name: call.name, body: call.body })), [
      { name: 'employment_list_applications', body: { p_query: 'Example', p_status: 'applied', p_limit: 20, p_offset: 40, p_work_type: 'contract', p_remote_status: 'needs_verification' } },
      { name: 'employment_get_application', body: { p_application_id: applicationId } },
    ]);
    assert(calls.every(call => call.authorization?.startsWith('Bearer header.')));
  });
});

Deno.test('write retries send the exact caller payload without generated IDs, timestamps, dates, or patch defaults', async () => {
  await withBackend(async backend => {
    const application = { company: 'Example Company', role: 'Engineering project' };
    const patch = { status: 'interview', nextAction: 'Review the project invitation', nextActionDate: null };
    const history = { kind: 'contact', summary: 'Project invitation received', evidenceUrl: 'https://mail.google.com/mail/#all/example-message' };
    for (let attempt = 0; attempt < 2; attempt++) {
      await mcp('tools/call', { name: 'employment_add_application', arguments: { requestId, application } });
    }
    await mcp('tools/call', { name: 'employment_update_application', arguments: { requestId, applicationId, patch } });
    await mcp('tools/call', { name: 'employment_add_history', arguments: { requestId, applicationId, history } });
    await mcp('tools/call', { name: 'employment_remove_application', arguments: { requestId, applicationId, confirmed: true } });
    const calls = backend.calls.filter(call => call.body.p_limit !== 1);
    assert.equal(calls.length, 5);
    assert.deepEqual(calls[0].body, { p_request_id: requestId, p_application: application });
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[2].body, { p_request_id: requestId, p_application_id: applicationId, p_patch: patch });
    assert.deepEqual(calls[3].body, { p_request_id: requestId, p_application_id: applicationId, p_history: history });
    assert.deepEqual(calls[4].body, { p_request_id: requestId, p_application_id: applicationId, p_confirm: true });
  });
});

Deno.test('published input boundaries stay within the SQL text, page, and mutation bounds', async () => {
  await withBackend(async backend => {
    const list = await mcp('tools/call', { name: 'employment_list_applications', arguments: { query: 'x'.repeat(160), limit: 100, offset: 10_000 } });
    assert.equal(list.message.result.isError, undefined);
    const update = await mcp('tools/call', { name: 'employment_update_application', arguments: { requestId, applicationId, patch: { remoteCaveat: 'x'.repeat(2_000) } } });
    assert.equal(update.message.result.isError, undefined);
    const validToolCalls = backend.calls.filter(call => call.body.p_limit !== 1).length;
    for (const input of [
      { name: 'employment_list_applications', arguments: { query: 'x'.repeat(161) } },
      { name: 'employment_list_applications', arguments: { offset: 10_001 } },
      { name: 'employment_update_application', arguments: { requestId, applicationId, patch: { remoteCaveat: 'x'.repeat(2_001) } } },
      { name: 'employment_add_application', arguments: { requestId, application: { company: 'Example', role: 'Engineer', history: Array.from({ length: 100 }, () => ({ kind: 'note', summary: 'Evidence', details: 'x'.repeat(4_000) })) } } },
    ]) {
      const { message } = await mcp('tools/call', input);
      assert(message.error || message.result?.isError);
    }
    assert.equal(backend.calls.filter(call => call.body.p_limit !== 1).length, validToolCalls);
  });
});

Deno.test('rejects malformed writes, invented statuses/dates, broad fields, and missing deletion confirmation before mutation', async () => {
  await withBackend(async backend => {
    const invalid = [
      { name: 'employment_add_application', arguments: { application: { company: 'Example', role: 'Engineer' } } },
      { name: 'employment_add_application', arguments: { requestId, application: { company: 'Example', role: 'Engineer', applicationDate: '2026-02-30' } } },
      { name: 'employment_add_application', arguments: { requestId, application: { company: 'Example', role: 'Engineer', applicationDate: '0000-01-01' } } },
      { name: 'employment_add_application', arguments: { requestId, application: { company: 'Example', role: 'Engineer', remoteStatus: 'confirmed' } } },
      { name: 'employment_update_application', arguments: { requestId, applicationId, patch: {} } },
      { name: 'employment_update_application', arguments: { requestId, applicationId, patch: { history: [] } } },
      { name: 'employment_update_application', arguments: { requestId, applicationId, patch: { status: 'accepted_offer' } } },
      { name: 'employment_add_history', arguments: { requestId, applicationId, history: { kind: 'contact', summary: 'Update', evidenceUrl: 'https://user:password@example.com/email' } } },
      { name: 'employment_add_history', arguments: { requestId, applicationId, history: { kind: 'contact', summary: 'Update', evidenceUrl: 'https:example.com/email' } } },
      { name: 'employment_remove_application', arguments: { requestId, applicationId, confirmed: false } },
      { name: 'employment_list_applications', arguments: { limit: 101 } },
      { name: 'employment_get_application', arguments: { applicationId, userId: 'another-user' } },
    ];
    for (const input of invalid) {
      const { message } = await mcp('tools/call', input);
      assert(message.error || message.result?.isError, `${input.name} should reject malformed input`);
    }
    assert(backend.calls.every(call => call.body.p_limit === 1), 'invalid inputs must never call a tool RPC');
  });
});

Deno.test('surfaces database rejection as a failed tool result', async () => {
  await withBackend(async backend => {
    backend.toolError = { code: '22023', message: 'Idempotency key was already used for different input.' };
    const { message } = await mcp('tools/call', { name: 'employment_update_application', arguments: { requestId, applicationId, patch: { status: 'closed' } } });
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /Idempotency key/);
  });
});

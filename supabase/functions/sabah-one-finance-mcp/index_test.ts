import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://finance-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://finance-test.supabase.co/functions/v1/sabah-one-finance-mcp';
const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';


function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'finance-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
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
    assert.equal(url.origin, 'https://finance-test.supabase.co');
    assert.equal(request.headers.get('apikey'), 'test-anon-key');
    if (url.pathname === '/auth/v1/user') {
      return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
        status: backend.userError ? 401 : 200,
      });
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/finance_/);
    const name = url.pathname.split('/').at(-1)!;
    const body = await request.json();
    backend.calls.push({ name, body, authorization: request.headers.get('authorization') });
    const isApproval = name === 'finance_get_review';
    const error = isApproval ? backend.approvalError : backend.toolError;
    if (error) return Response.json(error, { status: error.code === '42501' ? 403 : 400 });
    return Response.json(isApproval ? null : { review: { id: 'current' }, accountVersion: 1 });
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

Deno.test('public Finance metadata names the exact protected resource and deployment', async () => {
  const response = await handleRequest(new Request(`${baseUrl}/.well-known/oauth-protected-resource`));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.resource, `${baseUrl}/mcp`);
  assert.equal(metadata.resource_name, 'Sabah One Finance');
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

Deno.test('checks independent Finance approval every request and fails closed on unavailable approval', async () => {
  await withBackend(async backend => {
    backend.approvalError = { code: '42501', message: 'Finance approval required' };
    assert.equal((await mcp('tools/list', {})).response.status, 403);
    backend.approvalError = { code: '08006', message: 'Database unavailable' };
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.calls.length, 2);
    assert(backend.calls.every(call => call.name === 'finance_get_review'));
  });
});

const review = {
  "asOf": "2026-09-21",
  "currency": "GBP",
  "coverage": {
    "from": "2025-09-01",
    "to": "2026-09-21",
    "completeThrough": "2026-08",
    "transactionCount": 20,
    "accountCount": 2,
    "note": "Synthetic data"
  },
  "accounts": [
    {
      "id": "example-bank",
      "label": "Example bank",
      "ownership": "personal",
      "balancePence": -1200,
      "asOf": "2026-09-21"
    }
  ],
  "months": [
    {
      "month": "2026-08",
      "incomePence": 500000,
      "outflowPence": 450000,
      "netPence": 50000,
      "salaryPence": 400000,
      "categories": [
        {
          "label": "Refund",
          "amountPence": -100
        }
      ]
    }
  ],
  "budget": {
    "incomePence": 400000,
    "incomeBasis": "Synthetic salary",
    "essentials": [
      {
        "label": "Housing",
        "amountPence": 150000,
        "note": "Full share"
      }
    ],
    "workCostsPence": 20000,
    "workCostsNote": "Dated average",
    "scenarios": [
      {
        "label": "Planned change",
        "status": "planned",
        "monthlyAdjustmentPence": -10000,
        "note": "Unconfirmed"
      }
    ]
  },
  "opportunities": [
    {
      "label": "Shopping",
      "monthlyPence": 60000,
      "note": "Review actual purchases",
      "suggestedCapPence": 40000
    }
  ],
  "loans": [
    {
      "id": "example-loan",
      "lender": "Example lender",
      "purpose": "House repairs",
      "status": "active",
      "monthlyPaymentPence": 20000,
      "balancePence": 700000,
      "balanceAsOf": "2026-09-21",
      "balanceKind": "statement",
      "settlementPence": 650000,
      "settlementAsOf": "2026-09-21",
      "paymentsRemaining": 35,
      "originalPrincipalPence": 1000000,
      "nextPaymentDate": "2026-10-01",
      "rateNote": "Verify terms",
      "notes": "Synthetic loan",
      "sourceIds": [
        "source"
      ]
    }
  ],
  "notes": [
    "Dated synthetic review"
  ],
  "sources": [
    {
      "id": "source",
      "label": "Example statement",
      "url": "https://example.com/statement",
      "asOf": "2026-09-21"
    }
  ]
};

Deno.test('publishes only review read/save with an explicit concurrency token', async () => {
  await withBackend(async () => {
    const { message } = await mcp('tools/list', {});
    assert.deepEqual(message.result.tools.map((tool: { name: string }) => tool.name).sort(), ['finance_get_review', 'finance_save_review']);
    const write = message.result.tools.find((tool: { name: string }) => tool.name === 'finance_save_review');
    assert(write.inputSchema.required.includes('requestId'));
    assert(write.inputSchema.required.includes('expectedUpdatedAt'));
    assert.equal(write.annotations.idempotentHint, true);
  });
});
Deno.test('forwards exact validated pence values, separate balances, token and replay inputs', async () => {
  await withBackend(async backend => {
    const accessToken = token();
    for (let retry = 0; retry < 2; retry++) {
      const { message } = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review, expectedUpdatedAt: null } }, accessToken);
      assert.equal(message.result.isError, undefined);
    }
    const calls = backend.calls.filter(call => call.name === 'finance_save_review');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0].body, { p_request_id: requestId, p_review: review, p_expected_updated_at: null });
    assert.equal(calls[0].authorization, `Bearer ${accessToken}`);
  });
});
Deno.test('rejects invalid money, dates, net, foreign fields, source URLs and missing quote dates', async () => {
  await withBackend(async backend => {
    const invalid = [
      { asOf: '2026-02-30' }, { asOf: '0000-01-01' }, { userId: 'someone-else' }, { id: 'other' },
      { currency: 'USD' }, { budget: { ...review.budget, incomePence: 1.5 } },
      { months: [{ ...review.months[0], netPence: 1 }] },
      { loans: [{ ...review.loans[0], balancePence: -1 }] },
      { loans: [{ ...review.loans[0], settlementAsOf: undefined }] },
      { loans: [{ ...review.loans[0], sourceIds: ['missing'] }] },
      { loans: [{ ...review.loans[0], paymentsRemaining: 1.5 }] },
      { accounts: [review.accounts[0], review.accounts[0]] },
      { sources: [{ ...review.sources[0], url: 'https://user:password@example.com' }] },
      { sources: [{ ...review.sources[0], url: 'javascript:alert(1)' }] },
      { notes: Array.from({ length: 100 }, () => 'x'.repeat(4000)) },
    ];
    for (const patch of invalid) {
      const { message } = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review: { ...review, ...patch }, expectedUpdatedAt: null } });
      assert(message.error || message.result?.isError, `should reject ${JSON.stringify(patch).slice(0, 100)}`);
    }
    const missing = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review } });
    assert(missing.message.error || missing.message.result?.isError);
    assert(backend.calls.every(call => call.name === 'finance_get_review'));
  });
});
Deno.test('surfaces database stale-write failure without hiding diagnostics', async () => {
  await withBackend(async backend => {
    backend.toolError = { code: '40001', message: 'Finance review changed; reload before saving.' };
    const { message } = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review, expectedUpdatedAt: '2026-09-21T12:00:00+00:00' } });
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /reload before saving/);
  });
});

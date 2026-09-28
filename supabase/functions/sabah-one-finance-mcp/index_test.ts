import assert from 'node:assert/strict';

Deno.env.set('SUPABASE_URL', 'https://finance-test.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SABAH_ONE_FINANCE_API_URL', 'https://finance-service.example.test/');
const { handleRequest } = await import('./handler.ts');
const baseUrl = 'https://finance-test.supabase.co/functions/v1/sabah-one-finance-mcp';
const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';


function token(overrides: Record<string, unknown> = {}): string {
  const claims = { sub: userId, client_id: 'finance-client', exp: Math.floor(Date.now() / 1_000) + 3_600, scope: 'openid', ...overrides };
  return `header.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

interface ServiceCall {
  method: string;
  path: string;
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

const storedReview = { id: 'current', updatedAt: '2026-09-21T12:00:00Z' };

async function withBackend(run: (backend: Backend) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const backend: Backend = { calls: [] };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://finance-test.supabase.co') {
      assert.equal(request.headers.get('apikey'), 'test-anon-key');
      assert.equal(url.pathname, '/auth/v1/user');
      return Response.json(backend.userError ? { message: 'Invalid token' } : { id: userId, aud: 'authenticated', role: 'authenticated' }, {
        status: backend.userError ? 401 : 200,
      });
    }
    // Only the finance service is called for account data: never a Supabase RPC.
    assert.equal(url.origin, 'https://finance-service.example.test');
    assert.equal(url.pathname, '/api/finance/v1/review');
    const body = request.method === 'GET' ? undefined : await request.json();
    backend.calls.push({
      method: request.method, path: url.pathname, body,
      authorization: request.headers.get('authorization'), idempotencyKey: request.headers.get('idempotency-key'),
    });
    const error = request.method === 'GET' ? backend.approvalError : backend.toolError;
    if (error) return Response.json({ code: error.code, message: error.message }, { status: error.status });
    return Response.json({ review: request.method === 'GET' ? storedReview : { ...storedReview, updatedAt: '2026-09-22T12:00:00Z' } });
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

Deno.test('asks the finance service for independent Finance approval every request and fails closed', async () => {
  await withBackend(async backend => {
    const accessToken = token();
    backend.approvalError = { status: 403, code: 'agent_not_approved', message: 'This agent is not approved for this part of Sabah One.' };
    const refused = await mcp('tools/list', {}, accessToken);
    assert.equal(refused.response.status, 403);
    assert.match(refused.response.headers.get('www-authenticate')!, /oauth-protected-resource/);
    backend.approvalError = { status: 401, code: 'unauthorized', message: 'Sign in.' };
    assert.equal((await mcp('tools/list', {})).response.status, 401);
    backend.approvalError = { status: 503, code: 'unavailable', message: 'Service unavailable.' };
    assert.equal((await mcp('tools/list', {})).response.status, 503);
    assert.equal(backend.calls.length, 3);
    assert(backend.calls.every(call => call.method === 'GET' && call.idempotencyKey === null));
    assert.equal(backend.calls[0].authorization, `Bearer ${accessToken}`);
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
Deno.test('reads the stored review itself, or null', async () => {
  await withBackend(async () => {
    const { message } = await mcp('tools/call', { name: 'finance_get_review', arguments: {} });
    assert.deepEqual(message.result.structuredContent, { result: storedReview });
  });
});
Deno.test('forwards exact validated pence values with the agent token and requestId as the Idempotency-Key', async () => {
  await withBackend(async backend => {
    const accessToken = token();
    for (let retry = 0; retry < 2; retry++) {
      const { message } = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review, expectedUpdatedAt: null } }, accessToken);
      assert.equal(message.result.isError, undefined);
    }
    const calls = backend.calls.filter(call => call.method === 'PUT');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0].body, { review, expectedUpdatedAt: null });
    assert.equal(calls[0].idempotencyKey, requestId);
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
    assert(backend.calls.every(call => call.method === 'GET'));
  });
});
Deno.test('surfaces the service stale-write refusal without hiding diagnostics', async () => {
  await withBackend(async backend => {
    backend.toolError = { status: 409, code: 'review_changed', message: 'Finance review changed; reload before saving.' };
    const { message } = await mcp('tools/call', { name: 'finance_save_review', arguments: { requestId, review, expectedUpdatedAt: '2026-09-21T12:00:00+00:00' } });
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /reload before saving/);
  });
});

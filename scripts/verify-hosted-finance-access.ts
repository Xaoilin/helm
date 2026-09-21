#!/usr/bin/env tsx
// Protected-CI acceptance only. Creates its own synthetic Auth user and OAuth
// client, then accesses only that user's Finance through the published MCP.
// The service key is used only for Auth fixture administration and cleanup.
// OAuth flow: https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { parseMcpResponse } from './lib/mcp-response';

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const publicKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const sha = process.env.ASSISTANT_DEPLOY_SHA || '';
const managementToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const functionBase = `${url}/functions/v1/sabah-one-finance-mcp`;
const resource = `${functionBase}/mcp`;
const observations: Array<{ scenario: string; status?: number; passed: boolean }> = [];
let fixtureCreationAttempted = false;
let fixtureRemoved = false;
let clientCreationAttempted = false;
let clientRemoved = false;
let passed = false;

class AcceptanceFailure extends Error {}

function expect(scenario: string, condition: unknown, status?: number): asserts condition {
  observations.push({ scenario, ...(status === undefined ? {} : { status }), passed: Boolean(condition) });
  if (!condition) throw new AcceptanceFailure(`${scenario} failed${status === undefined ? '' : ` (HTTP ${status})`}.`);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

async function boundedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch {
    // Fetch/SDK error messages may contain URLs, tokens, or response bodies.
    throw new AcceptanceFailure('Acceptance network request failed.');
  }
}

async function request(scenario: string, endpoint: string, init: RequestInit = {}, expected?: number) {
  const response = await boundedFetch(endpoint, init);
  expect(scenario, expected === undefined ? response.ok : response.status === expected, response.status);
  return response;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return record(await response.json());
  } catch {
    throw new AcceptanceFailure('Acceptance response was not valid JSON.');
  }
}

function discoveredEndpoint(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  expect('OAuth discovery contains required endpoint', typeof value === 'string');
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new AcceptanceFailure('OAuth discovery endpoint is invalid.'); }
  expect('OAuth endpoint stays on the exact Auth server', endpoint.origin === url
    && endpoint.pathname.startsWith('/auth/v1/') && !endpoint.username && !endpoint.password
    && !endpoint.search && !endpoint.hash);
  return endpoint.href;
}

let messageId = 0;
let protocolVersion = '2025-11-25';
let sessionId: string | undefined;

function mcpInit(token: string | undefined, method: string, params: unknown, id?: number): RequestInit {
  return {
    method: 'POST',
    headers: {
      apikey: publicKey,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': protocolVersion,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
  };
}

async function mcp(scenario: string, token: string, method: string, params: unknown = {}) {
  const id = ++messageId;
  const response = await request(scenario, resource, mcpInit(token, method, params, id));
  let body: Record<string, unknown>;
  try {
    body = parseMcpResponse(await response.text(), response.headers.get('content-type'), id);
  } catch {
    throw new AcceptanceFailure('Finance MCP response was not valid JSON or SSE for the requested message.');
  }
  expect(`${scenario}: valid JSON-RPC response`, body.jsonrpc === '2.0' && body.id === id
    && !body.error && body.result !== undefined);
  sessionId = response.headers.get('mcp-session-id') || sessionId;
  return record(body.result);
}

async function callTool(scenario: string, token: string, name: string, args: Record<string, unknown>) {
  const body = await mcp(scenario, token, 'tools/call', { name, arguments: args });
  const content = record(body.structuredContent);
  expect(`${scenario}: semantic success`, body.isError !== true && content.result !== undefined);
  return record(content.result);
}

async function denied(scenario: string, token: string | undefined, status: number) {
  const response = await request(scenario, resource, mcpInit(token, 'tools/list', {}, ++messageId), status);
  expect(`${scenario}: OAuth challenge`, response.headers.get('www-authenticate')?.includes(
    `${functionBase}/.well-known/oauth-protected-resource`,
  ));
  await response.body?.cancel();
}

async function main() {
  expect('Exact target and protected acceptance configuration', /^[a-z0-9]+$/.test(projectRef)
    && url === `https://${projectRef}.supabase.co` && publicKey && managementToken && /^[a-f0-9]{40}$/.test(sha));
  const metadata = await readJson(await request('Finance resource discovery',
    `${functionBase}/.well-known/oauth-protected-resource`));
  expect('Live Finance metadata matches exact protected candidate', metadata.deploymentSha === sha
    && metadata.resource === resource && Array.isArray(metadata.authorization_servers)
    && metadata.authorization_servers.length === 1 && metadata.authorization_servers[0] === `${url}/auth/v1`);
  await denied('Missing token denied', undefined, 401);
  await denied('Invalid token denied', 'invalid-acceptance-token', 401);

  const discovery = await readJson(await request('OAuth authorization-server discovery',
    `${url}/.well-known/oauth-authorization-server/auth/v1`));
  expect('Exact OAuth issuer', discovery.issuer === `${url}/auth/v1`);
  const registrationEndpoint = discoveredEndpoint(discovery, 'registration_endpoint');
  const authorizationEndpoint = discoveredEndpoint(discovery, 'authorization_endpoint');
  const tokenEndpoint = discoveredEndpoint(discovery, 'token_endpoint');

  const keysResponse = await request('Synthetic Auth fixture administration configuration',
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${managementToken}` },
    });
  let keys: unknown;
  try { keys = await keysResponse.json(); } catch { throw new AcceptanceFailure('Fixture configuration response was invalid.'); }
  const serviceKey = Array.isArray(keys)
    ? record(keys.find(key => record(key).name === 'service_role')).api_key : undefined;
  expect('Synthetic Auth fixture administration credential available', typeof serviceKey === 'string' && serviceKey);
  const options = {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  };
  const admin = createClient(url, serviceKey, options);
  const client = createClient(url, publicKey, options);
  const runId = randomUUID();
  const email = `helm-finance-acceptance-${runId}@example.invalid`;
  const clientName = `Sabah One Finance acceptance ${runId}`;
  // This callback is never fetched or listened on; only its returned code/state
  // are inspected. No real browser or existing client/session is involved.
  const redirectUri = 'http://127.0.0.1:49197/helm-finance-acceptance';
  let fixtureId: string | undefined;
  let oauthClientId: string | undefined;
  let directToken: string | undefined;
  let failure: unknown;
  try {
    fixtureCreationAttempted = true;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    fixtureId = created.data.user?.id;
    expect('Synthetic Auth identity created', !created.error && fixtureId && created.data.user?.email === email);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect('Own synthetic login link created', !link.error && link.data.properties?.hashed_token
      && link.data.user?.id === fixtureId);
    const login = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
    directToken = login.data.session?.access_token;
    expect('Own synthetic session verified', !login.error && login.data.user?.id === fixtureId && directToken);
    await denied('Direct first-party session denied by Finance MCP', directToken, 401);

    clientCreationAttempted = true;
    const registered = await readJson(await request('Synthetic public OAuth client registered', registrationEndpoint, {
      method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: 'none', scope: 'openid' }),
    }));
    oauthClientId = typeof registered.client_id === 'string' ? registered.client_id : undefined;
    expect('Synthetic public OAuth client identity', oauthClientId
      && registered.token_endpoint_auth_method === 'none');
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const authorizeUrl = new URL(authorizationEndpoint);
    authorizeUrl.search = new URLSearchParams({ response_type: 'code', client_id: oauthClientId,
      redirect_uri: redirectUri, scope: 'openid', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    const authorization = await boundedFetch(authorizeUrl, { headers: { apikey: publicKey } });
    expect('OAuth authorization redirects to consent', [302, 303, 307].includes(authorization.status), authorization.status);
    const location = authorization.headers.get('location');
    expect('OAuth authorization has consent location', location);
    let authorizationId: string | null;
    try { authorizationId = new URL(location, url).searchParams.get('authorization_id'); }
    catch { throw new AcceptanceFailure('OAuth consent location was invalid.'); }
    expect('OAuth consent authorization ID returned', authorizationId);
    await authorization.body?.cancel();
    const details = await client.auth.oauth.getAuthorizationDetails(authorizationId);
    expect('OAuth consent belongs to own synthetic user and client', !details.error && details.data
      && 'authorization_id' in details.data && details.data.authorization_id === authorizationId
      && details.data.client.id === oauthClientId && details.data.user.id === fixtureId
      && details.data.redirect_uri === redirectUri);
    const approved = await client.rpc('approve_equity_oauth_client', {
      p_client_id: oauthClientId, p_client_name: clientName,
    });
    expect('Independent Equity permission explicitly approved', !approved.error
      && record(approved.data).clientId === oauthClientId && record(approved.data).revokedAt === null);
    const consent = await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    expect('Own OAuth authorization approved', !consent.error && consent.data?.redirect_url);
    let callback: URL;
    try { callback = new URL(consent.data.redirect_url); }
    catch { throw new AcceptanceFailure('OAuth callback was invalid.'); }
    const code = callback.searchParams.get('code');
    expect('OAuth callback and state verified', `${callback.origin}${callback.pathname}` === redirectUri
      && callback.searchParams.get('state') === state && code && !callback.searchParams.has('error'));
    const tokens = await readJson(await request('Real PKCE authorization code exchanged', tokenEndpoint, {
      method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: oauthClientId,
        redirect_uri: redirectUri, code, code_verifier: verifier }),
    }));
    const oauthToken = tokens.access_token;
    expect('OAuth access token issued', typeof oauthToken === 'string' && oauthToken && oauthToken !== directToken);
    await denied('Equity approval does not authorize Finance', oauthToken, 403);
    const financeApproval = await client.rpc('approve_finance_oauth_client', {
      p_client_id: oauthClientId, p_client_name: clientName,
    });
    expect('Own Finance permission explicitly approved', !financeApproval.error
      && record(financeApproval.data).clientId === oauthClientId && record(financeApproval.data).revokedAt === null);
    const initialized = await mcp('Approved Finance MCP initialized', oauthToken, 'initialize', {
      protocolVersion, capabilities: {}, clientInfo: { name: 'helm-finance-acceptance', version: '1.0.0' },
    });
    expect('Finance MCP protocol negotiated', typeof initialized.protocolVersion === 'string');
    protocolVersion = initialized.protocolVersion;
    await request('MCP initialized notification accepted', resource,
      mcpInit(oauthToken, 'notifications/initialized', {}));
    const catalogue = await mcp('Approved Finance tools listed', oauthToken, 'tools/list');
    const expectedTools = ['finance_get_review', 'finance_save_review'].sort();
    expect('Exactly two Finance tools published', Array.isArray(catalogue.tools)
      && JSON.stringify(catalogue.tools.map(tool => record(tool).name).sort()) === JSON.stringify(expectedTools));
    const empty = await mcp('Empty synthetic review read', oauthToken, 'tools/call', { name: 'finance_get_review', arguments: {} });
    expect('New account has no review', empty.isError !== true && record(empty.structuredContent).result === null);
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
    const saveArgs = { requestId: randomUUID(), review, expectedUpdatedAt: null };
    const saved = await callTool('Synthetic review saved', oauthToken, 'finance_save_review', saveArgs);
    const savedReview = record(saved.review);
    expect('Synthetic review persisted with server lifecycle', savedReview.id === 'current'
      && typeof savedReview.updatedAt === 'string' && typeof savedReview.createdAt === 'string');
    const replay = await callTool('Synthetic review replayed', oauthToken, 'finance_save_review', saveArgs);
    expect('Exact replay returns original receipt', JSON.stringify(replay) === JSON.stringify(saved));
    const changedReplay = await mcp('Changed retry rejected', oauthToken, 'tools/call', {
      name: 'finance_save_review', arguments: { ...saveArgs, review: { ...review, notes: ['Changed synthetic input'] } },
    });
    expect('Changed input cannot reuse a request id', changedReplay.isError === true);
    const updated = await callTool('Synthetic review updated', oauthToken, 'finance_save_review', {
      requestId: randomUUID(), review: { ...review, notes: ['Updated synthetic review'] }, expectedUpdatedAt: savedReview.updatedAt,
    });
    expect('Update advances revision and preserves lifecycle', record(updated.review).updatedAt !== savedReview.updatedAt
      && record(updated.review).createdAt === savedReview.createdAt);
    const stale = await mcp('Stale review rejected', oauthToken, 'tools/call', {
      name: 'finance_save_review', arguments: { requestId: randomUUID(), review, expectedUpdatedAt: savedReview.updatedAt },
    });
    expect('Stale write fails closed', stale.isError === true);
    const fetched = await callTool('Synthetic review read back', oauthToken, 'finance_get_review', {});
    expect('Readback preserves exact review', JSON.stringify(fetched) === JSON.stringify(updated.review));
    const loan = Array.isArray(fetched.loans) ? record(fetched.loans[0]) : {};
    expect('Loan balance and settlement remain distinct', loan.balancePence === 700000 && loan.settlementPence === 650000);
    const revoked = await client.rpc('revoke_finance_oauth_client', { p_client_id: oauthClientId });
    expect('Own Finance permission revoked', !revoked.error && record(revoked.data).clientId === oauthClientId
      && typeof record(revoked.data).revokedAt === 'string');
    await denied('Revoked Finance OAuth client denied immediately', oauthToken, 403);
  } catch (error) {
    failure = error;
  } finally {
    // Each cleanup is attempted independently, even after any earlier failure.
    if (directToken) {
      try {
        const revoked = await admin.auth.admin.signOut(directToken, 'global');
        expect('Synthetic Auth sessions revoked', !revoked.error);
      } catch (error) { failure ||= error; }
    }
    if (oauthClientId) {
      try {
        const removed = await admin.auth.admin.oauth.deleteClient(oauthClientId);
        expect('Own synthetic OAuth client deleted', !removed.error);
        clientRemoved = true;
      } catch (error) { failure ||= error; }
    }
    if (fixtureId) {
      try {
        const removed = await admin.auth.admin.deleteUser(fixtureId);
        expect('Own synthetic Auth user and account data deleted', !removed.error);
        fixtureRemoved = true;
      } catch (error) { failure ||= error; }
    }
  }
  if (failure) throw failure;
  passed = fixtureRemoved && clientRemoved;
}

main().catch(error => {
  // Only locally defined static failure messages and numeric statuses escape.
  console.error(error instanceof AcceptanceFailure ? error.message : 'Hosted Finance acceptance failed.');
  process.exitCode = 1;
}).finally(async () => {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/finance-access-post-deploy.json', `${JSON.stringify({
    deploymentSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null,
    passed, fixtureCreationAttempted, fixtureRemoved, clientCreationAttempted, clientRemoved, observations,
  }, null, 2)}\n`);
});

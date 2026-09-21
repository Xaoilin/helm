#!/usr/bin/env tsx
// Protected-CI acceptance only. Creates its own synthetic Auth user and OAuth
// client, then accesses only that user's Equity through the published MCP.
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
const functionBase = `${url}/functions/v1/sabah-one-equity-mcp`;
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
    throw new AcceptanceFailure('Equity MCP response was not valid JSON or SSE for the requested message.');
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
  const metadata = await readJson(await request('Equity resource discovery',
    `${functionBase}/.well-known/oauth-protected-resource`));
  expect('Live Equity metadata matches exact protected candidate', metadata.deploymentSha === sha
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
  const email = `helm-equity-acceptance-${runId}@example.invalid`;
  const clientName = `Sabah One Equity acceptance ${runId}`;
  // This callback is never fetched or listened on; only its returned code/state
  // are inspected. No real browser or existing client/session is involved.
  const redirectUri = 'http://127.0.0.1:49197/helm-equity-acceptance';
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
    await denied('Direct first-party session denied by Equity MCP', directToken, 401);

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
    expect('Own Equity permission explicitly approved', !approved.error
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
    const initialized = await mcp('Approved Equity MCP initialized', oauthToken, 'initialize', {
      protocolVersion, capabilities: {}, clientInfo: { name: 'helm-equity-acceptance', version: '1.0.0' },
    });
    expect('Equity MCP protocol negotiated', typeof initialized.protocolVersion === 'string');
    protocolVersion = initialized.protocolVersion;
    await request('MCP initialized notification accepted', resource,
      mcpInit(oauthToken, 'notifications/initialized', {}));
    const catalogue = await mcp('Approved Equity tools listed', oauthToken, 'tools/list');
    const expectedTools = ['equity_list_positions', 'equity_get_position', 'equity_add_position',
      'equity_update_position', 'equity_remove_position'].sort();
    expect('Exactly five Equity tools published', Array.isArray(catalogue.tools)
      && JSON.stringify(catalogue.tools.map(tool => record(tool).name).sort()) === JSON.stringify(expectedTools));

    const positionId = randomUUID();
    const company = `HELM synthetic acceptance ${runId}`;
    const asOf = '2026-09-21';
    const position = {
      id: positionId, company, asOf, ownedShares: 5,
      stockPlan: { summary: 'Synthetic stock plan', status: 'undecided', waitingFor: '', nextAction: 'Review fixture' },
      optionPlan: { summary: 'Synthetic option plan', status: 'tentative', waitingFor: 'Synthetic event', nextAction: 'Review fixture' },
      employmentNote: 'Synthetic acceptance fixture only.',
      grants: [{ id: 'synthetic-grant', grantDate: asOf, vested: 2, unvested: 3,
        strikeUsd: 1, originalExpiry: '2036-01-01' }],
      actions: [{ id: 'synthetic-action', title: 'Review fixture', timing: 'During acceptance', done: false }],
      details: [{ id: 'synthetic-detail', title: 'Boundary', body: 'Synthetic Equity acceptance only.' }],
      sources: [{ id: 'synthetic-source', label: 'Synthetic source', url: 'https://example.invalid/equity', asOf }],
      scenario: { pricesUsd: [10], withholdingRate: 0.5, usdToGbp: 0.75, asOf, notes: 'Synthetic only.' },
    };
    const addArgs = { requestId: randomUUID(), position };
    const added = await callTool('Synthetic position added', oauthToken, 'equity_add_position', addArgs);
    expect('Synthetic position addition persisted', added.positionId === positionId
      && record(added.position).company === company && record(added.position).ownedShares === 5);
    const addReplay = await callTool('Synthetic addition replayed', oauthToken, 'equity_add_position', addArgs);
    expect('Position retry returns the original receipt', addReplay.positionId === positionId
      && addReplay.accountVersion === added.accountVersion && JSON.stringify(addReplay) === JSON.stringify(added));
    const addedPosition = record(added.position);
    const addedUpdatedAt = addedPosition.updatedAt;
    const draft = { ...addedPosition };
    delete draft.id;
    delete draft.createdAt;
    delete draft.updatedAt;
    expect('Added position returns server lifecycle fields', typeof addedUpdatedAt === 'string');
    const updated = await callTool('Synthetic owned shares updated', oauthToken, 'equity_update_position', {
      requestId: randomUUID(), positionId, position: { ...draft, ownedShares: 7 }, expectedUpdatedAt: addedUpdatedAt,
    });
    const updatedPosition = record(updated.position);
    expect('Owned shares update persisted without changing grant balances', updatedPosition.ownedShares === 7
      && Array.isArray(updatedPosition.grants) && record(updatedPosition.grants[0]).vested === 2);
    const fetched = await callTool('Synthetic position read back', oauthToken, 'equity_get_position', { positionId });
    const fetchedPosition = record(fetched.position);
    expect('Readback preserves separate stock and option data', fetchedPosition.id === positionId
      && fetchedPosition.company === company && fetchedPosition.ownedShares === 7
      && Array.isArray(fetchedPosition.grants) && record(fetchedPosition.grants[0]).unvested === 3);
    const listed = await callTool('Synthetic position found in bounded search', oauthToken, 'equity_list_positions', {
      query: company, limit: 10, offset: 0,
    });
    expect('List returns only the updated synthetic position', Array.isArray(listed.positions)
      && listed.positions.length === 1 && record(listed.positions[0]).id === positionId);
    await callTool('Own synthetic position removed', oauthToken, 'equity_remove_position', {
      requestId: randomUUID(), positionId, confirmed: true, expectedUpdatedAt: fetchedPosition.updatedAt,
    });
    const removed = await callTool('Synthetic removal read back', oauthToken, 'equity_list_positions', { query: company });
    expect('Synthetic position no longer appears', Array.isArray(removed.positions) && removed.positions.length === 0);
    const revoked = await client.rpc('revoke_equity_oauth_client', { p_client_id: oauthClientId });
    expect('Own Equity permission revoked', !revoked.error && record(revoked.data).clientId === oauthClientId
      && typeof record(revoked.data).revokedAt === 'string');
    await denied('Revoked Equity OAuth client denied immediately', oauthToken, 403);
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
  console.error(error instanceof AcceptanceFailure ? error.message : 'Hosted Equity acceptance failed.');
  process.exitCode = 1;
}).finally(async () => {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/equity-access-post-deploy.json', `${JSON.stringify({
    deploymentSha: /^[a-f0-9]{40}$/.test(sha) ? sha : null,
    passed, fixtureCreationAttempted, fixtureRemoved, clientCreationAttempted, clientRemoved, observations,
  }, null, 2)}\n`);
});

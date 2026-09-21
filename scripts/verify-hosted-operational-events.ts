#!/usr/bin/env tsx
// Protected-CI acceptance only. Creates and removes its own synthetic Auth
// identity, then sends content-free operational metadata to the deployed
// collector. Never reads application records or reuses a person's session.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/u, '');
const publicKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const sha = process.env.ASSISTANT_DEPLOY_SHA || '';
const managementToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const functionUrl = `${url}/functions/v1/operational-events`;
const observations: Array<{ scenario: string; status?: number; passed: boolean }> = [];
const acceptedEventIds: string[] = [];
const acceptedCorrelationIds: string[] = [];
let controlledFailureRecovery: {
  boundary: string;
  correlationId: string;
  failureEventId: string;
  recoveryEventId: string;
  failureStatus: number;
  recoveryStatus: number;
  failureDurationMs: number;
  recoveryRequestDurationMs: number;
  recoveryMs: number;
} | null = null;
let fixtureRemoved = false;
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
    // Fetch and SDK errors may contain URLs, tokens, or response bodies.
    throw new AcceptanceFailure('Operational acceptance network request failed.');
  }
}

async function request(scenario: string, init: RequestInit, expected: number): Promise<Response> {
  const response = await boundedFetch(functionUrl, init);
  expect(scenario, response.status === expected, response.status);
  return response;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return record(await response.json());
  } catch {
    throw new AcceptanceFailure('Operational acceptance response was not valid JSON.');
  }
}

async function main() {
  expect('Exact target and protected acceptance configuration', /^[a-z0-9]+$/u.test(projectRef)
    && url === `https://${projectRef}.supabase.co` && publicKey && managementToken && /^[a-f0-9]{40}$/u.test(sha));

  const packageJson = record(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')));
  expect('Repository release is a bounded semantic version', typeof packageJson.version === 'string'
    && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(packageJson.version));

  const correlationId = randomUUID();
  const probeEvent = {
    id: randomUUID(),
    correlationId,
    occurredAt: new Date().toISOString(),
    release: packageJson.version,
    domain: 'release',
    operation: 'request',
    outcome: 'pending',
    reason: 'unknown',
    attempt: 1,
    durationMs: 0,
    recoveryMs: null,
    freshness: 'fresh',
  };
  const commonHeaders = { apikey: publicKey, 'Content-Type': 'application/json' };

  const health = await readJson(await request('Public collector health', { method: 'GET' }, 200));
  expect('Live collector health matches exact protected candidate', health.ok === true
    && health.releaseSha === sha && health.schemaVersion === 1 && health.enabled === true);

  const missing = await request('Missing token denied', {
    method: 'POST', headers: commonHeaders, body: JSON.stringify({ events: [probeEvent] }),
  }, 401);
  await missing.body?.cancel();
  const failureStarted = performance.now();
  const invalid = await request('Invalid token denied', {
    method: 'POST', headers: { ...commonHeaders, Authorization: 'Bearer invalid-acceptance-token' },
    body: JSON.stringify({ events: [probeEvent] }),
  }, 401);
  await invalid.body?.cancel();
  const failureDurationMs = Math.max(0, Math.round(performance.now() - failureStarted));
  const failureObservedAt = Date.now();
  const failureEvent = {
    id: randomUUID(), correlationId, occurredAt: new Date(failureObservedAt).toISOString(),
    release: packageJson.version, domain: 'auth', operation: 'request', outcome: 'failed',
    reason: 'unauthorized', attempt: 1, durationMs: failureDurationMs, recoveryMs: null,
    freshness: 'fresh',
  };

  const keysResponse = await boundedFetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${managementToken}` },
  });
  expect('Synthetic Auth fixture administration configuration', keysResponse.ok, keysResponse.status);
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
  const email = `helm-operational-acceptance-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user?.id) throw new AcceptanceFailure('Synthetic Auth identity creation failed.');
  const fixtureId = created.data.user.id;
  let accessToken: string | undefined;
  let failure: unknown;
  try {
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || !link.data.properties?.hashed_token || link.data.user?.id !== fixtureId) {
      throw new AcceptanceFailure('Synthetic Auth login link failed.');
    }
    const login = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
    accessToken = login.data.session?.access_token;
    if (login.error || login.data.user?.id !== fixtureId || !accessToken) {
      throw new AcceptanceFailure('Synthetic Auth session verification failed.');
    }

    const recoveryStarted = performance.now();
    const acceptedFailure = await readJson(await request('Measured controlled failure event accepted', {
      method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ events: [failureEvent] }),
    }, 200));
    const recoveryRequestDurationMs = Math.max(0, Math.round(performance.now() - recoveryStarted));
    const recoveryObservedAt = Date.now();
    expect('Collector reports measured failure accepted by exact candidate', acceptedFailure.ok === true
      && acceptedFailure.accepted === 1 && acceptedFailure.releaseSha === sha && acceptedFailure.schemaVersion === 1);
    acceptedEventIds.push(failureEvent.id);
    acceptedCorrelationIds.push(correlationId);

    const recoveryEvent = {
      id: randomUUID(), correlationId, occurredAt: new Date(recoveryObservedAt).toISOString(),
      release: packageJson.version, domain: 'auth', operation: 'request', outcome: 'recovered',
      reason: 'ok', attempt: 2, durationMs: recoveryRequestDurationMs,
      recoveryMs: Math.max(0, recoveryObservedAt - failureObservedAt), freshness: 'fresh',
    };
    const acceptedRecovery = await readJson(await request('Measured controlled recovery event accepted', {
      method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ events: [recoveryEvent] }),
    }, 200));
    expect('Collector reports measured recovery accepted by exact candidate', acceptedRecovery.ok === true
      && acceptedRecovery.accepted === 1 && acceptedRecovery.releaseSha === sha && acceptedRecovery.schemaVersion === 1);
    acceptedEventIds.push(recoveryEvent.id);
    controlledFailureRecovery = {
      boundary: 'synthetic invalid-bearer denial followed by fixture-authenticated collector acceptance',
      correlationId,
      failureEventId: failureEvent.id,
      recoveryEventId: recoveryEvent.id,
      failureStatus: 401,
      recoveryStatus: 200,
      failureDurationMs,
      recoveryRequestDurationMs,
      recoveryMs: recoveryEvent.recoveryMs,
    };

    const rejectedMarker = 'synthetic-content-must-not-enter-operational-logs';
    const rejected = await request('Unknown content field rejected before logging', {
      method: 'POST', headers: { ...commonHeaders, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ events: [{ ...recoveryEvent, id: randomUUID(), message: rejectedMarker }] }),
    }, 400);
    const rejectedBody = await rejected.text();
    expect('Rejection does not echo arbitrary content', !rejectedBody.includes(rejectedMarker));
  } catch (error) {
    failure = error;
  }

  try {
    if (accessToken) {
      const revoked = await admin.auth.admin.signOut(accessToken, 'global');
      if (revoked.error) throw new AcceptanceFailure('Synthetic Auth session revocation failed.');
    }
  } catch {
    failure = new AcceptanceFailure('Synthetic Auth session revocation failed.');
  }
  try {
    const removed = await admin.auth.admin.deleteUser(fixtureId);
    if (removed.error) throw new AcceptanceFailure('Synthetic Auth fixture cleanup failed.');
    fixtureRemoved = true;
  } catch {
    failure = new AcceptanceFailure('Synthetic Auth fixture cleanup failed.');
  }
  if (failure) throw failure;
  passed = true;
  console.log(`Operational failure/recovery correlation ID: ${correlationId}`);
}

main().catch(error => {
  console.error(error instanceof AcceptanceFailure ? error.message : 'Hosted operational acceptance failed.');
  process.exitCode = 1;
}).finally(async () => {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/operational-events-post-deploy.json', `${JSON.stringify({
    deploymentSha: sha,
    schemaVersion: 1,
    passed,
    fixtureRemoved,
    acceptedEventIds,
    acceptedCorrelationIds,
    controlledFailureRecovery,
    retainedReadback: { required: true, interface: 'Supabase Dashboard Unified Logs' },
    observations,
  }, null, 2)}\n`);
});

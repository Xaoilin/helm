#!/usr/bin/env tsx
// Engineering acceptance only: creates and removes its own synthetic Auth identity.
// Never reads or mutates application records or reuses a person's session.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { benchmarkAuthorization } from './lib/assistantBenchmarkAuth';

const url = process.env.VITE_SUPABASE_URL || '';
const publicKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const sha = process.env.ASSISTANT_DEPLOY_SHA || '';
const managementToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const enabled = process.env.HOSTED_AI_ENABLED === 'true';
const mode = enabled ? 'enabled' : 'paused';
const observations: Array<{ scenario: string; status: number; passed: boolean }> = [];
let fixtureRemoved = false;
let passed = false;

async function probe(scenario: string, functionName: string, authorization: string | undefined, action: string, expected: number) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { apikey: publicKey, 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ action, messages: [{ role: 'user', content: 'Reply with ready.' }],
      ...(action === 'chat' ? { format: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'], additionalProperties: false } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  observations.push({ scenario, status: response.status, passed: response.status === expected });
  if (response.status !== expected) throw new Error(`${scenario}: expected HTTP ${expected}, received ${response.status}`);
  return response;
}

async function probePaused(scenario: string, functionName: string, authorization: string, action: string) {
  const response = await probe(scenario, functionName, authorization, action, 503);
  const body = await response.json();
  if (body.code !== 'hosted_ai_paused' || body.mode !== 'paused' || body.deploymentSha !== sha) {
    observations[observations.length - 1].passed = false;
    throw new Error(`${scenario}: explicit paused result and exact SHA are required.`);
  }
}

async function main() {
  if (!url || !publicKey || !managementToken || !projectRef || new URL(url).hostname !== `${projectRef}.supabase.co`) {
    throw new Error('Exact Supabase target and engineering acceptance credentials are required.');
  }
  if (!['true', 'false'].includes(process.env.HOSTED_AI_ENABLED || '')) throw new Error('Explicit hosted AI acceptance mode is required.');
  const machine = () => benchmarkAuthorization(process.env.ASSISTANT_BENCHMARK_SECRET || '', sha);
  const health = await probe('authorized machine health', 'assistant-openai', machine(), 'health', 200);
  const healthBody = await health.json();
  if (healthBody.deploymentSha !== sha || healthBody.mode !== mode || !healthBody.ok) throw new Error('Live function SHA or operating mode does not match the protected candidate.');
  for (const functionName of ['assistant-openai', 'assistant-openai-billing']) {
    for (const [label, token] of [['missing', undefined], ['public key', `Bearer ${publicKey}`], ['invalid', 'Bearer invalid-acceptance-token']]) {
      await probe(`${functionName}: ${label} denied`, functionName, token, functionName.endsWith('billing') ? 'summary' : 'turn', 401);
    }
  }
  await probe('machine narration denied', 'assistant-openai', machine(), 'chat', 403);
  await probe('machine billing denied', 'assistant-openai-billing', machine(), 'summary', 401);

  if (!enabled) await probePaused('machine planner paused', 'assistant-openai', machine(), 'turn');

  const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${managementToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!keysResponse.ok) throw new Error(`Synthetic Auth fixture configuration unavailable (HTTP ${keysResponse.status}).`);
  const keys = await keysResponse.json() as Array<{ name: string; api_key: string }>;
  const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
  if (!serviceKey) throw new Error('Synthetic Auth fixture administration credential unavailable.');
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  const admin = createClient(url, serviceKey, options);
  const client = createClient(url, publicKey, options);
  const email = `helm-auth-acceptance-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user?.id) throw new Error('Synthetic Auth identity creation failed.');
  const fixtureId = created.data.user.id;
  let accessToken: string | undefined;
  let failure: unknown;
  try {
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || !link.data.properties?.hashed_token || link.data.user?.id !== fixtureId) throw new Error('Synthetic Auth login link failed.');
    const login = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
    if (login.error || login.data.user?.id !== fixtureId || !login.data.session?.access_token) throw new Error('Synthetic Auth session verification failed.');
    accessToken = login.data.session.access_token;
    const userHealth = await probe('verified user health', 'assistant-openai', `Bearer ${accessToken}`, 'health', 200);
    const userHealthBody = await userHealth.json();
    if (userHealthBody.deploymentSha !== sha || userHealthBody.mode !== mode || !userHealthBody.ok) throw new Error('Verified user reached a different deployed SHA or mode.');
    if (enabled) {
      const chat = await probe('verified user chat', 'assistant-openai', `Bearer ${accessToken}`, 'chat', 200);
      if (!(await chat.json()).text?.trim()) throw new Error('Verified user chat returned no text.');
      const turn = await probe('verified user voice planner turn', 'assistant-openai', `Bearer ${accessToken}`, 'turn', 200);
      if ((await turn.json()).turn?.type !== 'text') throw new Error('Verified user planner returned no text turn.');
    } else {
      await probePaused('verified user chat paused', 'assistant-openai', `Bearer ${accessToken}`, 'chat');
      await probePaused('verified user voice planner paused', 'assistant-openai', `Bearer ${accessToken}`, 'turn');
    }
    await probe('non-operator billing denied', 'assistant-openai-billing', `Bearer ${accessToken}`, 'summary', 403);
    if (!enabled) {
      // Only this synthetic identity is temporarily granted the operator role.
      const operator = await admin.auth.admin.updateUserById(fixtureId, { app_metadata: { assistant_billing_operator: true } });
      if (operator.error) throw new Error('Synthetic operator fixture configuration failed.');
      await probePaused('operator billing paused', 'assistant-openai-billing', `Bearer ${accessToken}`, 'summary');
    }
  } catch (error) {
    failure = error;
  }
  // Cleanup only the identity created by this invocation, even if a probe or revocation fails.
  try {
    if (accessToken) {
      const revoked = await admin.auth.admin.signOut(accessToken);
      if (revoked.error) throw new Error('Synthetic Auth session revocation failed.');
    }
  } catch {
    failure = new Error('Synthetic Auth session revocation failed.');
  }
  try {
    const removed = await admin.auth.admin.deleteUser(fixtureId);
    if (removed.error) throw new Error('Synthetic Auth fixture cleanup failed.');
    fixtureRemoved = true;
  } catch {
    failure = new Error('Synthetic Auth fixture cleanup failed.');
  }
  if (failure) throw failure;
  passed = true;
}

main().catch(error => {
  // Only our static error text/status is emitted; no SDK objects or credential-bearing bodies.
  console.error(error instanceof Error ? error.message : 'Hosted access acceptance failed.');
  process.exitCode = 1;
}).finally(async () => {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/assistant-access-post-deploy.json', `${JSON.stringify({ deploymentSha: sha, mode, paidAcceptance: enabled ? 'required' : 'deferred', passed, fixtureRemoved, observations }, null, 2)}\n`);
});

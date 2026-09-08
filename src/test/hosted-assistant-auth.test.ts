import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { benchmarkAuthorization } from '../../scripts/lib/assistantBenchmarkAuth';

const sha = 'a'.repeat(40);
const machineSecret = 'synthetic-benchmark-secret-32-bytes-minimum';
let handler: (request: Request) => Promise<Response>;
let env: Record<string, string>;
const upstream = vi.fn();
const auth = vi.fn();

async function loadHandler(name = 'assistant-openai') {
  const modulePath = `../../supabase/functions/${name}/index.ts`;
  await import(/* @vite-ignore */ modulePath);
}

async function request(authorization?: string, action = 'turn') {
  return handler(new Request('https://example.test/functions/v1/assistant-openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'public-key', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ action, messages: [{ role: 'user', content: 'Hello' }], format: { type: 'object' } }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  env = {
    HOSTED_AI_ENABLED: 'true',
    OPENAI_API_KEY: 'synthetic-provider-key', OPENAI_ADMIN_KEY: 'synthetic-admin-key', OPENAI_PROJECT_ID: 'synthetic-project',
    SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-key', ASSISTANT_BENCHMARK_SECRET: machineSecret,
  };
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] }, serve: (callback: typeof handler) => { handler = callback; } });
  vi.doMock('../../supabase/functions/_shared/assistantDeployment.ts', () => ({ ASSISTANT_DEPLOY_SHA: sha }));
  auth.mockReset().mockImplementation(async () => Response.json({ id: 'synthetic-user', role: 'authenticated', is_anonymous: false }));
  upstream.mockReset().mockImplementation(async () => Response.json({ output_text: 'Hello', model: 'gpt-5.4', data: [] }));
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/auth/v1/user') ? auth(url, init) : upstream(url, init)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([undefined, 'false', 'invalid'])('pauses AI by default (%s), after authentication and scope checks', async (enabled) => {
  if (enabled === undefined) delete env.HOSTED_AI_ENABLED;
  else env.HOSTED_AI_ENABLED = enabled;
  delete env.OPENAI_API_KEY;
  await loadHandler();
  const machine = benchmarkAuthorization(machineSecret, sha);
  expect((await request(undefined)).status).toBe(401);
  expect((await request('Bearer public-key')).status).toBe(401);
  expect((await request(machine, 'chat')).status).toBe(403);
  expect(await (await request('Bearer user-token', 'health')).json()).toMatchObject({ ok: true, mode: 'paused', deploymentSha: sha });
  for (const [token, action] of [['Bearer user-token', 'chat'], ['Bearer user-token', 'turn'], [machine, 'turn']]) {
    const response = await request(token, action);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'hosted_ai_paused', mode: 'paused', deploymentSha: sha });
  }
  expect(upstream).not.toHaveBeenCalled();
});

it('retains billing privilege checks while paused, including for an authorized operator', async () => {
  delete env.HOSTED_AI_ENABLED;
  delete env.OPENAI_ADMIN_KEY;
  await loadHandler('assistant-openai-billing');
  expect((await request('Bearer user-token', 'summary')).status).toBe(403);
  auth.mockImplementation(async () => Response.json({ id: 'operator', role: 'authenticated', app_metadata: { assistant_billing_operator: true } }));
  const response = await request('Bearer operator-token', 'summary');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'hosted_ai_paused', deploymentSha: sha });
  expect(upstream).not.toHaveBeenCalled();
});

describe.each(['assistant-openai', 'assistant-openai-billing'])('%s identity boundary', (name) => {
  it.each([undefined, 'Bearer public-key', 'Bearer invalid-token', 'Bearer expired-token'])('rejects %s before OpenAI work', async (authorization) => {
    auth.mockImplementation(async () => Response.json({ error: 'invalid token' }, { status: 401 }));
    await loadHandler(name);
    expect((await request(authorization)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects anonymous Auth users', async () => {
    auth.mockResolvedValue(Response.json({ id: 'anonymous-user', role: 'authenticated', is_anonymous: true }));
    await loadHandler(name);
    expect((await request('Bearer user-token')).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails closed when Auth verification is unavailable', async () => {
    auth.mockRejectedValue(new Error('Auth network failed'));
    await loadHandler(name);
    const response = await request('Bearer user-token');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'auth_unavailable' });
    expect(upstream).not.toHaveBeenCalled();
  });
});

it.each(['chat', 'turn'])('accepts a verified user for %s through the same provider contract', async (action) => {
  await loadHandler();
  expect((await request('Bearer user-token', action)).status).toBe(200);
  expect(auth).toHaveBeenCalledWith('https://example.test/auth/v1/user', expect.objectContaining({ headers: { apikey: 'public-key', Authorization: 'Bearer user-token' } }));
  expect(upstream).toHaveBeenCalledOnce();
  expect(JSON.parse(upstream.mock.calls[0][1].body)).toMatchObject({ model: 'gpt-5.4' });
});

it('requires current server-owned operator metadata for project billing', async () => {
  await loadHandler('assistant-openai-billing');
  auth.mockImplementation(async () => Response.json({ id: 'user', role: 'authenticated', user_metadata: { assistant_billing_operator: true } }));
  expect((await request('Bearer user-token', 'summary')).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
  auth.mockImplementation(async () => Response.json({ id: 'operator', role: 'authenticated', app_metadata: { assistant_billing_operator: true } }));
  expect((await request('Bearer operator-token', 'summary')).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
});

it('only permits valid, short-lived benchmark signatures for the deployed SHA', async () => {
  await loadHandler();
  const valid = benchmarkAuthorization(machineSecret, sha);
  for (const token of [
    benchmarkAuthorization(machineSecret, 'b'.repeat(40)),
    benchmarkAuthorization('another-synthetic-secret-with-32-bytes', sha),
    benchmarkAuthorization(machineSecret, sha, Date.now() - 600_000),
    benchmarkAuthorization(machineSecret, sha, Date.now() + 600_000),
    `${valid.slice(0, -1)}x`,
  ]) expect((await request(token)).status).toBe(401);
  delete env.ASSISTANT_BENCHMARK_SECRET;
  expect((await request(valid)).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
  env.ASSISTANT_BENCHMARK_SECRET = machineSecret;
  expect((await request(valid, 'chat')).status).toBe(403);
  expect((await request(valid, 'summary')).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
  const health = await request(valid, 'health');
  expect(await health.json()).toMatchObject({ deploymentSha: sha, model: 'gpt-5.4' });
  expect((await request(valid)).status).toBe(200);
  expect(upstream).toHaveBeenCalledOnce();
  expect(auth).not.toHaveBeenCalled();
});

it('never permits benchmark credentials to read project billing', async () => {
  await loadHandler('assistant-openai-billing');
  expect((await request(benchmarkAuthorization(machineSecret, sha), 'summary')).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});

it('does not mint benchmark access without its private credential and immutable SHA', () => {
  expect(() => benchmarkAuthorization('', sha)).toThrow('requires');
  expect(() => benchmarkAuthorization(machineSecret, '')).toThrow('requires');
});

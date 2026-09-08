import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const secretId = 'a0000000-0000-4000-8000-000000000001';
const otherId = 'b0000000-0000-4000-8000-000000000002';
const syntheticKey = 'KAN305_SYNTHETIC_SERVER_ONLY_KEY';
let handler: (request: Request) => Promise<Response>;
let env: Record<string, string>;
const auth = vi.fn();
const metadata = vi.fn();
const reveal = vi.fn();
const provider = vi.fn();

function request(body: unknown = { text: 'Hello', secretId, voiceId: 'publicVoice123' }, token = 'user-a') {
  return handler(new Request('https://example.test/functions/v1/assistant-speech', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  }));
}

beforeEach(async () => {
  vi.resetModules();
  env = { HOSTED_AI_ENABLED: 'true', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public-key' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: (fn: typeof handler) => { handler = fn; } });
  auth.mockReset().mockImplementation(async () => Response.json({ id: 'user-a', role: 'authenticated', is_anonymous: false }));
  metadata.mockReset().mockImplementation(async () => Response.json({ secrets: [{ secretId, kind: 'api_key', archivedAt: null }] }));
  reveal.mockReset().mockImplementation(async () => Response.json({ secretId, value: syntheticKey, notes: 'Private note' }));
  provider.mockReset().mockImplementation(async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 4, 0]), { headers: { 'Content-Type': 'audio/mpeg', 'private-provider-header': syntheticKey } }));
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith('/auth/v1/user')) return auth(url, init);
    if (url.endsWith('/list_helm_secrets')) return metadata(url, init);
    if (url.endsWith('/reveal_helm_secret')) return reveal(url, init);
    if (url.startsWith('https://api.elevenlabs.io/')) return provider(url, init);
    throw new Error('Unexpected network request');
  }));
  const path = '../../supabase/functions/assistant-speech/index.ts';
  await import(/* @vite-ignore */ path);
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([undefined, 'false', 'invalid'])('keeps the hosted AI pause before all Vault and provider work (%s)', async enabled => {
  vi.resetModules();
  if (enabled === undefined) delete env.HOSTED_AI_ENABLED;
  else env.HOSTED_AI_ENABLED = enabled;
  const path = '../../supabase/functions/assistant-speech/index.ts';
  await import(/* @vite-ignore */ path);
  expect((await request(undefined, '')).status).toBe(401);
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'hosted_ai_paused', mode: 'paused' });
  expect(response.headers.get('X-Helm-Deployment-Sha')).toBe('development');
  expect(metadata).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

it.each(['', 'public-key', 'invalid-user', 'benchmark.invalid'])('denies identity %s before Vault/provider access', async token => {
  auth.mockImplementation(async () => Response.json({}, { status: 401 }));
  expect((await request(undefined, token)).status).toBe(401);
  expect(metadata).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

it('fails closed for anonymous users and Auth outage', async () => {
  auth.mockImplementation(async () => Response.json({ id: 'anon', role: 'authenticated', is_anonymous: true }));
  expect((await request()).status).toBe(401);
  auth.mockRejectedValue(new Error(syntheticKey));
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(syntheticKey);
  expect(metadata).not.toHaveBeenCalled();
});

it.each([
  [{ secretId: 'raw-key' }, 400], [{ secretId: otherId }, 404], [{ voiceId: '../escape' }, 400],
  [{ text: '' }, 400], [{ text: 'x'.repeat(5001) }, 400], [{ apiKey: syntheticKey }, 400],
] as const)('rejects invalid or non-owned input before reveal', async (patch, status) => {
  const response = await request({ text: 'Hello', secretId, voiceId: 'voice123', ...patch });
  expect(response.status).toBe(status);
  expect(reveal).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

it('isolates accounts using the caller JWT for both ownership RPCs', async () => {
  metadata.mockImplementation(async (_url: string, init: RequestInit) => Response.json({ secrets: (init.headers as Record<string, string>).Authorization === 'Bearer user-a' ? [{ secretId, kind: 'api_key', archivedAt: null }] : [] }));
  expect((await request(undefined, 'user-b')).status).toBe(404);
  expect(reveal).not.toHaveBeenCalled();
  const response = await request();
  expect(response.status).toBe(200);
  expect(reveal).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer user-a', apikey: 'public-key' }), body: JSON.stringify({ p_secret_id: secretId }) }));
  expect(provider).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/text-to-speech/publicVoice123?output_format=mp3_44100_128', expect.objectContaining({ redirect: 'error' }));
});

it('returns only audio, without provider values, notes or upstream headers', async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('private-provider-header')).toBeNull();
  expect(await response.text()).toBe('ID3\u0004\u0000');
  expect(provider.mock.calls[0][1].headers['xi-api-key']).toBe(syntheticKey);
});

it.each([
  { secretId, kind: 'password', archivedAt: null },
  { secretId, kind: 'api_key', archivedAt: '2026-01-01' },
])('rejects unsupported or archived Vault entries', async entry => {
  metadata.mockImplementation(async () => Response.json({ secrets: [entry] }));
  expect((await request()).status).toBe(404);
  expect(reveal).not.toHaveBeenCalled();
});

it('handles revocation between metadata and reveal without contacting the provider', async () => {
  reveal.mockImplementation(async () => Response.json({ value: syntheticKey }, { status: 404 }));
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(syntheticKey);
  expect(provider).not.toHaveBeenCalled();
});

it.each([401, 429, 500, 200])('sanitizes upstream failure or non-audio response %s', async status => {
  provider.mockImplementation(async () => Response.json({ value: syntheticKey }, { status, headers: { 'x-provider-key': syntheticKey } }));
  const response = await request();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain(syntheticKey);
  expect(response.headers.get('x-provider-key')).toBeNull();
});

it('rejects plaintext mislabeled as audio and network failures without disclosure', async () => {
  provider.mockImplementation(async () => new Response(syntheticKey, { headers: { 'Content-Type': 'audio/mpeg' } }));
  expect((await request()).status).toBe(502);
  provider.mockRejectedValue(new Error(syntheticKey));
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(syntheticKey);
});

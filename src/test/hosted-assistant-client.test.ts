import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { chatWithHostedAssistantDetailed, runHostedAssistantTurn, resetHostedAssistantDiagnostics, testHostedAssistantConnection } from '../services/hostedAssistantApi';
import { fetchHostedAssistantProjectBilling } from '../services/hostedAssistantBillingApi';

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('../config', () => ({ SUPABASE_ANON_KEY: 'public-key', HOSTED_ASSISTANT_FUNCTION: 'assistant-openai', HOSTED_ASSISTANT_BILLING_FUNCTION: 'assistant-openai-billing' }));
vi.mock('../store/supabase', () => ({
  isSupabaseReady: () => true,
  getClient: () => ({ auth: { getSession }, functions: { invoke } }),
  getAuthSessionSnapshot: () => null,
}));
const session = (token = 'current-user-token') => ({ access_token: token, user: { id: 'synthetic-user' }, expires_at: Math.floor(Date.now() / 1000) + 3600 });
const messages = [{ role: 'user' as const, content: 'Hello' }];

beforeEach(() => {
  resetHostedAssistantDiagnostics();
  getSession.mockReset().mockImplementation(async () => ({ data: { session: session() }, error: null }));
  invoke.mockReset().mockResolvedValue({ data: { ok: true, model: 'gpt-5.4', text: 'Hello', turn: { type: 'text', text: 'Hello' } }, error: null });
});
afterEach(() => vi.restoreAllMocks());

it('uses the current session for health, chat, voice planner turns and billing', async () => {
  expect(await testHostedAssistantConnection()).toMatchObject({ status: 'available', accessMode: 'user_session' });
  await chatWithHostedAssistantDetailed(messages, { type: 'object' });
  await runHostedAssistantTurn(messages);
  await fetchHostedAssistantProjectBilling();
  expect(invoke).toHaveBeenCalledTimes(4);
  for (const [, options] of invoke.mock.calls) expect(options.headers).toEqual({ apikey: 'public-key', Authorization: 'Bearer current-user-token' });
  getSession.mockResolvedValue({ data: { session: session('refreshed-user-token') }, error: null });
  await testHostedAssistantConnection();
  expect(invoke.mock.lastCall?.[1].headers.Authorization).toBe('Bearer refreshed-user-token');
});

it.each(['missing', 'expired', 'public-key', 'refresh-error'])('fails closed for %s browser sessions without invoking the function', async (kind) => {
  getSession.mockResolvedValue({ data: { session: kind === 'missing' ? null : { ...session(kind === 'public-key' ? 'public-key' : undefined), ...(kind === 'expired' ? { expires_at: 1 } : {}) } }, error: kind === 'refresh-error' ? new Error('expired refresh') : null });
  expect(await testHostedAssistantConnection()).toMatchObject({ status: 'sign_in_required', accessMode: 'none' });
  await expect(fetchHostedAssistantProjectBilling()).rejects.toThrow('Sign in');
  expect(invoke).not.toHaveBeenCalled();
});

it('maps server token rejection to sign-in and recovers immediately after a new session', async () => {
  invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response('{}', { status: 401 })) });
  for (let attempt = 0; attempt < 6; attempt++) expect(await testHostedAssistantConnection()).toMatchObject({ status: 'sign_in_required' });
  invoke.mockResolvedValue({ data: { ok: true, model: 'gpt-5.4' }, error: null });
  getSession.mockResolvedValue({ data: { session: session('signed-in-again') }, error: null });
  expect(await testHostedAssistantConnection()).toMatchObject({ status: 'available' });
});

import { describe, expect, it, vi } from 'vitest';
import { VOICE, buildVoiceQuestions, cleanVoiceCommand, hasEndCue, isVoiceConfirm, readVoiceDecision, validateVoiceInput, type VoiceInput } from '../../supabase/functions/_shared/jevVoice';
import { createVoiceHandler } from '../../supabase/functions/sabah-one-jev-voice/handler';
import { authorizeVoiceAccount } from '../../supabase/functions/sabah-one-jev-voice/authorization';

const SECRET_ID = '11111111-1111-4111-8111-111111111111';
const input: VoiceInput = { transcript: 'Hey Sabah One, add a task to buy milk, over.', page: 'dashboard',
  items: [{ id: 'tasks:milk', label: 'Buy milk', page: 'tasks', canComplete: true }] };
const choice = (selected: string, probability = 1) => ({ type: 'choice', choice: selected, confidence: probability,
  probabilities: { [selected]: probability, other: 1 - probability } });
const decision = (action = 'add_task', selected = 'span_4', probability = 1) => ({ model: VOICE.model,
  answers: { action: choice(action), text: choice(selected, probability), find_item: choice(selected, probability), complete_item: choice(selected, probability), page: choice(selected, probability) },
  usage: { input_tokens: 1036, output_tokens: 315 } });
function request(action = 'decide', overrides = {}) {
  return new Request('https://voice.test', { method: 'POST', headers: { Authorization: 'Bearer synthetic-session' },
    body: JSON.stringify({ action, secretId: SECRET_ID, input, ...overrides }) });
}

describe('bounded Jev decisions', () => {
  it('uses real typed choices and verbatim text with a wake word and explicit end cue', () => {
    expect(cleanVoiceCommand(input.transcript)).toBe('add a task to buy milk');
    expect(hasEndCue(input.transcript)).toBe(true);
    expect(isVoiceConfirm('Hey Sabah, confirm over')).toBe(true);
    expect(buildVoiceQuestions(input).questions.text.criteria.span_4).toBe('buy milk');
    expect(buildVoiceQuestions(input).questions.find_item.criteria['tasks:milk']).toBe('Item named "Buy milk" in Tasks.');
    expect(readVoiceDecision(decision(), input, 330)).toMatchObject({ action: 'add_task', text: 'buy milk', confident: true });
  });
  it('rejects invented items, unsupported pages, uncertain choices and duplicate completion names', () => {
    expect(readVoiceDecision(decision('complete_task', 'missing'), input, 1).confident).toBe(false);
    expect(readVoiceDecision(decision('navigate', 'terminal'), input, 1).confident).toBe(false);
    expect(readVoiceDecision(decision('add_task', 'span_4', 0.6), input, 1).confident).toBe(false);
    const duplicate = { ...input, items: [...input.items, { ...input.items[0], id: 'tasks:duplicate' }] };
    expect(readVoiceDecision(decision('complete_task', 'tasks:milk'), duplicate, 1).confident).toBe(false);
    expect(readVoiceDecision(decision('complete_task', 'tasks:milk'), { ...input, items: [{ ...input.items[0], canComplete: false }] }, 1).confident).toBe(false);
  });
  it('fails closed on malformed provider data and input beyond the bounded catalogue', () => {
    expect(() => readVoiceDecision({ ...decision(), model: 'unverified-model' }, input, 1)).toThrow();
    expect(() => readVoiceDecision({ ...decision(), usage: { input_tokens: -1 } }, input, 1)).toThrow();
    expect(() => validateVoiceInput({ ...input, items: Array(VOICE.maxItems + 1).fill(input.items[0]) })).toThrow();
    expect(() => validateVoiceInput({ ...input, items: [{ ...input.items[0], page: 'inventory' }] })).toThrow();
  });
});

describe('account-owned provider keys', () => {
  it('validates the session before using the same account-scoped Vault client', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { secrets: [{ secretId: SECRET_ID, label: 'TypeSafe', kind: 'api_key' }] }, error: null })
      .mockResolvedValueOnce({ data: { value: 'synthetic-provider-key' }, error: null });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'account-a' } }, error: null });
    const factory = vi.fn(() => ({ auth: { getUser }, rpc }));
    const account = await authorizeVoiceAccount(request(), factory);
    expect(factory).toHaveBeenCalledWith('synthetic-session');
    expect(getUser).toHaveBeenCalledWith('synthetic-session');
    expect(rpc).not.toHaveBeenCalled();
    expect(await account?.readKey(SECRET_ID, 'jev')).toBe('synthetic-provider-key');
    expect(rpc).toHaveBeenNthCalledWith(2, 'reveal_helm_secret', { p_secret_id: SECRET_ID });
  });
  it.each([
    { secretId: 'another-account-secret', label: 'TypeSafe', kind: 'api_key' },
    { secretId: SECRET_ID, label: 'Deepgram', kind: 'api_key' },
    { secretId: SECRET_ID, label: 'TypeSafe', kind: 'password' },
    { secretId: SECRET_ID, label: 'TypeSafe', kind: 'api_key', archivedAt: '2026-10-09' },
  ])('does not reveal an unavailable or wrong-provider key: %j', async secret => {
    const rpc = vi.fn().mockResolvedValue({ data: { secrets: [secret] }, error: null });
    const account = await authorizeVoiceAccount(request(), () => ({ auth: { getUser: async () => ({ data: { user: {} }, error: null }) }, rpc }));
    expect(await account?.readKey(SECRET_ID, 'jev')).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects expired sessions and Vault denial (including the existing OAuth-client boundary)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } });
    const denied = () => ({ auth: { getUser: async () => ({ data: { user: {} }, error: null }) }, rpc });
    const account = await authorizeVoiceAccount(request(), denied);
    expect(await account?.readKey(SECRET_ID, 'jev')).toBeNull();
    rpc.mockClear();
    expect(await authorizeVoiceAccount(request(), () => ({ auth: { getUser: async () => ({ data: { user: null }, error: {} }) }, rpc }))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('voice Edge Function', () => {
  it('accepts commands from Software and returns Software navigation through the shared contract', async () => {
    const softwareInput: VoiceInput = { transcript: 'Open Software', page: 'software', items: [] };
    expect(validateVoiceInput(softwareInput)).toEqual(softwareInput);
    expect(readVoiceDecision(decision('navigate', 'software'), softwareInput, 1))
      .toMatchObject({ action: 'navigate', page: 'software', confident: true });
    const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(Response.json(decision('navigate', 'software')));
    const handler = createVoiceHandler({ authorize: async () => ({ readKey: async () => 'synthetic-provider-key' }), fetch: fetchProvider, deploymentSha: 'candidate-sha' });
    const response = await handler(request('decide', { input: softwareInput }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: 'navigate', page: 'software', confident: true });
  });
  it('calls the pinned Jev API and never returns the provider key', async () => {
    const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(Response.json(decision()));
    const handler = createVoiceHandler({ authorize: async () => ({ readKey: async () => 'synthetic-provider-key' }), fetch: fetchProvider, deploymentSha: 'candidate-sha' });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ model: VOICE.model, text: 'buy milk', confident: true });
    expect(fetchProvider).toHaveBeenCalledWith(VOICE.endpoint, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer synthetic-provider-key' }) }));
    expect(JSON.parse(String(fetchProvider.mock.calls[0][1]?.body))).toEqual(buildVoiceQuestions(input));
  });
  it('exchanges a Deepgram Vault key for a short-lived token', async () => {
    const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: 'synthetic-ephemeral-token', expires_in: 30 }));
    const readKey = vi.fn().mockResolvedValue('synthetic-provider-key');
    const handler = createVoiceHandler({ authorize: async () => ({ readKey }), fetch: fetchProvider, deploymentSha: 'sha' });
    const response = await handler(request('speech_token'));
    expect(await response.json()).toEqual({ accessToken: 'synthetic-ephemeral-token', expiresIn: 30 });
    expect(readKey).toHaveBeenCalledWith(SECRET_ID, 'speech');
    expect(fetchProvider).toHaveBeenCalledWith('https://api.deepgram.com/v1/auth/grant', expect.objectContaining({ body: '{"ttl_seconds":30}', headers: expect.objectContaining({ Authorization: 'Token synthetic-provider-key' }) }));
  });
  it('rejects anonymous, unavailable keys, malformed inputs and provider errors without leaking bodies', async () => {
    const fetchProvider = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive provider body', { status: 429 }));
    const handler = (account: { readKey: () => Promise<string | null> } | null) => createVoiceHandler({ authorize: async () => account, fetch: fetchProvider, deploymentSha: 'sha' });
    expect((await handler(null)(request())).status).toBe(401);
    expect((await handler({ readKey: async () => null })(request())).status).toBe(403);
    expect((await handler({ readKey: async () => 'key' })(request('decide', { input: {} }))).status).toBe(400);
    expect(fetchProvider).not.toHaveBeenCalled();
    const response = await handler({ readKey: async () => 'key' })(request());
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('sensitive provider body');
  });
});

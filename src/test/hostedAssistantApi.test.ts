import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithHostedAssistant, testHostedAssistantConnection } from '../services/hostedAssistantApi';
import { hostedAssistantBreaker } from '../services/serviceBreakers';

const {
  getClientMock,
  isAuthenticatedMock,
  isSupabaseReadyMock,
  logErrorMock,
} = vi.hoisted(() => ({
  getClientMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  getClient: getClientMock,
  isAuthenticated: isAuthenticatedMock,
  isSupabaseReady: isSupabaseReadyMock,
}));

vi.mock('../services/logger', () => ({
  logError: logErrorMock,
}));

function makeClient(overrides: {
  session?: { access_token?: string } | null;
  sessionError?: { message: string } | null;
  invokeResult?: { data: unknown; error: unknown };
} = {}) {
  const invoke = vi.fn().mockResolvedValue(overrides.invokeResult ?? {
    data: {
      ok: true,
      provider: 'openai',
      model: 'gpt-5.4-mini',
    },
    error: null,
  });

  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: overrides.session === undefined
            ? { access_token: 'supabase-access-token' }
            : overrides.session,
        },
        error: overrides.sessionError ?? null,
      }),
    },
    functions: {
      invoke,
    },
  };
}

describe('hostedAssistantApi', () => {
  beforeEach(() => {
    hostedAssistantBreaker.reset();
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    isAuthenticatedMock.mockReturnValue(true);
  });

  it('passes the Supabase access token when invoking the hosted assistant', async () => {
    const client = makeClient();
    getClientMock.mockReturnValue(client);

    const status = await testHostedAssistantConnection();

    expect(status).toEqual({ status: 'available' });
    expect(client.functions.invoke).toHaveBeenCalledWith('assistant-openai', expect.objectContaining({
      body: { action: 'health' },
      headers: expect.objectContaining({
        Authorization: 'Bearer supabase-access-token',
      }),
    }));
  });

  it('returns sign_in_required when the Supabase session has no access token', async () => {
    const client = makeClient({ session: null });
    getClientMock.mockReturnValue(client);

    const status = await testHostedAssistantConnection();

    expect(status.status).toBe('sign_in_required');
    expect(status.message).toContain('fresh HELM session token');
    expect(client.functions.invoke).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('does not poison the hosted circuit breaker for missing-session-token failures', async () => {
    const client = makeClient({ session: null });
    getClientMock.mockReturnValue(client);

    const first = await testHostedAssistantConnection();
    const second = await testHostedAssistantConnection();

    expect(first.status).toBe('sign_in_required');
    expect(second.status).toBe('sign_in_required');
    expect(hostedAssistantBreaker.isAvailable).toBe(true);
  });

  it('uses the explicit bearer token for hosted chat calls too', async () => {
    const client = makeClient({
      invokeResult: {
        data: {
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4-mini',
          text: '{"answer":"READY"}',
        },
        error: null,
      },
    });
    getClientMock.mockReturnValue(client);

    const text = await chatWithHostedAssistant([
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Say READY.' },
    ], {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    });

    expect(text).toBe('{"answer":"READY"}');
    expect(client.functions.invoke).toHaveBeenCalledWith('assistant-openai', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer supabase-access-token',
      }),
    }));
  });
});

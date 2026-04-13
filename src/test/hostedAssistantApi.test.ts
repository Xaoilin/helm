import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatWithHostedAssistant,
  getHostedAssistantDiagnostics,
  resetHostedAssistantDiagnostics,
  testHostedAssistantConnection,
} from '../services/hostedAssistantApi';
import { hostedAssistantBreaker } from '../services/serviceBreakers';

const {
  getClientMock,
  isSupabaseReadyMock,
  canUseHostedAssistantProjectAccessMock,
  logErrorMock,
  logWarnMock,
} = vi.hoisted(() => ({
  getClientMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  canUseHostedAssistantProjectAccessMock: vi.fn(),
  logErrorMock: vi.fn(),
  logWarnMock: vi.fn(),
}));

vi.mock('../config', () => ({
  HOSTED_ASSISTANT_FUNCTION: 'assistant-openai',
  SUPABASE_ANON_KEY: 'local-anon-key',
}));

vi.mock('../store/supabase', () => ({
  getClient: getClientMock,
  isSupabaseReady: isSupabaseReadyMock,
}));

vi.mock('../services/hostedAssistantAccess', () => ({
  canUseHostedAssistantProjectAccess: canUseHostedAssistantProjectAccessMock,
}));

vi.mock('../services/logger', () => ({
  logError: logErrorMock,
  logWarn: logWarnMock,
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
      model: 'gpt-5.4',
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
    resetHostedAssistantDiagnostics();
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    canUseHostedAssistantProjectAccessMock.mockReturnValue(true);
  });

  it('passes the configured project access key when invoking the hosted assistant', async () => {
    const client = makeClient();
    getClientMock.mockReturnValue(client);

    const status = await testHostedAssistantConnection();

    expect(status).toEqual({ status: 'available', accessMode: 'project_key', model: 'gpt-5.4' });
    expect(client.functions.invoke).toHaveBeenCalledWith('assistant-openai', expect.objectContaining({
      body: { action: 'health' },
      headers: expect.objectContaining({
        apikey: 'local-anon-key',
        Authorization: 'Bearer local-anon-key',
      }),
    }));
  });

  it('passes the selected hosted model through the health check request', async () => {
    const client = makeClient({
      invokeResult: {
        data: {
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4-mini',
        },
        error: null,
      },
    });
    getClientMock.mockReturnValue(client);

    const status = await testHostedAssistantConnection({ model: 'gpt-5.4-mini' });

    expect(status).toEqual({ status: 'available', accessMode: 'project_key', model: 'gpt-5.4-mini' });
    expect(client.functions.invoke).toHaveBeenCalledWith('assistant-openai', expect.objectContaining({
      body: {
        action: 'health',
        model: 'gpt-5.4-mini',
      },
    }));
  });

  it('returns not_configured when project access is unavailable in the current build', async () => {
    const client = makeClient();
    getClientMock.mockReturnValue(client);
    canUseHostedAssistantProjectAccessMock.mockReturnValue(false);

    const status = await testHostedAssistantConnection();

    expect(status.status).toBe('not_configured');
    expect(status.message).toContain('project access');
    expect(client.functions.invoke).not.toHaveBeenCalled();
    expect(hostedAssistantBreaker.isAvailable).toBe(true);
  });

  it('uses the explicit bearer token for hosted chat calls too', async () => {
    const client = makeClient({
      invokeResult: {
        data: {
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
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
        apikey: 'local-anon-key',
        Authorization: 'Bearer local-anon-key',
      }),
    }));
  });

  it('passes the selected hosted model through chat requests', async () => {
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

    await chatWithHostedAssistant([
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Say READY.' },
    ], {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    }, {
      model: 'gpt-5.4-mini',
    });

    expect(client.functions.invoke).toHaveBeenCalledWith('assistant-openai', expect.objectContaining({
      body: expect.objectContaining({
        action: 'chat',
        model: 'gpt-5.4-mini',
      }),
    }));
  });

  it('preserves the last hosted chat failure when the circuit breaker opens', async () => {
    const upstreamError = "OpenAI error 400: Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.";
    const client = makeClient({
      invokeResult: {
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: {
            headers: {
              get: (name: string) => name === 'content-type' ? 'application/json' : null,
            },
            json: async () => ({
              error: upstreamError,
            }),
            text: async () => JSON.stringify({
              error: upstreamError,
            }),
          },
        },
      },
    });
    getClientMock.mockReturnValue(client);

    await expect(chatWithHostedAssistant([
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Say READY.' },
    ], {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    })).rejects.toThrow('input_text');

    await expect(chatWithHostedAssistant([
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Say READY.' },
    ], {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    })).rejects.toThrow('input_text');

    expect(hostedAssistantBreaker.isAvailable).toBe(false);
    expect(getHostedAssistantDiagnostics()).toEqual(expect.objectContaining({
      lastFailureSource: 'chat',
      lastFailureMessage: expect.stringContaining("Invalid value: 'input_text'"),
      projectAccessAvailable: true,
    }));

    await expect(chatWithHostedAssistant([
      { role: 'system', content: 'Reply with JSON.' },
      { role: 'user', content: 'Say READY.' },
    ], {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    })).rejects.toThrow(/chat request last failed: .*input_text.*Circuit breaker open/i);
  });
});

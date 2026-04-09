import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { HOSTED_ASSISTANT_FUNCTION } from '../config';
import { API_TIMEOUT } from '../config/constants';
import { getClient, isAuthenticated, isSupabaseReady } from '../store/supabase';
import { logError } from './logger';
import { hostedAssistantBreaker } from './serviceBreakers';
import type { OllamaMessage } from './ollamaApi';

interface HostedAssistantHealthResponse {
  ok: boolean;
  provider: 'openai';
  model: string;
}

interface HostedAssistantChatResponse {
  ok: boolean;
  provider: 'openai';
  model: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface HostedAssistantConnectionStatus {
  status: 'available' | 'sign_in_required' | 'not_configured' | 'unavailable';
  message?: string;
}

class HostedAssistantSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAssistantSessionError';
  }
}

function isHttpError(error: unknown): error is FunctionsHttpError {
  return error instanceof FunctionsHttpError;
}

async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return error.message;
  }

  if (isHttpError(error)) {
    const response = error.context;
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
          return data.error;
        }
      }

      const text = await response.text();
      if (text) return text;
    } catch {
      return error.message;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function getHostedAssistantClient() {
  if (!isSupabaseReady()) {
    throw new Error('Supabase is not configured.');
  }
  if (!isAuthenticated()) {
    throw new Error('Sign in with Google to use hosted AI.');
  }

  const client = getClient();
  if (!client) {
    throw new Error('Supabase client unavailable.');
  }

  return client;
}

function isHostedSessionError(error: unknown): boolean {
  return error instanceof HostedAssistantSessionError;
}

function shouldTreatErrorAsSignInRequired(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('missing authorization header')
    || normalized.includes('jwt')
    || normalized.includes('authorization header')
    || normalized.includes('session token')
    || normalized.includes('sign in');
}

async function getHostedAssistantAuthHeaders(client: NonNullable<ReturnType<typeof getClient>>): Promise<Record<string, string>> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new HostedAssistantSessionError(`Hosted AI could not read the current HELM session: ${error.message}`);
  }

  const accessToken = data.session?.access_token?.trim();
  if (!accessToken) {
    throw new HostedAssistantSessionError('Hosted AI needs a fresh HELM session token. Sign out and sign back in, then retry.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function invokeHostedAssistant<T>(body: Record<string, unknown>): Promise<T> {
  return hostedAssistantBreaker.call(async () => {
    const client = getHostedAssistantClient();
    const headers = await getHostedAssistantAuthHeaders(client);
    const { data, error } = await client.functions.invoke<T>(HOSTED_ASSISTANT_FUNCTION, {
      body,
      headers,
      timeout: API_TIMEOUT.HOSTED_ASSISTANT_CHAT,
    });

    if (error) {
      const message = await extractFunctionErrorMessage(error);
      if (shouldTreatErrorAsSignInRequired(message)) {
        throw new HostedAssistantSessionError(`Hosted AI needs you to sign in again: ${message}`);
      }
      throw new Error(message);
    }

    if (!data) {
      throw new Error('Hosted assistant returned no data.');
    }

    return data;
  }, {
    shouldRecordFailure: error => !isHostedSessionError(error),
  });
}

export async function testHostedAssistantConnection(): Promise<HostedAssistantConnectionStatus> {
  if (!isSupabaseReady()) {
    return { status: 'not_configured', message: 'Supabase is not configured.' };
  }

  if (!isAuthenticated()) {
    return { status: 'sign_in_required', message: 'Sign in with Google to use hosted AI.' };
  }

  try {
    const data = await invokeHostedAssistant<HostedAssistantHealthResponse>({ action: 'health' });
    return data.ok
      ? { status: 'available' }
      : { status: 'unavailable', message: 'Hosted assistant health check failed.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isHostedSessionError(error)) {
      return { status: 'sign_in_required', message };
    }
    logError('HostedAssistant', error);
    return { status: 'unavailable', message };
  }
}

export async function chatWithHostedAssistant(
  messages: OllamaMessage[],
  format: unknown,
): Promise<string> {
  const data = await invokeHostedAssistant<HostedAssistantChatResponse>({
    action: 'chat',
    messages,
    format,
  });

  if (!data.ok || !data.text?.trim()) {
    throw new Error('Hosted assistant returned an empty response.');
  }

  return data.text;
}

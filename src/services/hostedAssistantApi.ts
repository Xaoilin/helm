import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { HOSTED_ASSISTANT_FUNCTION } from '../config';
import { API_TIMEOUT } from '../config/constants';
import { getClient, isAuthenticated, isSupabaseReady } from '../store/supabase';
import { CircuitOpenError } from './circuitBreaker';
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

export type HostedAssistantFailureSource = 'health' | 'chat';

interface HostedAssistantFailureState {
  source: HostedAssistantFailureSource;
  message: string;
  occurredAt: string;
}

export interface HostedAssistantDiagnostics {
  circuitAllowingRequests: boolean;
  lastFailureSource: HostedAssistantFailureSource | null;
  lastFailureMessage: string | null;
  lastFailureAt: string | null;
}

class HostedAssistantSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAssistantSessionError';
  }
}

const hostedAssistantFailures: Partial<Record<HostedAssistantFailureSource, HostedAssistantFailureState>> = {};

function isHttpError(error: unknown): error is FunctionsHttpError {
  return error instanceof FunctionsHttpError
    || (
      typeof error === 'object'
      && error !== null
      && 'context' in error
      && typeof error.context === 'object'
      && error.context !== null
      && 'headers' in error.context
      && 'json' in error.context
      && 'text' in error.context
    );
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

function rememberHostedAssistantFailure(source: HostedAssistantFailureSource, message: string): void {
  hostedAssistantFailures[source] = {
    source,
    message,
    occurredAt: new Date().toISOString(),
  };
}

function clearHostedAssistantFailure(source: HostedAssistantFailureSource): void {
  delete hostedAssistantFailures[source];
}

function getLastHostedAssistantFailure(): HostedAssistantFailureState | null {
  const failures = Object.values(hostedAssistantFailures);
  if (failures.length === 0) return null;

  return failures
    .slice()
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())[0];
}

function formatHostedAssistantFailureSource(source: HostedAssistantFailureSource): string {
  return source === 'health' ? 'health check' : 'chat request';
}

function decorateCircuitOpenError(error: CircuitOpenError): Error {
  const lastFailure = getLastHostedAssistantFailure();
  if (!lastFailure) {
    return error;
  }

  return new Error(
    `Hosted ${formatHostedAssistantFailureSource(lastFailure.source)} last failed: ${lastFailure.message}. ${error.message}`,
  );
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

export function getHostedAssistantDiagnostics(): HostedAssistantDiagnostics {
  const lastFailure = getLastHostedAssistantFailure();
  return {
    circuitAllowingRequests: hostedAssistantBreaker.isAvailable,
    lastFailureSource: lastFailure?.source ?? null,
    lastFailureMessage: lastFailure?.message ?? null,
    lastFailureAt: lastFailure?.occurredAt ?? null,
  };
}

export function resetHostedAssistantDiagnostics(): void {
  hostedAssistantBreaker.reset();
  delete hostedAssistantFailures.health;
  delete hostedAssistantFailures.chat;
}

async function invokeHostedAssistant<T>(
  source: HostedAssistantFailureSource,
  body: Record<string, unknown>,
): Promise<T> {
  try {
    return await hostedAssistantBreaker.call(async () => {
      const client = getHostedAssistantClient();
      const headers = await getHostedAssistantAuthHeaders(client);
      const { data, error } = await client.functions.invoke<T>(HOSTED_ASSISTANT_FUNCTION, {
        body,
        headers,
        timeout: API_TIMEOUT.HOSTED_ASSISTANT_CHAT,
      });

      if (error) {
        const message = await extractFunctionErrorMessage(error);
        rememberHostedAssistantFailure(source, message);
        if (shouldTreatErrorAsSignInRequired(message)) {
          throw new HostedAssistantSessionError(`Hosted AI needs you to sign in again: ${message}`);
        }
        throw new Error(message);
      }

      if (!data) {
        const message = 'Hosted assistant returned no data.';
        rememberHostedAssistantFailure(source, message);
        throw new Error(message);
      }

      clearHostedAssistantFailure(source);
      return data;
    }, {
      shouldRecordFailure: error => !isHostedSessionError(error),
    });
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      throw decorateCircuitOpenError(error);
    }
    throw error;
  }
}

export async function testHostedAssistantConnection(): Promise<HostedAssistantConnectionStatus> {
  if (!isSupabaseReady()) {
    return { status: 'not_configured', message: 'Supabase is not configured.' };
  }

  if (!isAuthenticated()) {
    return { status: 'sign_in_required', message: 'Sign in with Google to use hosted AI.' };
  }

  try {
    const data = await invokeHostedAssistant<HostedAssistantHealthResponse>('health', { action: 'health' });
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
  const data = await invokeHostedAssistant<HostedAssistantChatResponse>('chat', {
    action: 'chat',
    messages,
    format,
  });

  if (!data.ok || !data.text?.trim()) {
    throw new Error('Hosted assistant returned an empty response.');
  }

  return data.text;
}

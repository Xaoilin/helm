import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { HOSTED_ASSISTANT_BILLING_FUNCTION, SUPABASE_ANON_KEY } from '../config';
import { API_TIMEOUT } from '../config/constants';
import { getClient, isSupabaseReady } from '../store/supabase';
import { canUseHostedAssistantProjectAccess } from './hostedAssistantAccess';

export interface HostedAssistantProjectCostBucket {
  startTime: number;
  endTime: number;
  amount: {
    currency: string;
    value: number;
  };
}

export interface HostedAssistantProjectUsageResult {
  model: string;
  serviceTier: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalRequests: number;
}

export interface HostedAssistantProjectUsageBucket {
  startTime: number;
  endTime: number;
  results: HostedAssistantProjectUsageResult[];
}

export interface HostedAssistantProjectBillingSummary {
  projectId: string;
  fetchedAt: string;
  costs: HostedAssistantProjectCostBucket[];
  usage: HostedAssistantProjectUsageBucket[];
}

interface HostedAssistantProjectBillingResponse extends HostedAssistantProjectBillingSummary {
  ok: boolean;
}

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
    const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
          return `${statusLabel}: ${data.error}`;
        }
      }

      const text = await response.text();
      if (text) return `${statusLabel}: ${text}`;
    } catch {
      return `${statusLabel}: ${error.message}`;
    }

    return `${statusLabel}: ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

function getHostedAssistantClient() {
  if (!isSupabaseReady()) {
    throw new Error('Supabase is not configured.');
  }

  const client = getClient();
  if (!client) {
    throw new Error('Supabase client unavailable.');
  }

  return client;
}

function getHostedAssistantAuthHeaders(): Record<string, string> {
  if (!canUseHostedAssistantProjectAccess()) {
    throw new Error('Hosted AI project access is not configured in this build.');
  }

  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

export async function fetchHostedAssistantProjectBilling(): Promise<HostedAssistantProjectBillingSummary> {
  const client = getHostedAssistantClient();
  const headers = getHostedAssistantAuthHeaders();
  const { data, error } = await client.functions.invoke<HostedAssistantProjectBillingResponse>(HOSTED_ASSISTANT_BILLING_FUNCTION, {
    body: { action: 'summary' },
    headers,
    timeout: API_TIMEOUT.HOSTED_ASSISTANT_BILLING,
  });

  if (error) {
    throw new Error(await extractFunctionErrorMessage(error));
  }

  if (!data || !data.ok) {
    throw new Error('OpenAI project billing is unavailable in this build.');
  }

  return {
    projectId: data.projectId,
    fetchedAt: data.fetchedAt,
    costs: data.costs,
    usage: data.usage,
  };
}

import { DEFAULT_ASSISTANT_PROVIDER, OLLAMA_ENDPOINT } from '../config';
import type { AssistantProvider, Settings } from '../types/domain';
import { testHostedAssistantConnection } from './hostedAssistantApi';
import { formatHostedAssistantAccessMode } from './hostedAssistantAccess';
import { testOllamaConnection } from './ollamaApi';

export type AssistantRuntimeProvider = 'hosted' | 'ollama';

export interface AssistantRuntimeStatus {
  activeProvider: AssistantRuntimeProvider | null;
  state: 'ready' | 'offline' | 'sign_in_required' | 'not_configured' | 'checking';
  headline: string;
  detail: string;
}

export function getAssistantProviderSetting(settings: Pick<Settings, 'assistantProvider'>): AssistantProvider {
  return settings.assistantProvider || DEFAULT_ASSISTANT_PROVIDER;
}

function getOllamaEndpoint(settings: Pick<Settings, 'ollamaEndpoint'>): string {
  return settings.ollamaEndpoint || OLLAMA_ENDPOINT;
}

function getHostedSignInRequiredStatus(): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'sign_in_required',
    headline: 'Hosted AI available after sign-in',
    detail: 'Sign in with Google to use the hosted GPT-5.4-mini assistant on the website.',
  };
}

function getHostedNotConfiguredStatus(): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'not_configured',
    headline: 'Hosted AI not configured',
    detail: 'Supabase-backed hosted AI is not configured in this build yet.',
  };
}

function getHostedOfflineStatus(message: string): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'offline',
    headline: 'Hosted AI unavailable',
    detail: message,
  };
}

function getHostedReadyStatus(): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'ready',
    headline: 'Hosted AI ready',
    detail: 'Open-ended help is powered by OpenAI GPT-5.4-mini through HELM\'s hosted assistant.',
  };
}

async function getHostedStatus(): Promise<AssistantRuntimeStatus> {
  const status = await testHostedAssistantConnection();
  switch (status.status) {
    case 'available':
      return status.accessMode === 'local_project_key'
        ? {
            activeProvider: 'hosted',
            state: 'ready',
            headline: 'Hosted AI ready',
            detail: `Open-ended help is powered by OpenAI GPT-5.4-mini through HELM's hosted assistant using ${formatHostedAssistantAccessMode(status.accessMode)} on localhost.`,
          }
        : getHostedReadyStatus();
    case 'sign_in_required':
      return getHostedSignInRequiredStatus();
    case 'not_configured':
      return getHostedNotConfiguredStatus();
    case 'unavailable':
    default:
      return getHostedOfflineStatus(status.message || 'HELM could not reach the hosted assistant right now.');
  }
}

async function getOllamaStatus(settings: Pick<Settings, 'ollamaEndpoint'>): Promise<AssistantRuntimeStatus> {
  const connected = await testOllamaConnection(getOllamaEndpoint(settings));
  return connected
    ? {
        activeProvider: 'ollama',
        state: 'ready',
        headline: 'Local Ollama ready',
        detail: 'Open-ended help is running against your local Ollama endpoint.',
      }
    : {
        activeProvider: 'ollama',
        state: 'offline',
        headline: 'Local Ollama offline',
        detail: 'Start Ollama locally to use open-ended AI replies in local mode.',
      };
}

export async function getAssistantRuntimeStatus(
  settings: Pick<Settings, 'assistantProvider' | 'ollamaEndpoint'>,
): Promise<AssistantRuntimeStatus> {
  const provider = getAssistantProviderSetting(settings);

  if (provider === 'hosted') {
    return getHostedStatus();
  }

  if (provider === 'ollama') {
    return getOllamaStatus(settings);
  }

  const hosted = await getHostedStatus();
  if (hosted.state === 'ready') {
    return {
      ...hosted,
      headline: 'Auto mode using hosted AI',
      detail: hosted.detail,
    };
  }

  const ollama = await getOllamaStatus(settings);
  if (ollama.state === 'ready') {
    return {
      ...ollama,
      headline: 'Auto mode using local Ollama',
      detail: 'Hosted AI is not available right now, so auto mode is using your local Ollama endpoint.',
    };
  }

  if (hosted.state === 'sign_in_required') {
    return {
      activeProvider: null,
      state: 'sign_in_required',
      headline: 'Auto mode needs sign-in or Ollama',
      detail: 'Sign in with Google for hosted GPT-5.4-mini, or start Ollama locally for local AI.',
    };
  }

  if (hosted.state === 'not_configured') {
    return {
      activeProvider: null,
      state: 'not_configured',
      headline: 'Auto mode needs a live AI provider',
      detail: 'Hosted AI is not configured, and Ollama is offline.',
    };
  }

  return {
    activeProvider: null,
    state: 'offline',
    headline: 'No AI provider available',
    detail: 'Hosted AI is unavailable and Ollama is offline, so Lina stays on grounded built-in commands only.',
  };
}

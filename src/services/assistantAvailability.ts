import { DEFAULT_ASSISTANT_PROVIDER, OLLAMA_ENDPOINT } from '../config';
import type { AssistantProvider, Settings } from '../types/domain';
import { testHostedAssistantConnection } from './hostedAssistantApi';
import { formatHostedAssistantAccessMode, isLocalhostRuntime } from './hostedAssistantAccess';
import { getHostedAssistantModelLabel, getHostedAssistantModelSetting } from './assistantModels';
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

function getHostedSignInRequiredStatus(modelLabel: string): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'sign_in_required',
    headline: 'Hosted AI available after sign-in',
    detail: `Sign in with Google to use the hosted ${modelLabel} planner on the website.`,
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

function getHostedReadyStatus(modelLabel: string): AssistantRuntimeStatus {
  return {
    activeProvider: 'hosted',
    state: 'ready',
    headline: 'Hosted AI ready',
    detail: `Intent planning is powered by OpenAI ${modelLabel} through Sabah One's hosted assistant.`,
  };
}

async function getHostedStatus(settings: Pick<Settings, 'hostedModel'>): Promise<AssistantRuntimeStatus> {
  const hostedModel = getHostedAssistantModelSetting(settings);
  const hostedModelLabel = getHostedAssistantModelLabel(hostedModel);
  const status = await testHostedAssistantConnection({ model: hostedModel });
  switch (status.status) {
    case 'available':
      return status.accessMode === 'project_key'
        ? {
            activeProvider: 'hosted',
            state: 'ready',
            headline: 'Hosted AI ready',
            detail: `Intent planning is powered by OpenAI ${getHostedAssistantModelLabel(status.model || hostedModel)} through Sabah One's hosted assistant using the configured ${formatHostedAssistantAccessMode(status.accessMode)}${isLocalhostRuntime() ? ' on localhost.' : '.'}`,
          }
        : getHostedReadyStatus(getHostedAssistantModelLabel(status.model || hostedModel));
    case 'sign_in_required':
      return getHostedSignInRequiredStatus(hostedModelLabel);
    case 'not_configured':
      return getHostedNotConfiguredStatus();
    case 'unavailable':
    default:
      return getHostedOfflineStatus(status.message || 'Sabah One could not reach the hosted assistant right now.');
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
  settings: Pick<Settings, 'assistantProvider' | 'hostedModel' | 'ollamaEndpoint'>,
): Promise<AssistantRuntimeStatus> {
  const provider = getAssistantProviderSetting(settings);
  const hostedModelLabel = getHostedAssistantModelLabel(getHostedAssistantModelSetting(settings));

  if (provider === 'hosted') {
    return getHostedStatus(settings);
  }

  if (provider === 'ollama') {
    return getOllamaStatus(settings);
  }

  const hosted = await getHostedStatus(settings);
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
      detail: `Sign in with Google for hosted ${hostedModelLabel}, or start Ollama locally for local AI planning.`,
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
    detail: 'Hosted AI is unavailable and Ollama is offline, so Lina refuses to guess until a live planner is back.',
  };
}

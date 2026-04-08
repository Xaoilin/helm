import type { AssistantProvider } from './types/domain';

/**
 * App configuration — developer-managed, baked into the build.
 * End users should never need to configure these.
 *
 * Values come from environment variables (VITE_* prefix).
 * Fallback to localStorage settings for backward compatibility.
 */

function getEnv(key: string): string {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || '';
}

function getAssistantProviderEnv(): AssistantProvider {
  const value = getEnv('VITE_DEFAULT_ASSISTANT_PROVIDER');
  return value === 'hosted' || value === 'auto' || value === 'ollama' ? value : 'ollama';
}

function getSettingsValue(key: string): string {
  try {
    const raw = localStorage.getItem('helm:settings');
    if (!raw) return '';
    const settings = JSON.parse(raw);
    return settings?.[key] || '';
  } catch { return ''; }
}

/** Supabase project URL. */
export const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || getSettingsValue('supabaseUrl');

/** Supabase anon key. */
export const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || getSettingsValue('supabaseAnonKey');

/** Google OAuth Client ID for Calendar integration. */
export const GOOGLE_OAUTH_CLIENT_ID = getEnv('VITE_GOOGLE_OAUTH_CLIENT_ID') || getSettingsValue('googleOAuthClientId');

/** ElevenLabs API key for voice assistant. */
export const ELEVENLABS_API_KEY = getEnv('VITE_ELEVENLABS_API_KEY') || getSettingsValue('elevenLabsApiKey');

/** ElevenLabs Voice ID for cloned voice. */
export const ELEVENLABS_VOICE_ID = getEnv('VITE_ELEVENLABS_VOICE_ID') || getSettingsValue('elevenLabsVoiceId');

/** Deepgram API key for speech-to-text (replaces Chrome SpeechRecognition). */
export const DEEPGRAM_API_KEY = getEnv('VITE_DEEPGRAM_API_KEY') || getSettingsValue('deepgramApiKey');

/** Default assistant provider for builds that ship hosted AI. */
export const DEFAULT_ASSISTANT_PROVIDER = getAssistantProviderEnv();

/** Hosted assistant function name (Supabase Edge Function). */
export const HOSTED_ASSISTANT_FUNCTION = getEnv('VITE_HOSTED_ASSISTANT_FUNCTION') || 'assistant-openai';

/** Hosted assistant model label for truthful UI copy. */
export const HOSTED_ASSISTANT_MODEL = getEnv('VITE_HOSTED_ASSISTANT_MODEL') || 'gpt-5.4-mini';

/** Ollama local LLM endpoint. */
export const OLLAMA_ENDPOINT = getEnv('VITE_OLLAMA_ENDPOINT') || getSettingsValue('ollamaEndpoint') || 'http://localhost:11434';

/** Monzo personal access token. */
export const MONZO_ACCESS_TOKEN = getEnv('VITE_MONZO_ACCESS_TOKEN') || getSettingsValue('monzoAccessToken');

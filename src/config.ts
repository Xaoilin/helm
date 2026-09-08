import type { AssistantProvider } from './types/domain';

/**
 * App configuration — developer-managed, baked into the build.
 * End users should never need to configure these.
 *
 * VITE values are public. Use static property reads so Vite includes only the
 * explicitly referenced public settings. Provider values belong in Vault.
 * Supabase account configuration is never device-configured.
 */

function getAssistantProviderEnv(): AssistantProvider {
  const value = import.meta.env.VITE_DEFAULT_ASSISTANT_PROVIDER || '';
  return value === 'hosted' || value === 'auto' || value === 'ollama' ? value : 'ollama';
}

function getSettingsValue(key: 'googleOAuthClientId' | 'elevenLabsVoiceId' | 'ollamaEndpoint'): string {
  try {
    const raw = localStorage.getItem('helm:device:deviceSettings:v2') || localStorage.getItem('helm:device:deviceSettings');
    if (!raw) return '';
    const settings = JSON.parse(raw);
    return settings?.[key] || '';
  } catch { return ''; }
}

/** Supabase project URL. */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '');

/** Supabase publishable key (legacy anon key remains supported during rotation). */
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '') || (import.meta.env.VITE_SUPABASE_ANON_KEY || '');

/** Google OAuth Client ID for Calendar integration. */
export const GOOGLE_OAUTH_CLIENT_ID = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '') || getSettingsValue('googleOAuthClientId');

/** ElevenLabs Voice ID for cloned voice. */
export const ELEVENLABS_VOICE_ID = (import.meta.env.VITE_ELEVENLABS_VOICE_ID || '') || getSettingsValue('elevenLabsVoiceId');

/** Default assistant provider for builds that ship hosted AI. */
export const DEFAULT_ASSISTANT_PROVIDER = getAssistantProviderEnv();

/** Hosted assistant function name (Supabase Edge Function). */
export const HOSTED_ASSISTANT_FUNCTION = (import.meta.env.VITE_HOSTED_ASSISTANT_FUNCTION || '') || 'assistant-openai';

/** Hosted assistant billing function name (Supabase Edge Function). */
export const HOSTED_ASSISTANT_BILLING_FUNCTION = (import.meta.env.VITE_HOSTED_ASSISTANT_BILLING_FUNCTION || '') || 'assistant-openai-billing';

/** Hosted Google Calendar OAuth function name (Supabase Edge Function). */
export const GOOGLE_CALENDAR_OAUTH_FUNCTION = (import.meta.env.VITE_GOOGLE_CALENDAR_OAUTH_FUNCTION || '') || 'google-calendar-oauth';

/** Hosted GitHub App Life Hero evidence function name (Supabase Edge Function). */
export const GITHUB_LIFE_HERO_FUNCTION = (import.meta.env.VITE_GITHUB_LIFE_HERO_FUNCTION || '') || 'github-life-hero';

/** Hosted assistant model label for truthful UI copy. */
export const HOSTED_ASSISTANT_MODEL = (import.meta.env.VITE_HOSTED_ASSISTANT_MODEL || '') || 'gpt-5.4';

/** Ollama local LLM endpoint. */
export const OLLAMA_ENDPOINT = (import.meta.env.VITE_OLLAMA_ENDPOINT || '') || getSettingsValue('ollamaEndpoint') || 'http://localhost:11434';

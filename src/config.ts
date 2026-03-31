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

/** Monzo personal access token. */
export const MONZO_ACCESS_TOKEN = getEnv('VITE_MONZO_ACCESS_TOKEN') || getSettingsValue('monzoAccessToken');

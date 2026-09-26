/**
 * App configuration — developer-managed, baked into the build.
 * End users should never need to configure these.
 *
 * VITE values are public. Use static property reads so Vite includes only the
 * explicitly referenced public settings. Provider values belong in Vault.
 * Supabase account configuration is never device-configured.
 */

function getSettingsValue(key: 'googleOAuthClientId'): string {
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

/** Optional Spring Boot prayer-service base URL. */
export const PRAYER_BACKEND_URL = import.meta.env.VITE_PRAYER_API_BASE_URL || '';

/** Optional Spring Boot profile-service base URL (global settings such as location). */
export const PROFILE_BACKEND_URL = import.meta.env.VITE_PROFILE_API_BASE_URL || '';

/** Optional Spring Boot calendar-service base URL. */
export const CALENDAR_BACKEND_URL = import.meta.env.VITE_CALENDAR_API_BASE_URL || '';

/** Google OAuth Client ID for Calendar integration. */
export const GOOGLE_OAUTH_CLIENT_ID = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '') || getSettingsValue('googleOAuthClientId');

/** Hosted Google Calendar OAuth function name (Supabase Edge Function). */
export const GOOGLE_CALENDAR_OAUTH_FUNCTION = (import.meta.env.VITE_GOOGLE_CALENDAR_OAUTH_FUNCTION || '') || 'google-calendar-oauth';

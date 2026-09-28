/**
 * Compatibility barrel for Sabah One's Supabase gateways.
 *
 * The implementation is split by responsibility under `src/store/supabase/`:
 * `client` (client and signed-in session state), `auth`, `secrets`,
 * `oauthClients` and `oauthAuthorization`. Account data lives in the Spring
 * services; Supabase keeps sign-in, Vault secrets and agent OAuth approvals.
 *
 * New code imports the specific module it needs. UI code (`src/surfaces`,
 * `src/components`) may not import this barrel; ESLint enforces that. Existing
 * store, service and test imports keep working through the names below.
 */
export { initSupabase, isSupabaseReady } from './supabase/client';
export {
  getFreshAccessToken,
  getSessionUser,
  onAuthStateChange,
  SessionUnavailableError,
  signInWithGoogle,
  signOut,
} from './supabase/auth';

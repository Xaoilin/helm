/**
 * Compatibility barrel for Sabah One's Supabase gateways.
 *
 * The implementation is split by responsibility under `src/store/supabase/`:
 * `client` (client and signed-in session state), `auth`, `records`,
 * `mutations`, `secrets`, `productUsage`, `oauthClients`,
 * `oauthAuthorization`, `realtime` and `lifeHero`. Shared application data
 * never falls back to an anonymous or local store.
 *
 * New code imports the specific module it needs. UI code (`src/surfaces`,
 * `src/components`) may not import this barrel; ESLint enforces that. Existing
 * store, service and test imports keep working through the names below.
 */
export {
  getAuthSessionSnapshot,
  getClient,
  getCurrentAccessToken,
  getCurrentUserId,
  initFromEnv,
  initSupabase,
  isAuthenticated,
  isAuthSessionBootstrapped,
  isSupabaseReady,
  setCurrentUserId,
  type AuthSessionSnapshot,
} from './supabase/client';
export {
  getSessionUser,
  onAuthStateChange,
  signInWithGoogle,
  signOut,
  type AuthStateChange,
} from './supabase/auth';
export {
  acceptLifeHeroEvidence,
  fetchLifeHeroSnapshot,
  recomputeLifeHeroProfile,
  syncLifeHeroEvidence,
} from './supabase/lifeHero';
export { getProductUsageEvents, ingestProductUsageEvents } from './supabase/productUsage';
export {
  fetchHelmAccountSnapshot,
  fetchHelmChangedCollections,
  fetchHelmCollectionPage,
  fetchHelmCollections,
  probeHelmAccountVersion,
} from './supabase/records';
export {
  listHelmSecrets,
  revealHelmSecret,
  saveHelmSecret,
  setHelmSecretArchived,
} from './supabase/secrets';
export { applyHelmInventoryMutations, applyHelmMutations } from './supabase/mutations';
export {
  getSupabaseRealtimeSnapshot,
  subscribeHelmBroadcast,
  subscribeSupabaseRealtimeSnapshot,
  type SupabaseRealtimeSnapshot,
  type SupabaseRealtimeState,
} from './supabase/realtime';

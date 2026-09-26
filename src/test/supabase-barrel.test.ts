import { describe, expect, it } from 'vitest';
import * as barrel from '../store/supabase';

/**
 * Existing store, service and test code imports these names from the
 * `store/supabase` compatibility barrel. The per-domain OAuth client helpers
 * were replaced by the generic `store/supabase/oauthClients` gateway.
 */
const PUBLIC_NAMES = [
  'acceptLifeHeroEvidence',
  'applyHelmInventoryMutations',
  'applyHelmMutations',
  'fetchHelmAccountSnapshot',
  'fetchHelmChangedCollections',
  'fetchHelmCollectionPage',
  'fetchHelmCollections',
  'fetchLifeHeroSnapshot',
  'getAuthSessionSnapshot',
  'getClient',
  'getCurrentAccessToken',
  'getCurrentUserId',
  'getProductUsageEvents',
  'getSessionUser',
  'getSupabaseRealtimeSnapshot',
  'ingestProductUsageEvents',
  'initFromEnv',
  'initSupabase',
  'isAuthSessionBootstrapped',
  'isAuthenticated',
  'isSupabaseReady',
  'listHelmSecrets',
  'onAuthStateChange',
  'probeHelmAccountVersion',
  'recomputeLifeHeroProfile',
  'revealHelmSecret',
  'saveHelmSecret',
  'setCurrentUserId',
  'setHelmSecretArchived',
  'signInWithGoogle',
  'signOut',
  'subscribeHelmBroadcast',
  'subscribeSupabaseRealtimeSnapshot',
  'syncLifeHeroEvidence',
];

describe('store/supabase compatibility barrel', () => {
  it('still exports every public function existing callers rely on', () => {
    for (const name of PUBLIC_NAMES) {
      expect(typeof (barrel as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('exports nothing beyond that public surface, so session internals stay private', () => {
    expect(Object.keys(barrel).sort()).toEqual([...PUBLIC_NAMES].sort());
  });
});

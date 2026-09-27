import { describe, expect, it } from 'vitest';
import * as barrel from '../store/supabase';

/**
 * Existing store and service code imports these names from the `store/supabase`
 * compatibility barrel. Secrets and OAuth approvals have their own gateway
 * modules; the generic record store and its Realtime Broadcast are retired.
 */
const PUBLIC_NAMES = [
  'getFreshAccessToken',
  'getSessionUser',
  'initSupabase',
  'isSupabaseReady',
  'onAuthStateChange',
  'SessionUnavailableError',
  'signInWithGoogle',
  'signOut',
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

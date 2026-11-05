/** Compatibility barrel during the native-identity rollout. Implementation uses only Spring APIs. */
export { initAccessService, isAccessReady } from './supabase/client';
export {
  getFreshAccessToken,
  getSessionUser,
  onAuthStateChange,
  SessionUnavailableError,
  signInWithGoogle,
  signOut,
} from './supabase/auth';

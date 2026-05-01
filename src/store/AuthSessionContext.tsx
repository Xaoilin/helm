import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  getSessionUser,
  isSupabaseReady,
  onAuthStateChange,
  signInWithGoogle as startGoogleSignIn,
  signOut as endSupabaseSession,
} from './supabase';
import { logInfo } from '../services/logger';

interface AuthSessionContextValue {
  authUser: User | null;
  bootstrapped: boolean;
  loading: boolean;
  supabaseReady: boolean;
  sessionKey: string;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthSessionCtx = createContext<AuthSessionContextValue | null>(null);
const AUTH_SOURCE = 'AuthSession';

export function useAuthSession(): AuthSessionContextValue {
  const ctx = useContext(AuthSessionCtx);
  if (!ctx) throw new Error('useAuthSession must be used within AuthSessionProvider');
  return ctx;
}

export function useOptionalAuthSession(): AuthSessionContextValue | null {
  return useContext(AuthSessionCtx);
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const supabaseReady = isSupabaseReady();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [bootstrapped, setBootstrapped] = useState(!supabaseReady);
  const [loading, setLoading] = useState(supabaseReady);
  const [generation, setGeneration] = useState(0);
  const authUserRef = useRef<User | null>(null);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    if (!supabaseReady) {
      return;
    }

    let cancelled = false;
    let initialEventPending = true;

    getSessionUser().then(user => {
      if (cancelled) return;
      setAuthUser(user);
      authUserRef.current = user;
      setBootstrapped(true);
      setLoading(false);
      initialEventPending = false;
    });

    const unsubscribe = onAuthStateChange(({ event, user }) => {
      if (cancelled) return;

      const previousUserId = authUserRef.current?.id ?? null;
      const nextUserId = user?.id ?? null;

      authUserRef.current = user;
      setAuthUser(user);
      setBootstrapped(true);
      setLoading(false);

      if (initialEventPending) {
        return;
      }

      if (previousUserId !== nextUserId) {
        logInfo(AUTH_SOURCE, `Remounting app data providers after auth event ${event}.`);
        setGeneration(current => current + 1);
      } else {
        logInfo(AUTH_SOURCE, `Auth event ${event} kept the same signed-in user.`);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [supabaseReady]);

  const signInWithGoogle = useCallback(async () => {
    await startGoogleSignIn();
  }, []);

  const signOut = useCallback(async () => {
    await endSupabaseSession();
    authUserRef.current = null;
    setAuthUser(null);
    setGeneration(current => current + 1);
  }, []);

  return (
    <AuthSessionCtx.Provider
      value={{
        authUser,
        bootstrapped,
        loading,
        supabaseReady,
        sessionKey: `${authUser?.id ?? 'signed-out'}:${generation}`,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthSessionCtx.Provider>
  );
}

/**
 * XP, level, streaks and badges, owned by the planner service: the app only shows them. Completing a task,
 * a prayer reward or the daily reset answers with the new profile, which is shown at once; a change made in
 * another tab or device arrives as a live update.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { GamificationProfile } from '../../types/domain';
import { DEFAULT_PROFILE } from '../../services/gamification';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import {
  getGamification,
  isPlannerServiceEnabled,
  resetGamification,
} from '../../services/backend/plannerServiceApi';
import { useServiceLoad } from './useServiceLoad';

export interface GamificationContextValue {
  gamification: GamificationProfile;
  loaded: boolean;
  /** Why progress may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  /** Shows the profile the planner service answered with. */
  applyProfile: (profile: GamificationProfile) => void;
  /** Starts progress again from nothing (daily momentum is kept). */
  resetProgress: () => Promise<void>;
}

export const GamificationCtx = createContext<GamificationContextValue | null>(null);

export function useGamificationContext(): GamificationContextValue {
  const ctx = useContext(GamificationCtx);
  if (!ctx) throw new Error('useGamificationContext must be used within GamificationProvider');
  return ctx;
}

export function GamificationProvider({ children }: { children: ReactNode }) {
  const [gamification, setGamification] = useState<GamificationProfile>(DEFAULT_PROFILE);

  const load = useCallback(async () => {
    setGamification(await getGamification());
  }, []);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Progress', isPlannerServiceEnabled(), load,
    LIVE_DOMAINS.gamification);

  const applyProfile = useCallback((profile: GamificationProfile) => setGamification(profile), []);

  const resetProgress = useCallback(async () => {
    try {
      setGamification(await resetGamification());
    } catch (resetError) {
      reportFailure(resetError);
      throw resetError;
    }
  }, [reportFailure]);

  const value = useMemo<GamificationContextValue>(() => ({
    gamification, loaded, error, reload, applyProfile, resetProgress,
  }), [gamification, loaded, error, reload, applyProfile, resetProgress]);

  return <GamificationCtx.Provider value={value}>{children}</GamificationCtx.Provider>;
}

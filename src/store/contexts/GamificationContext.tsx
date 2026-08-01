import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { GamificationProfile } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { DEFAULT_PROFILE, backfillPrayerLog as backfillPrayerLogFn } from '../../services/gamification';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface GamificationContextValue {
  gamification: GamificationProfile;
  loaded: boolean;
  updateGamification: (profile: GamificationProfile) => void;
  backfillPrayerLog: (taskId: string, dateStr: string, completed: boolean) => void;
}

const GamificationCtx = createContext<GamificationContextValue | null>(null);

export function useGamificationContext(): GamificationContextValue {
  const ctx = useContext(GamificationCtx);
  if (!ctx) throw new Error('useGamificationContext must be used within GamificationProvider');
  return ctx;
}

export function GamificationProvider({ children }: { children: ReactNode }) {
  const [gamification, setGamification] = useState<GamificationProfile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await loadStore<GamificationProfile>('gamification');
      setGamification(data ?? DEFAULT_PROFILE);
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(['gamification'], async () => {
    const data = await loadStore<GamificationProfile>('gamification');
    setGamification(data ?? DEFAULT_PROFILE);
  });

  useEffect(() => { if (loaded) saveStore('gamification', gamification); }, [gamification, loaded]);

  const updateGamification = useCallback((profile: GamificationProfile) => {
    setGamification(profile);
  }, []);

  const backfillPrayerLog = useCallback((taskId: string, dateStr: string, completed: boolean) => {
    setGamification(prev => backfillPrayerLogFn(prev, taskId, dateStr, completed));
  }, []);

  return (
    <GamificationCtx.Provider value={{ gamification, loaded, updateGamification, backfillPrayerLog }}>
      {children}
    </GamificationCtx.Provider>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  DailyActivityTemplate,
  GamificationProfile,
  DailyMomentumReminderPreference,
  DailyMomentumState,
  DailyPillar,
} from '../../types/domain';
import {
  combineDailyMomentumPillarStates,
  createDefaultDailyMomentumState,
  getDailyMomentumDay,
  getDailyMomentumLocalDate,
  getDailyMomentumPillarState,
  recordDailyMomentumProgress,
  resetDailyMomentumPillar,
  selectDailyMomentumPath,
  setDailyMomentumReminderPreference,
  upsertDailyActivityTemplate,
} from '../../services/dailyMomentum';
import { DEFAULT_PROFILE } from '../../services/gamification';
import { loadStore, saveStoreRecordFieldsCommitted } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface DailyMomentumContextValue {
  state: DailyMomentumState;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  getDay: (date?: string) => ReturnType<typeof getDailyMomentumDay>;
  selectPath: (pillar: DailyPillar, templateId: string, date?: string) => Promise<DailyMomentumState>;
  recordProgress: (
    pillar: DailyPillar,
    templateId: string,
    stepId: string,
    amount: number,
    date?: string,
  ) => Promise<DailyMomentumState>;
  resetProgress: (pillar: DailyPillar, confirmed: boolean, date?: string) => Promise<DailyMomentumState>;
  updateTemplate: (template: DailyActivityTemplate) => Promise<DailyMomentumState>;
  updateReminderPreference: (
    pillar: DailyPillar,
    preference: DailyMomentumReminderPreference,
  ) => Promise<DailyMomentumState>;
}

const DailyMomentumCtx = createContext<DailyMomentumContextValue | null>(null);

export function useDailyMomentumContext(): DailyMomentumContextValue {
  const context = useContext(DailyMomentumCtx);
  if (!context) throw new Error('useDailyMomentumContext must be used within DailyMomentumProvider');
  return context;
}

export function DailyMomentumProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDefaultDailyMomentumState);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const profileRef = useRef<GamificationProfile>(DEFAULT_PROFILE);
  const storageValidRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationsRef = useRef(0);

  const publishStoredProfile = useCallback((value: GamificationProfile | null) => {
    const profile = value ?? DEFAULT_PROFILE;
    const normalized = combineDailyMomentumPillarStates(
      profile.dailyMomentumLearn,
      profile.dailyMomentumMove,
    );
    profileRef.current = profile;
    stateRef.current = normalized;
    storageValidRef.current = true;
    setState(normalized);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await loadStore<GamificationProfile>('gamification');
        if (active) publishStoredProfile(stored);
      } catch (loadError) {
        if (active) {
          storageValidRef.current = false;
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [publishStoredProfile]);

  useRemoteStoreRefresh(['gamification'], async () => {
    await mutationQueueRef.current;
    try {
      publishStoredProfile(await loadStore<GamificationProfile>('gamification'));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  });

  const mutate = useCallback((
    pillars: DailyPillar[],
    transform: (current: DailyMomentumState) => DailyMomentumState,
  ) => {
    const operation = mutationQueueRef.current.then(async () => {
      if (!storageValidRef.current) {
        throw new Error('Daily momentum data is unavailable until valid account data is loaded.');
      }
      pendingMutationsRef.current += 1;
      setSaving(true);
      try {
        const latestProfile = await loadStore<GamificationProfile>('gamification') ?? profileRef.current;
        const current = combineDailyMomentumPillarStates(
          latestProfile.dailyMomentumLearn,
          latestProfile.dailyMomentumMove,
        );
        const next = transform(current);
        const nextLearn = getDailyMomentumPillarState(next, 'learn');
        const nextMove = getDailyMomentumPillarState(next, 'move');
        const fields = Object.fromEntries(pillars.map(pillar => [
          pillar === 'learn' ? 'dailyMomentumLearn' : 'dailyMomentumMove',
          pillar === 'learn' ? nextLearn : nextMove,
        ]));
        await saveStoreRecordFieldsCommitted('gamification', 'profile', fields, {
          ...latestProfile,
          dailyMomentumLearn: nextLearn,
          dailyMomentumMove: nextMove,
        });
        const confirmedProfile = await loadStore<GamificationProfile>('gamification');
        if (!confirmedProfile) throw new Error('The database did not return the confirmed daily momentum profile.');
        publishStoredProfile(confirmedProfile);
        setError(null);
        return stateRef.current;
      } catch (mutationError) {
        const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
        setError(message);
        throw mutationError;
      } finally {
        pendingMutationsRef.current -= 1;
        if (pendingMutationsRef.current === 0) setSaving(false);
      }
    });
    mutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [publishStoredProfile]);

  const getDay = useCallback((date = getDailyMomentumLocalDate()) => (
    getDailyMomentumDay(stateRef.current, date)
  ), []);

  const selectPath = useCallback((pillar: DailyPillar, templateId: string, date = getDailyMomentumLocalDate()) => (
    mutate([pillar], current => selectDailyMomentumPath(current, { date, pillar, templateId }))
  ), [mutate]);

  const recordProgress = useCallback((
    pillar: DailyPillar,
    templateId: string,
    stepId: string,
    amount: number,
    date = getDailyMomentumLocalDate(),
  ) => mutate([pillar], current => recordDailyMomentumProgress(current, {
    date,
    pillar,
    templateId,
    stepId,
    amount,
  })), [mutate]);

  const resetProgress = useCallback((
    pillar: DailyPillar,
    confirmed: boolean,
    date = getDailyMomentumLocalDate(),
  ) => mutate([pillar], current => resetDailyMomentumPillar(current, { date, pillar, confirmed })), [mutate]);

  const updateTemplate = useCallback((template: DailyActivityTemplate) => (
    mutate([template.pillar], current => upsertDailyActivityTemplate(current, template))
  ), [mutate]);

  const updateReminderPreference = useCallback((
    pillar: DailyPillar,
    preference: DailyMomentumReminderPreference,
  ) => mutate([pillar], current => setDailyMomentumReminderPreference(current, pillar, preference)), [mutate]);

  const value = useMemo<DailyMomentumContextValue>(() => ({
    state,
    loaded,
    saving,
    error,
    getDay,
    selectPath,
    recordProgress,
    resetProgress,
    updateTemplate,
    updateReminderPreference,
  }), [
    state,
    loaded,
    saving,
    error,
    getDay,
    selectPath,
    recordProgress,
    resetProgress,
    updateTemplate,
    updateReminderPreference,
  ]);

  return <DailyMomentumCtx.Provider value={value}>{children}</DailyMomentumCtx.Provider>;
}

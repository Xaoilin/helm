import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  DailyActivityTemplate,
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
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import type { PlannerMomentumPillar } from '../../services/backend/plannerContracts';
import { getMomentum, saveMomentumPillar } from '../../services/backend/plannerServiceApi';
import { ServiceError } from '../../services/backend/serviceClient';
import { useServiceLoad } from './useServiceLoad';

/** A save refused because another tab changed the pillar is retried once from the latest state. */
const SAVE_ATTEMPTS = 2;
const MOMENTUM_CHANGED = 'momentum_changed';

function pillarState(pillars: readonly PlannerMomentumPillar[], pillar: DailyPillar): DailyMomentumState | undefined {
  return pillars.find(saved => saved.pillar === pillar)?.state as DailyMomentumState | undefined;
}

function pillarVersion(pillars: readonly PlannerMomentumPillar[], pillar: DailyPillar): number | null {
  return pillars.find(saved => saved.pillar === pillar)?.version ?? null;
}

function combined(pillars: readonly PlannerMomentumPillar[]): DailyMomentumState {
  return combineDailyMomentumPillarStates(pillarState(pillars, 'learn'), pillarState(pillars, 'move'));
}

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

export const DailyMomentumCtx = createContext<DailyMomentumContextValue | null>(null);

export function useDailyMomentumContext(): DailyMomentumContextValue {
  const context = useContext(DailyMomentumCtx);
  if (!context) throw new Error('useDailyMomentumContext must be used within DailyMomentumProvider');
  return context;
}

export function DailyMomentumProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createDefaultDailyMomentumState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const storageValidRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationsRef = useRef(0);

  /** Shows what the planner service holds for both pillars. */
  const publishStored = useCallback((pillars: readonly PlannerMomentumPillar[]) => {
    const normalized = combined(pillars);
    stateRef.current = normalized;
    storageValidRef.current = true;
    setState(normalized);
    setError(null);
  }, []);

  // Reads wait for this tab's writes and share the same flight as live refreshes.
  const load = useCallback(async () => {
    await mutationQueueRef.current;
    publishStored(await getMomentum());
  }, [publishStored]);
  const { loaded, error: loadError } = useServiceLoad('Momentum', true, load, LIVE_DOMAINS.momentum);

  /**
   * Applies a change to the latest stored state and saves each changed pillar whole, naming the version it
   * changed; a pillar another tab changed meanwhile is refused, and the change is applied again once.
   */
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
        for (let attempt = 1; ; attempt += 1) {
          const latest = await getMomentum();
          const next = transform(combined(latest));
          try {
            const saved = [...latest];
            for (const pillar of pillars) {
              const result = await saveMomentumPillar(pillar, getDailyMomentumPillarState(next, pillar),
                pillarVersion(saved, pillar));
              const index = saved.findIndex(existing => existing.pillar === pillar);
              if (index >= 0) saved[index] = result;
              else saved.push(result);
            }
            publishStored(saved);
            return stateRef.current;
          } catch (saveError) {
            const changedMeanwhile = saveError instanceof ServiceError && saveError.code === MOMENTUM_CHANGED;
            if (!changedMeanwhile || attempt >= SAVE_ATTEMPTS) throw saveError;
          }
        }
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
  }, [publishStored]);

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
    error: error ?? loadError,
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
    error, loadError,
    getDay,
    selectPath,
    recordProgress,
    resetProgress,
    updateTemplate,
    updateReminderPreference,
  ]);

  return <DailyMomentumCtx.Provider value={value}>{children}</DailyMomentumCtx.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLOCK } from '../../config/constants';
import {
  DEFAULT_CLOCK_STATE,
  clampTimerDuration,
  createClockStopwatch,
  createClockTimer,
  getStopwatchElapsedMs,
  getTimerRemainingMs,
  normaliseClockState,
  sanitizeClockLabel,
} from '../../services/clock';
import { playTimerAlarm, primeTimerAlarmAudio, stopTimerAlarm } from '../../services/clockAudio';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import {
  deleteStopwatch,
  deleteTimer,
  getClock,
  isPlannerServiceEnabled,
  saveStopwatch,
  saveTimer,
} from '../../services/backend/plannerServiceApi';
import { logWarn } from '../../services/logger';
import type { ClockState, ClockTimerSound, ClockTimerStatus } from '../../types/domain';
import { useLiveRefresh } from './useLiveRefresh';

interface ClockContextValue {
  clock: ClockState;
  loaded: boolean;
  createStopwatch: () => string;
  setStopwatchLabel: (id: string, label: string) => void;
  removeStopwatch: (id: string) => void;
  startStopwatch: (id: string) => void;
  pauseStopwatch: (id: string) => void;
  resetStopwatch: (id: string) => void;
  recordStopwatchLap: (id: string) => void;
  createTimer: () => string;
  setTimerLabel: (id: string, label: string) => void;
  removeTimer: (id: string) => void;
  setTimerDuration: (id: string, durationMs: number) => void;
  setTimerSound: (id: string, sound: ClockTimerSound) => void;
  startTimer: (id: string) => void;
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  acknowledgeTimer: (id: string) => void;
  previewTimerSound: (id: string, sound?: ClockTimerSound) => Promise<void>;
}

export const ClockContext = createContext<ClockContextValue | null>(null);

export function useClockContext(): ClockContextValue {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClockContext must be used within ClockProvider');
  return ctx;
}

export function ClockProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState<ClockState>(DEFAULT_CLOCK_STATE);
  const [loaded, setLoaded] = useState(false);
  const previousTimerStatuses = useRef<Record<string, ClockTimerStatus>>({});

  // What the planner service last confirmed; only what differs from it is saved, one record at a time.
  const confirmedRef = useRef<ClockState>(DEFAULT_CLOCK_STATE);
  // Deletions are sent only for items removed here, never inferred from a missing item.
  const removedRef = useRef({ stopwatches: new Set<string>(), timers: new Set<string>() });
  const writesRef = useRef<Promise<void>>(Promise.resolve());
  const pendingWritesRef = useRef(0);
  const reloadAfterWritesRef = useRef(false);

  const showConfirmed = useCallback((confirmed: ClockState) => {
    const normalised = normaliseClockState(confirmed);
    confirmedRef.current = normalised;
    setClock(normalised);
  }, []);

  const reload = useCallback(async () => {
    if (!isPlannerServiceEnabled()) return;
    // A reload while this tab's own saves are in flight would show them undone; it waits for them.
    if (pendingWritesRef.current > 0) {
      reloadAfterWritesRef.current = true;
      return;
    }
    try {
      showConfirmed(await getClock());
    } catch (error) {
      logWarn('Clock', `Clock load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [showConfirmed]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await reload();
      if (mounted) setLoaded(true);
    })();
    return () => {
      mounted = false;
    };
  }, [reload]);

  // A stopwatch or timer changed in another tab or device (a live-update event) reloads the clock.
  useLiveRefresh(LIVE_DOMAINS.clock, reload);

  const enqueue = useCallback((write: () => Promise<unknown>) => {
    pendingWritesRef.current += 1;
    writesRef.current = writesRef.current.then(write).then(() => undefined, error => {
      logWarn('Clock', `A clock change was not saved: ${error instanceof Error ? error.message : String(error)}`);
      reloadAfterWritesRef.current = true;
    }).finally(() => {
      pendingWritesRef.current -= 1;
      if (pendingWritesRef.current === 0 && reloadAfterWritesRef.current) {
        reloadAfterWritesRef.current = false;
        void reload();
      }
    });
  }, [reload]);

  useEffect(() => {
    if (!loaded || !isPlannerServiceEnabled()) return;
    const confirmed = confirmedRef.current;
    for (const stopwatch of clock.stopwatches) {
      const before = confirmed.stopwatches.find(candidate => candidate.id === stopwatch.id);
      if (JSON.stringify(before) !== JSON.stringify(stopwatch)) enqueue(() => saveStopwatch(stopwatch));
    }
    for (const timer of clock.timers) {
      const before = confirmed.timers.find(candidate => candidate.id === timer.id);
      if (JSON.stringify(before) !== JSON.stringify(timer)) enqueue(() => saveTimer(timer));
    }
    for (const id of removedRef.current.stopwatches) enqueue(() => deleteStopwatch(id));
    for (const id of removedRef.current.timers) enqueue(() => deleteTimer(id));
    removedRef.current = { stopwatches: new Set(), timers: new Set() };
    confirmedRef.current = clock;
  }, [clock, enqueue, loaded]);

  useEffect(() => {
    if (!loaded) return;

    const timeoutIds = clock.timers
      .filter(timer => timer.status === 'running' && timer.endsAt !== null)
      .map(timer =>
        window.setTimeout(() => {
          setClock(current => normaliseClockState(current));
        }, Math.max(0, (timer.endsAt ?? Date.now()) - Date.now())));

    return () => {
      timeoutIds.forEach(window.clearTimeout);
    };
  }, [clock.timers, loaded]);

  useEffect(() => {
    if (!loaded) return;

    const nextStatuses: Record<string, ClockTimerStatus> = {};

    for (const timer of clock.timers) {
      nextStatuses[timer.id] = timer.status;
      if (previousTimerStatuses.current[timer.id] && previousTimerStatuses.current[timer.id] !== 'completed' && timer.status === 'completed') {
        void playTimerAlarm(timer.sound);
      }
    }

    previousTimerStatuses.current = nextStatuses;
  }, [clock.timers, loaded]);

  useEffect(() => stopTimerAlarm, []);

  const createStopwatchItem = useCallback(() => {
    let createdId = '';

    setClock(current => {
      const nextStopwatch = createClockStopwatch(current.nextStopwatchNumber);
      createdId = nextStopwatch.id;

      return {
        ...current,
        stopwatches: [...current.stopwatches, nextStopwatch],
        nextStopwatchNumber: current.nextStopwatchNumber + 1,
      };
    });

    return createdId;
  }, []);

  const setStopwatchLabel = useCallback((id: string, label: string) => {
    setClock(current => ({
      ...current,
      stopwatches: current.stopwatches.map(stopwatch =>
        stopwatch.id === id
          ? {
            ...stopwatch,
            label: sanitizeClockLabel(label, stopwatch.label),
          }
          : stopwatch),
    }));
  }, []);

  const removeStopwatch = useCallback((id: string) => {
    removedRef.current.stopwatches.add(id);
    setClock(current => {
      const nextStopwatches = current.stopwatches.filter(stopwatch => stopwatch.id !== id);
      if (nextStopwatches.length === current.stopwatches.length) return current;

      return {
        ...current,
        stopwatches: nextStopwatches,
      };
    });
  }, []);

  const startStopwatch = useCallback((id: string) => {
    setClock(current => ({
      ...current,
      stopwatches: current.stopwatches.map(stopwatch =>
        stopwatch.id === id && !stopwatch.startedAt
          ? {
            ...stopwatch,
            startedAt: Date.now(),
          }
          : stopwatch),
    }));
  }, []);

  const pauseStopwatch = useCallback((id: string) => {
    setClock(current => ({
      ...current,
      stopwatches: current.stopwatches.map(stopwatch =>
        stopwatch.id === id && stopwatch.startedAt
          ? {
            ...stopwatch,
            accumulatedMs: getStopwatchElapsedMs(stopwatch),
            startedAt: null,
          }
          : stopwatch),
    }));
  }, []);

  const resetStopwatch = useCallback((id: string) => {
    setClock(current => ({
      ...current,
      stopwatches: current.stopwatches.map(stopwatch =>
        stopwatch.id === id
          ? {
            ...stopwatch,
            accumulatedMs: 0,
            startedAt: null,
            laps: [],
          }
          : stopwatch),
    }));
  }, []);

  const recordStopwatchLap = useCallback((id: string) => {
    setClock(current => ({
      ...current,
      stopwatches: current.stopwatches.map(stopwatch => {
        if (stopwatch.id !== id || !stopwatch.startedAt) {
          return stopwatch;
        }

        const lap = getStopwatchElapsedMs(stopwatch);
        return {
          ...stopwatch,
          laps: [lap, ...stopwatch.laps].slice(0, CLOCK.MAX_STOPWATCH_LAPS),
        };
      }),
    }));
  }, []);

  const createTimerItem = useCallback(() => {
    let createdId = '';

    setClock(current => {
      const nextTimer = createClockTimer(current.nextTimerNumber);
      createdId = nextTimer.id;

      return {
        ...current,
        timers: [...current.timers, nextTimer],
        nextTimerNumber: current.nextTimerNumber + 1,
      };
    });

    return createdId;
  }, []);

  const setTimerLabel = useCallback((id: string, label: string) => {
    setClock(current => ({
      ...current,
      timers: current.timers.map(timer =>
        timer.id === id
          ? {
            ...timer,
            label: sanitizeClockLabel(label, timer.label),
          }
          : timer),
    }));
  }, []);

  const removeTimer = useCallback((id: string) => {
    stopTimerAlarm();
    removedRef.current.timers.add(id);

    setClock(current => {
      const nextTimers = current.timers.filter(timer => timer.id !== id);
      if (nextTimers.length === current.timers.length) return current;

      return {
        ...current,
        timers: nextTimers,
      };
    });
  }, []);

  const setTimerDuration = useCallback((id: string, durationMs: number) => {
    stopTimerAlarm();

    setClock(current => {
      const nextDuration = clampTimerDuration(durationMs);

      return {
        ...current,
        timers: current.timers.map(timer =>
          timer.id === id && timer.status !== 'running'
            ? {
              ...timer,
              durationMs: nextDuration,
              remainingMs: nextDuration,
              endsAt: null,
              status: 'idle',
              alerting: false,
              completedAt: undefined,
            }
            : timer),
      };
    });
  }, []);

  const setTimerSound = useCallback((id: string, sound: ClockTimerSound) => {
    setClock(current => ({
      ...current,
      timers: current.timers.map(timer =>
        timer.id === id
          ? {
            ...timer,
            sound,
          }
          : timer),
    }));
  }, []);

  const startTimer = useCallback((id: string) => {
    stopTimerAlarm();
    void primeTimerAlarmAudio();

    setClock(current => {
      const now = Date.now();

      return {
        ...current,
        timers: current.timers.map(timer => {
          if (timer.id !== id || timer.status === 'running') {
            return timer;
          }

          const remainingMs = timer.status === 'completed'
            ? timer.durationMs
            : getTimerRemainingMs(timer, now);

          if (remainingMs <= 0) {
            return timer;
          }

          return {
            ...timer,
            remainingMs,
            endsAt: now + remainingMs,
            status: 'running',
            alerting: false,
            completedAt: undefined,
          };
        }),
      };
    });
  }, []);

  const pauseTimer = useCallback((id: string) => {
    setClock(current => {
      const now = Date.now();

      return {
        ...current,
        timers: current.timers.map(timer => {
          if (timer.id !== id || timer.status !== 'running') {
            return timer;
          }

          const remainingMs = getTimerRemainingMs(timer, now);
          return {
            ...timer,
            remainingMs,
            endsAt: null,
            status: remainingMs === 0 ? 'completed' : 'idle',
            alerting: remainingMs === 0,
            completedAt: remainingMs === 0 ? new Date(now).toISOString() : undefined,
          };
        }),
      };
    });
  }, []);

  const resetTimer = useCallback((id: string) => {
    stopTimerAlarm();

    setClock(current => ({
      ...current,
      timers: current.timers.map(timer =>
        timer.id === id
          ? {
            ...timer,
            remainingMs: timer.durationMs,
            endsAt: null,
            status: 'idle',
            alerting: false,
            completedAt: undefined,
          }
          : timer),
    }));
  }, []);

  const acknowledgeTimer = useCallback((id: string) => {
    stopTimerAlarm();

    setClock(current => ({
      ...current,
      timers: current.timers.map(timer =>
        timer.id === id && timer.status === 'completed'
          ? {
            ...timer,
            alerting: false,
          }
          : timer),
    }));
  }, []);

  const previewTimerSound = useCallback(async (id: string, sound?: ClockTimerSound) => {
    const timer = clock.timers.find(candidate => candidate.id === id);
    if (!timer && !sound) return;

    await primeTimerAlarmAudio();
    await playTimerAlarm(sound ?? timer?.sound ?? CLOCK.DEFAULT_TIMER_SOUND);
  }, [clock.timers]);

  const value = useMemo<ClockContextValue>(() => ({
    clock,
    loaded,
    createStopwatch: createStopwatchItem,
    setStopwatchLabel,
    removeStopwatch,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    recordStopwatchLap,
    createTimer: createTimerItem,
    setTimerLabel,
    removeTimer,
    setTimerDuration,
    setTimerSound,
    startTimer,
    pauseTimer,
    resetTimer,
    acknowledgeTimer,
    previewTimerSound,
  }), [
    clock,
    loaded,
    createStopwatchItem,
    setStopwatchLabel,
    removeStopwatch,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    recordStopwatchLap,
    createTimerItem,
    setTimerLabel,
    removeTimer,
    setTimerDuration,
    setTimerSound,
    startTimer,
    pauseTimer,
    resetTimer,
    acknowledgeTimer,
    previewTimerSound,
  ]);

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

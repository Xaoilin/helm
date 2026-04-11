import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CLOCK } from '../../config/constants';
import {
  DEFAULT_CLOCK_STATE,
  clampTimerDuration,
  getStopwatchElapsedMs,
  getTimerRemainingMs,
  normaliseClockState,
} from '../../services/clock';
import { loadStore, saveStore } from '../persistence';
import type { ClockState } from '../../types/domain';

interface ClockContextValue {
  clock: ClockState;
  loaded: boolean;
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
  recordStopwatchLap: () => void;
  setTimerDuration: (durationMs: number) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
}

const ClockContext = createContext<ClockContextValue | null>(null);

export function useClockContext(): ClockContextValue {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClockContext must be used within ClockProvider');
  return ctx;
}

export function ClockProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState<ClockState>(DEFAULT_CLOCK_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const stored = await loadStore<ClockState>('clock');
      if (!mounted) return;
      setClock(normaliseClockState(stored));
      setLoaded(true);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void saveStore('clock', clock);
  }, [clock, loaded]);

  useEffect(() => {
    if (!loaded || clock.timer.status !== 'running' || !clock.timer.endsAt) return;

    const timeoutId = window.setTimeout(() => {
      setClock(current => {
        if (current.timer.status !== 'running') return current;
        return normaliseClockState(current);
      });
    }, Math.max(0, clock.timer.endsAt - Date.now()));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clock.timer.endsAt, clock.timer.status, loaded]);

  const startStopwatch = useCallback(() => {
    setClock(current => {
      if (current.stopwatch.startedAt) return current;
      return {
        ...current,
        stopwatch: {
          ...current.stopwatch,
          startedAt: Date.now(),
        },
      };
    });
  }, []);

  const pauseStopwatch = useCallback(() => {
    setClock(current => {
      if (!current.stopwatch.startedAt) return current;
      return {
        ...current,
        stopwatch: {
          ...current.stopwatch,
          accumulatedMs: getStopwatchElapsedMs(current.stopwatch),
          startedAt: null,
        },
      };
    });
  }, []);

  const resetStopwatch = useCallback(() => {
    setClock(current => {
      if (
        current.stopwatch.accumulatedMs === 0
        && current.stopwatch.startedAt === null
        && current.stopwatch.laps.length === 0
      ) {
        return current;
      }

      return {
        ...current,
        stopwatch: DEFAULT_CLOCK_STATE.stopwatch,
      };
    });
  }, []);

  const recordStopwatchLap = useCallback(() => {
    setClock(current => {
      if (!current.stopwatch.startedAt) return current;
      const lap = getStopwatchElapsedMs(current.stopwatch);
      return {
        ...current,
        stopwatch: {
          ...current.stopwatch,
          laps: [lap, ...current.stopwatch.laps].slice(0, CLOCK.MAX_STOPWATCH_LAPS),
        },
      };
    });
  }, []);

  const setTimerDuration = useCallback((durationMs: number) => {
    setClock(current => {
      if (current.timer.status === 'running') return current;
      const nextDuration = clampTimerDuration(durationMs);
      return {
        ...current,
        timer: {
          durationMs: nextDuration,
          remainingMs: nextDuration,
          endsAt: null,
          status: 'idle',
          completedAt: undefined,
        },
      };
    });
  }, []);

  const startTimer = useCallback(() => {
    setClock(current => {
      if (current.timer.status === 'running') return current;
      const remainingMs = current.timer.status === 'completed'
        ? current.timer.durationMs
        : getTimerRemainingMs(current.timer);

      if (remainingMs <= 0) return current;

      return {
        ...current,
        timer: {
          ...current.timer,
          remainingMs,
          endsAt: Date.now() + remainingMs,
          status: 'running',
          completedAt: undefined,
        },
      };
    });
  }, []);

  const pauseTimer = useCallback(() => {
    setClock(current => {
      if (current.timer.status !== 'running') return current;
      const remainingMs = getTimerRemainingMs(current.timer);
      return {
        ...current,
        timer: {
          ...current.timer,
          remainingMs,
          endsAt: null,
          status: remainingMs === 0 ? 'completed' : 'idle',
          completedAt: remainingMs === 0 ? new Date().toISOString() : undefined,
        },
      };
    });
  }, []);

  const resetTimer = useCallback(() => {
    setClock(current => ({
      ...current,
      timer: {
        ...current.timer,
        remainingMs: current.timer.durationMs,
        endsAt: null,
        status: 'idle',
        completedAt: undefined,
      },
    }));
  }, []);

  const value = useMemo<ClockContextValue>(() => ({
    clock,
    loaded,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    recordStopwatchLap,
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
  }), [
    clock,
    loaded,
    startStopwatch,
    pauseStopwatch,
    resetStopwatch,
    recordStopwatchLap,
    setTimerDuration,
    startTimer,
    pauseTimer,
    resetTimer,
  ]);

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

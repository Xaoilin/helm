import { CLOCK } from '../config/constants';
import type { ClockState, ClockStopwatchState, ClockTimerSound, ClockTimerState } from '../types/domain';

export const DEFAULT_CLOCK_STATE: ClockState = {
  stopwatch: {
    accumulatedMs: 0,
    startedAt: null,
    laps: [],
  },
  timer: {
    durationMs: CLOCK.DEFAULT_TIMER_DURATION_MS,
    remainingMs: CLOCK.DEFAULT_TIMER_DURATION_MS,
    endsAt: null,
    status: 'idle',
    sound: CLOCK.DEFAULT_TIMER_SOUND,
  },
};

export function clampTimerDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return CLOCK.DEFAULT_TIMER_DURATION_MS;
  }

  const rounded = Math.round(durationMs);
  return Math.min(CLOCK.MAX_TIMER_DURATION_MS, Math.max(CLOCK.MIN_TIMER_DURATION_MS, rounded));
}

export function getStopwatchElapsedMs(stopwatch: ClockStopwatchState, now = Date.now()): number {
  const runningMs = stopwatch.startedAt ? Math.max(0, now - stopwatch.startedAt) : 0;
  return Math.max(0, stopwatch.accumulatedMs + runningMs);
}

export function getTimerRemainingMs(timer: ClockTimerState, now = Date.now()): number {
  if (timer.status === 'running' && timer.endsAt) {
    return Math.max(0, timer.endsAt - now);
  }

  return Math.max(0, timer.remainingMs);
}

function normaliseStopwatchState(stopwatch?: Partial<ClockStopwatchState>): ClockStopwatchState {
  return {
    accumulatedMs: Math.max(0, Math.round(stopwatch?.accumulatedMs ?? DEFAULT_CLOCK_STATE.stopwatch.accumulatedMs)),
    startedAt: typeof stopwatch?.startedAt === 'number' && Number.isFinite(stopwatch.startedAt)
      ? stopwatch.startedAt
      : null,
    laps: Array.isArray(stopwatch?.laps)
      ? stopwatch.laps
        .filter((lap): lap is number => typeof lap === 'number' && Number.isFinite(lap))
        .map(lap => Math.max(0, Math.round(lap)))
        .slice(0, CLOCK.MAX_STOPWATCH_LAPS)
      : [],
  };
}

function normaliseTimerState(timer?: Partial<ClockTimerState>, now = Date.now()): ClockTimerState {
  const durationMs = clampTimerDuration(timer?.durationMs ?? DEFAULT_CLOCK_STATE.timer.durationMs);
  const endsAt = typeof timer?.endsAt === 'number' && Number.isFinite(timer.endsAt)
    ? timer.endsAt
    : null;
  const sound = isClockTimerSound(timer?.sound) ? timer.sound : DEFAULT_CLOCK_STATE.timer.sound;
  const remainingMs = Math.min(
    durationMs,
    Math.max(0, Math.round(timer?.remainingMs ?? durationMs)),
  );
  const requestedStatus = timer?.status ?? DEFAULT_CLOCK_STATE.timer.status;

  if (requestedStatus === 'running' && endsAt) {
    const liveRemaining = Math.max(0, Math.round(endsAt - now));
    if (liveRemaining === 0) {
      return {
        durationMs,
        remainingMs: 0,
        endsAt: null,
        status: 'completed',
        sound,
        completedAt: typeof timer?.completedAt === 'string'
          ? timer.completedAt
          : new Date(now).toISOString(),
      };
    }

    return {
      durationMs,
      remainingMs: liveRemaining,
      endsAt,
      status: 'running',
      sound,
      completedAt: undefined,
    };
  }

  return {
    durationMs,
    remainingMs: requestedStatus === 'completed' ? 0 : remainingMs,
    endsAt: null,
    status: requestedStatus === 'completed' ? 'completed' : 'idle',
    sound,
    completedAt: requestedStatus === 'completed' && typeof timer?.completedAt === 'string'
      ? timer.completedAt
      : undefined,
  };
}

export function isClockTimerSound(value: unknown): value is ClockTimerSound {
  return typeof value === 'string'
    && (CLOCK.TIMER_SOUNDS as readonly string[]).includes(value);
}

export function normaliseClockState(clock?: Partial<ClockState> | null, now = Date.now()): ClockState {
  return {
    stopwatch: normaliseStopwatchState(clock?.stopwatch),
    timer: normaliseTimerState(clock?.timer, now),
  };
}

export function formatClockDuration(
  durationMs: number,
  options: {
    includeCentiseconds?: boolean;
  } = {},
): string {
  const safeDuration = Math.max(0, Math.round(durationMs));
  const totalSeconds = Math.floor(safeDuration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (!options.includeCentiseconds) {
    return base;
  }

  const centiseconds = Math.floor((safeDuration % 1000) / 10);
  return `${base}.${String(centiseconds).padStart(2, '0')}`;
}

export function splitDuration(durationMs: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
  };
}

export function getTimerProgress(timer: ClockTimerState, now = Date.now()): number {
  if (timer.durationMs <= 0) {
    return 0;
  }

  const remaining = getTimerRemainingMs(timer, now);
  return Math.max(0, Math.min(1, 1 - remaining / timer.durationMs));
}

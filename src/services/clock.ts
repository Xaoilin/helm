import { CLOCK } from '../config/constants';
import type { ClockState, ClockStopwatchState, ClockTimerSound, ClockTimerState } from '../types/domain';

type LegacyClockState = {
  stopwatch?: Partial<ClockStopwatchState>;
  timer?: Partial<ClockTimerState>;
};

function createClockEntityId(prefix: 'stopwatch' | 'timer'): string {
  return `clock-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createClockStopwatch(labelNumber: number): ClockStopwatchState {
  return {
    id: createClockEntityId('stopwatch'),
    label: `Stopwatch ${labelNumber}`,
    accumulatedMs: 0,
    startedAt: null,
    laps: [],
  };
}

export function createClockTimer(labelNumber: number): ClockTimerState {
  return {
    id: createClockEntityId('timer'),
    label: `Timer ${labelNumber}`,
    durationMs: CLOCK.DEFAULT_TIMER_DURATION_MS,
    remainingMs: CLOCK.DEFAULT_TIMER_DURATION_MS,
    endsAt: null,
    status: 'idle',
    sound: CLOCK.DEFAULT_TIMER_SOUND,
    alerting: false,
  };
}

export const DEFAULT_CLOCK_STATE: ClockState = {
  stopwatches: [createClockStopwatch(1)],
  timers: [createClockTimer(1)],
  nextStopwatchNumber: 2,
  nextTimerNumber: 2,
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

export function sanitizeClockLabel(label: string | undefined, fallbackLabel: string): string {
  const nextLabel = typeof label === 'string'
    ? label.replace(/\s+/g, ' ').trim().slice(0, CLOCK.MAX_LABEL_LENGTH)
    : '';

  return nextLabel.length > 0 ? nextLabel : fallbackLabel;
}

function normaliseStopwatchState(
  stopwatch: Partial<ClockStopwatchState> | undefined,
  fallbackLabel: string,
): ClockStopwatchState {
  return {
    id: typeof stopwatch?.id === 'string' && stopwatch.id.trim().length > 0
      ? stopwatch.id
      : createClockEntityId('stopwatch'),
    label: sanitizeClockLabel(stopwatch?.label, fallbackLabel),
    accumulatedMs: Math.max(0, Math.round(stopwatch?.accumulatedMs ?? 0)),
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

function normaliseTimerState(
  timer: Partial<ClockTimerState> | undefined,
  fallbackLabel: string,
  now = Date.now(),
): ClockTimerState {
  const durationMs = clampTimerDuration(timer?.durationMs ?? CLOCK.DEFAULT_TIMER_DURATION_MS);
  const endsAt = typeof timer?.endsAt === 'number' && Number.isFinite(timer.endsAt)
    ? timer.endsAt
    : null;
  const sound = isClockTimerSound(timer?.sound) ? timer.sound : CLOCK.DEFAULT_TIMER_SOUND;
  const alerting = timer?.alerting === true;
  const remainingMs = Math.min(
    durationMs,
    Math.max(0, Math.round(timer?.remainingMs ?? durationMs)),
  );
  const requestedStatus = timer?.status ?? 'idle';

  if (requestedStatus === 'running' && endsAt) {
    const liveRemaining = Math.max(0, Math.round(endsAt - now));
    if (liveRemaining === 0) {
      return {
        id: typeof timer?.id === 'string' && timer.id.trim().length > 0
          ? timer.id
          : createClockEntityId('timer'),
        label: sanitizeClockLabel(timer?.label, fallbackLabel),
        durationMs,
        remainingMs: 0,
        endsAt: null,
        status: 'completed',
        sound,
        alerting: true,
        completedAt: typeof timer?.completedAt === 'string'
          ? timer.completedAt
          : new Date(now).toISOString(),
      };
    }

    return {
      id: typeof timer?.id === 'string' && timer.id.trim().length > 0
        ? timer.id
        : createClockEntityId('timer'),
      label: sanitizeClockLabel(timer?.label, fallbackLabel),
      durationMs,
      remainingMs: liveRemaining,
      endsAt,
      status: 'running',
      sound,
      alerting: false,
      completedAt: undefined,
    };
  }

  return {
    id: typeof timer?.id === 'string' && timer.id.trim().length > 0
      ? timer.id
      : createClockEntityId('timer'),
    label: sanitizeClockLabel(timer?.label, fallbackLabel),
    durationMs,
    remainingMs: requestedStatus === 'completed' ? 0 : remainingMs,
    endsAt: null,
    status: requestedStatus === 'completed' ? 'completed' : 'idle',
    sound,
    alerting: requestedStatus === 'completed' ? alerting : false,
    completedAt: requestedStatus === 'completed' && typeof timer?.completedAt === 'string'
      ? timer.completedAt
      : undefined,
  };
}

function normaliseNextNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(fallback, Math.round(value));
  }

  return Math.max(1, fallback);
}

export function isClockTimerSound(value: unknown): value is ClockTimerSound {
  return typeof value === 'string'
    && (CLOCK.TIMER_SOUNDS as readonly string[]).includes(value);
}

export function normaliseClockState(
  clock?: Partial<ClockState> | LegacyClockState | null,
  now = Date.now(),
): ClockState {
  const nextClock = clock ?? {};
  const persistedStopwatches = Array.isArray((nextClock as Partial<ClockState>).stopwatches)
    ? (nextClock as Partial<ClockState>).stopwatches
    : null;
  const persistedTimers = Array.isArray((nextClock as Partial<ClockState>).timers)
    ? (nextClock as Partial<ClockState>).timers
    : null;

  const stopwatches = persistedStopwatches
    ? persistedStopwatches.map((stopwatch, index) =>
      normaliseStopwatchState(stopwatch, `Stopwatch ${index + 1}`))
    : (nextClock as LegacyClockState).stopwatch
      ? [normaliseStopwatchState((nextClock as LegacyClockState).stopwatch, 'Stopwatch 1')]
      : DEFAULT_CLOCK_STATE.stopwatches.map(stopwatch =>
        normaliseStopwatchState(stopwatch, stopwatch.label));

  const timers = persistedTimers
    ? persistedTimers.map((timer, index) =>
      normaliseTimerState(timer, `Timer ${index + 1}`, now))
    : (nextClock as LegacyClockState).timer
      ? [normaliseTimerState((nextClock as LegacyClockState).timer, 'Timer 1', now)]
      : DEFAULT_CLOCK_STATE.timers.map(timer =>
        normaliseTimerState(timer, timer.label, now));

  return {
    stopwatches,
    timers,
    nextStopwatchNumber: normaliseNextNumber(
      (nextClock as Partial<ClockState>).nextStopwatchNumber,
      stopwatches.length + 1,
    ),
    nextTimerNumber: normaliseNextNumber(
      (nextClock as Partial<ClockState>).nextTimerNumber,
      timers.length + 1,
    ),
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

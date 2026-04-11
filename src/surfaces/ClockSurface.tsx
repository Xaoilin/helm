import { Children, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../store/AppContext';
import { CLOCK, TIMING } from '../config/constants';
import { TIMER_SOUND_OPTIONS } from '../services/clockAudio';
import {
  formatClockDuration,
  getStopwatchElapsedMs,
  getTimerProgress,
  getTimerRemainingMs,
  splitDuration,
} from '../services/clock';
import type { ClockStopwatchState, ClockTimerSound, ClockTimerState } from '../types/domain';

export default function ClockSurface() {
  const app = useApp();
  const [now, setNow] = useState(() => Date.now());

  const runningStopwatches = app.clock.stopwatches.filter(stopwatch => stopwatch.startedAt !== null).length;
  const runningTimers = app.clock.timers.filter(timer => timer.status === 'running').length;
  const completedTimers = app.clock.timers.filter(timer => timer.status === 'completed').length;
  const hasLiveClock = runningStopwatches > 0 || runningTimers > 0;

  useEffect(() => {
    if (!hasLiveClock) return;

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, TIMING.CLOCK_TICK);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasLiveClock]);

  const activeClockCount = runningStopwatches + runningTimers;

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Clock</h1>
          <div className="subtitle">Build a neat workspace of independent timers and stopwatches that persist through HELM&apos;s local-first store</div>
        </div>
      </div>

      <div className="surface-body">
        <section className="card clock-toolbar" aria-label="Clock workspace controls">
          <div className="clock-toolbar-copy">
            <div className="clock-toolbar-title">Multi-clock workspace</div>
            <div className="clock-toolbar-subtitle">
              Add separate countdowns and lap trackers whenever you need them. Each card keeps its own progress, sound, and reset state.
            </div>
          </div>

          <div className="clock-toolbar-metrics" aria-label="Clock workspace summary">
            <div className="clock-toolbar-metric">
              <strong>{app.clock.timers.length}</strong>
              <span>Timers</span>
            </div>
            <div className="clock-toolbar-metric">
              <strong>{app.clock.stopwatches.length}</strong>
              <span>Stopwatches</span>
            </div>
            <div className="clock-toolbar-metric">
              <strong>{activeClockCount}</strong>
              <span>Active</span>
            </div>
          </div>

          <div className="clock-toolbar-actions">
            <button className="btn btn-primary" onClick={app.createTimer}>
              + Add Timer
            </button>
            <button className="btn btn-secondary" onClick={app.createStopwatch}>
              + Add Stopwatch
            </button>
          </div>
        </section>

        <div className="clock-sections">
          <ClockSection
            title="Timers"
            subtitle="Run multiple countdowns with their own presets, custom durations, and alarm sounds."
            count={`${app.clock.timers.length} ${app.clock.timers.length === 1 ? 'timer' : 'timers'}`}
            emptyTitle="No timers yet"
            emptyCopy="Add a timer whenever you need a fresh countdown."
            emptyActionLabel="+ Add Timer"
            onEmptyAction={app.createTimer}
          >
            {app.clock.timers.map(timer => (
              <TimerCard
                key={`${timer.id}:${timer.durationMs}`}
                timer={timer}
                now={now}
                onRemove={app.removeTimer}
                onSetDuration={app.setTimerDuration}
                onSetSound={app.setTimerSound}
                onStart={app.startTimer}
                onPause={app.pauseTimer}
                onReset={app.resetTimer}
                onPreview={app.previewTimerSound}
              />
            ))}
          </ClockSection>

          <ClockSection
            title="Stopwatches"
            subtitle="Track multiple elapsed sessions and keep lap history separate for each one."
            count={`${app.clock.stopwatches.length} ${app.clock.stopwatches.length === 1 ? 'stopwatch' : 'stopwatches'}`}
            emptyTitle="No stopwatches yet"
            emptyCopy="Add a stopwatch whenever you want a separate lap tracker."
            emptyActionLabel="+ Add Stopwatch"
            onEmptyAction={app.createStopwatch}
          >
            {app.clock.stopwatches.map(stopwatch => (
              <StopwatchCard
                key={stopwatch.id}
                stopwatch={stopwatch}
                now={now}
                onRemove={app.removeStopwatch}
                onStart={app.startStopwatch}
                onPause={app.pauseStopwatch}
                onReset={app.resetStopwatch}
                onLap={app.recordStopwatchLap}
              />
            ))}
          </ClockSection>
        </div>

        <div className="clock-footnote">
          {completedTimers > 0
            ? `${completedTimers} finished ${completedTimers === 1 ? 'timer is' : 'timers are'} waiting in the workspace until you reset or restart ${completedTimers === 1 ? 'it' : 'them'}.`
            : 'Finished timers stay in place until you reset or restart them, so you can keep a tidy record of what just ended.'}
        </div>
      </div>
    </>
  );
}

function ClockSection({
  title,
  subtitle,
  count,
  children,
  emptyTitle,
  emptyCopy,
  emptyActionLabel,
  onEmptyAction,
}: {
  title: string;
  subtitle: string;
  count: string;
  children: ReactNode;
  emptyTitle: string;
  emptyCopy: string;
  emptyActionLabel: string;
  onEmptyAction: () => void;
}) {
  const items = Children.toArray(children);

  return (
    <section className="clock-section" aria-labelledby={`clock-section-${title.toLowerCase()}`}>
      <div className="clock-section-header">
        <div>
          <h2 id={`clock-section-${title.toLowerCase()}`} className="card-title">{title}</h2>
          <div className="card-subtitle">{subtitle}</div>
        </div>
        <span className="clock-section-count">{count}</span>
      </div>

      {items.length === 0 ? (
        <div className="card clock-collection-empty">
          <h3>{emptyTitle}</h3>
          <p>{emptyCopy}</p>
          <button className="btn btn-secondary" onClick={onEmptyAction}>
            {emptyActionLabel}
          </button>
        </div>
      ) : (
        <div className="clock-card-grid">{items}</div>
      )}
    </section>
  );
}

function TimerCard({
  timer,
  now,
  onRemove,
  onSetDuration,
  onSetSound,
  onStart,
  onPause,
  onReset,
  onPreview,
}: {
  timer: ClockTimerState;
  now: number;
  onRemove: (id: string) => void;
  onSetDuration: (id: string, durationMs: number) => void;
  onSetSound: (id: string, sound: ClockTimerSound) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onReset: (id: string) => void;
  onPreview: (id: string, sound?: ClockTimerSound) => Promise<void>;
}) {
  const [minutesInput, setMinutesInput] = useState(() => String(splitDuration(timer.durationMs).minutes));
  const [secondsInput, setSecondsInput] = useState(() => String(splitDuration(timer.durationMs).seconds).padStart(2, '0'));
  const [durationError, setDurationError] = useState<string | null>(null);

  const timerRunning = timer.status === 'running';
  const timerRemainingMs = useMemo(
    () => getTimerRemainingMs(timer, now),
    [timer, now],
  );
  const timerProgress = useMemo(
    () => getTimerProgress(timer, now),
    [timer, now],
  );
  const selectedTimerSound = useMemo(
    () => TIMER_SOUND_OPTIONS.find(option => option.id === timer.sound) ?? TIMER_SOUND_OPTIONS[0],
    [timer.sound],
  );

  const applyDuration = (durationMs: number) => {
    onSetDuration(timer.id, durationMs);
    const parts = splitDuration(durationMs);
    setMinutesInput(String(parts.minutes));
    setSecondsInput(String(parts.seconds).padStart(2, '0'));
    setDurationError(null);
  };

  const handleApplyCustomDuration = () => {
    const minutes = parseNumber(minutesInput);
    const seconds = parseNumber(secondsInput);
    const durationMs = (minutes * 60 + seconds) * 1000;

    if (durationMs < CLOCK.MIN_TIMER_DURATION_MS) {
      setDurationError('Enter at least 1 second.');
      return;
    }

    applyDuration(durationMs);
  };

  return (
    <section className="card clock-card" aria-labelledby={`timer-heading-${timer.id}`}>
      <div className="card-header">
        <div>
          <h3 id={`timer-heading-${timer.id}`} className="card-title">{timer.label}</h3>
          <div className="card-subtitle">Countdown timer with its own alarm sound.</div>
        </div>

        <div className="clock-card-header-actions">
          <span className={`clock-status ${timer.status}`}>
            {timer.status === 'running' ? 'Running' : timer.status === 'completed' ? 'Finished' : 'Ready'}
          </span>
          <button
            className="btn-icon"
            aria-label={`Remove ${timer.label}`}
            onClick={() => onRemove(timer.id)}
            title={`Remove ${timer.label}`}
          >
            ×
          </button>
        </div>
      </div>

      <div className="clock-face timer">
        <div className="clock-face-label">Remaining</div>
        <div className="clock-display" aria-label={`Remaining for ${timer.label}`}>
          {formatClockDuration(timerRemainingMs)}
        </div>
        <div className="clock-subdisplay">
          Duration {formatClockDuration(timer.durationMs)} · {selectedTimerSound.label}
          {timer.completedAt ? ` · Finished at ${new Date(timer.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
        <div className="clock-progress" aria-hidden="true">
          <div className="clock-progress-fill" style={{ width: `${timerProgress * 100}%` }} />
        </div>
      </div>

      <div className="clock-form-row">
        <div className="clock-input-group">
          <label htmlFor={`clock-timer-minutes-${timer.id}`}>Minutes</label>
          <input
            id={`clock-timer-minutes-${timer.id}`}
            aria-label={`Minutes for ${timer.label}`}
            className="form-input"
            type="number"
            min={0}
            max={1440}
            value={minutesInput}
            onChange={event => setMinutesInput(event.target.value)}
            disabled={timerRunning}
          />
        </div>

        <div className="clock-input-group">
          <label htmlFor={`clock-timer-seconds-${timer.id}`}>Seconds</label>
          <input
            id={`clock-timer-seconds-${timer.id}`}
            aria-label={`Seconds for ${timer.label}`}
            className="form-input"
            type="number"
            min={0}
            max={59}
            value={secondsInput}
            onChange={event => setSecondsInput(event.target.value)}
            disabled={timerRunning}
          />
        </div>

        <div className="clock-input-group clock-input-action">
          <label>&nbsp;</label>
          <button
            className="btn btn-secondary"
            aria-label={`Set duration for ${timer.label}`}
            onClick={handleApplyCustomDuration}
            disabled={timerRunning}
          >
            Set Duration
          </button>
        </div>
      </div>

      <div className="clock-form-row clock-sound-row">
        <div className="clock-input-group">
          <label htmlFor={`clock-timer-sound-${timer.id}`}>Alarm sound</label>
          <select
            id={`clock-timer-sound-${timer.id}`}
            aria-label={`Alarm sound for ${timer.label}`}
            className="form-select"
            value={timer.sound}
            onChange={event => onSetSound(timer.id, event.target.value as ClockTimerSound)}
          >
            {TIMER_SOUND_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="clock-input-group clock-input-action">
          <label>&nbsp;</label>
          <button
            className="btn btn-secondary"
            aria-label={`Preview sound for ${timer.label}`}
            onClick={() => void onPreview(timer.id)}
          >
            Preview Sound
          </button>
        </div>
      </div>

      <div className="clock-sound-note">{selectedTimerSound.description}</div>

      {durationError && <div className="clock-error">{durationError}</div>}

      <div className="clock-presets">
        {CLOCK.PRESET_MINUTES.map(minutes => (
          <button
            key={minutes}
            className="btn btn-secondary btn-sm"
            aria-label={`Set ${timer.label} to ${minutes} minutes`}
            onClick={() => applyDuration(minutes * 60 * 1000)}
            disabled={timerRunning}
          >
            {minutes} min
          </button>
        ))}
      </div>

      <div className="clock-actions">
        <button
          className={`btn ${timerRunning ? 'btn-secondary' : 'btn-primary'}`}
          aria-label={`${timerRunning ? 'Pause' : 'Start'} ${timer.label}`}
          onClick={() => (timerRunning ? onPause(timer.id) : onStart(timer.id))}
        >
          {timerRunning ? 'Pause' : 'Start'}
        </button>
        <button
          className="btn btn-secondary"
          aria-label={`Reset ${timer.label}`}
          onClick={() => onReset(timer.id)}
          disabled={!timerRunning && timer.status === 'idle' && timerRemainingMs === timer.durationMs}
        >
          Reset
        </button>
      </div>

      <div className="clock-note">
        {timerRunning
          ? 'Keeps counting even if you switch to another HELM surface.'
          : 'The selected alarm plays when this timer finishes.'}
      </div>
    </section>
  );
}

function StopwatchCard({
  stopwatch,
  now,
  onRemove,
  onStart,
  onPause,
  onReset,
  onLap,
}: {
  stopwatch: ClockStopwatchState;
  now: number;
  onRemove: (id: string) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onReset: (id: string) => void;
  onLap: (id: string) => void;
}) {
  const stopwatchRunning = stopwatch.startedAt !== null;
  const stopwatchElapsedMs = useMemo(
    () => getStopwatchElapsedMs(stopwatch, now),
    [stopwatch, now],
  );

  return (
    <section className="card clock-card" aria-labelledby={`stopwatch-heading-${stopwatch.id}`}>
      <div className="card-header">
        <div>
          <h3 id={`stopwatch-heading-${stopwatch.id}`} className="card-title">{stopwatch.label}</h3>
          <div className="card-subtitle">Independent lap-tracking stopwatch.</div>
        </div>

        <div className="clock-card-header-actions">
          <span className={`clock-status ${stopwatchRunning ? 'running' : stopwatchElapsedMs > 0 ? 'paused' : 'idle'}`}>
            {stopwatchRunning ? 'Running' : stopwatchElapsedMs > 0 ? 'Paused' : 'Ready'}
          </span>
          <button
            className="btn-icon"
            aria-label={`Remove ${stopwatch.label}`}
            onClick={() => onRemove(stopwatch.id)}
            title={`Remove ${stopwatch.label}`}
          >
            ×
          </button>
        </div>
      </div>

      <div className="clock-face">
        <div className="clock-face-label">Elapsed</div>
        <div className="clock-display" aria-label={`Elapsed for ${stopwatch.label}`}>
          {formatClockDuration(stopwatchElapsedMs, { includeCentiseconds: true })}
        </div>
        <div className="clock-subdisplay">
          {stopwatchRunning
            ? 'Keeps counting if you switch to another HELM surface.'
            : stopwatchElapsedMs > 0
              ? 'Paused and ready to resume.'
              : 'Start fresh whenever you are ready.'}
        </div>
      </div>

      <div className="clock-actions">
        <button
          className={`btn ${stopwatchRunning ? 'btn-secondary' : 'btn-primary'}`}
          aria-label={`${stopwatchRunning ? 'Pause' : 'Start'} ${stopwatch.label}`}
          onClick={() => (stopwatchRunning ? onPause(stopwatch.id) : onStart(stopwatch.id))}
        >
          {stopwatchRunning ? 'Pause' : 'Start'}
        </button>
        <button
          className="btn btn-secondary"
          aria-label={`Add lap to ${stopwatch.label}`}
          onClick={() => onLap(stopwatch.id)}
          disabled={!stopwatchRunning}
        >
          Add Lap
        </button>
        <button
          className="btn btn-secondary"
          aria-label={`Reset ${stopwatch.label}`}
          onClick={() => onReset(stopwatch.id)}
          disabled={stopwatchElapsedMs === 0 && stopwatch.laps.length === 0}
        >
          Reset
        </button>
      </div>

      <div className="clock-laps" aria-live="polite">
        {stopwatch.laps.length === 0 ? (
          <div className="clock-empty-state">No laps yet.</div>
        ) : (
          stopwatch.laps.map((lap, index) => (
            <div key={`${lap}-${index}`} className="clock-lap-row">
              <span>Lap {stopwatch.laps.length - index}</span>
              <strong>{formatClockDuration(lap, { includeCentiseconds: true })}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function parseNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

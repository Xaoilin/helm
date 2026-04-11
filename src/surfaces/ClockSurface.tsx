import { useEffect, useMemo, useState } from 'react';
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
import type { ClockTimerSound } from '../types/domain';

export default function ClockSurface() {
  const app = useApp();
  const [now, setNow] = useState(() => Date.now());
  const [minutesInput, setMinutesInput] = useState(() => String(splitDuration(app.clock.timer.durationMs).minutes));
  const [secondsInput, setSecondsInput] = useState(() => String(splitDuration(app.clock.timer.durationMs).seconds).padStart(2, '0'));
  const [durationError, setDurationError] = useState<string | null>(null);

  const stopwatchRunning = app.clock.stopwatch.startedAt !== null;
  const timerRunning = app.clock.timer.status === 'running';
  const stopwatchElapsedMs = useMemo(
    () => getStopwatchElapsedMs(app.clock.stopwatch, now),
    [app.clock.stopwatch, now],
  );
  const timerRemainingMs = useMemo(
    () => getTimerRemainingMs(app.clock.timer, now),
    [app.clock.timer, now],
  );
  const timerProgress = useMemo(
    () => getTimerProgress(app.clock.timer, now),
    [app.clock.timer, now],
  );
  const selectedTimerSound = useMemo(
    () => TIMER_SOUND_OPTIONS.find(option => option.id === app.clock.timer.sound) ?? TIMER_SOUND_OPTIONS[0],
    [app.clock.timer.sound],
  );

  useEffect(() => {
    if (!stopwatchRunning && !timerRunning) return;

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, TIMING.CLOCK_TICK);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [stopwatchRunning, timerRunning]);

  const applyDuration = (durationMs: number) => {
    app.setTimerDuration(durationMs);
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
    <>
      <div className="surface-header">
        <div>
          <h1>Clock</h1>
          <div className="subtitle">Stopwatch and countdown timer that stay in sync with HELM&apos;s local-first store</div>
        </div>
      </div>

      <div className="surface-body">
        <div className="clock-grid">
          <section className="card clock-card" aria-labelledby="clock-stopwatch-heading">
            <div className="card-header">
              <div>
                <h2 id="clock-stopwatch-heading" className="card-title">Stopwatch</h2>
                <div className="card-subtitle">Track elapsed time and save quick lap marks.</div>
              </div>
              <span className={`clock-status ${stopwatchRunning ? 'running' : stopwatchElapsedMs > 0 ? 'paused' : 'idle'}`}>
                {stopwatchRunning ? 'Running' : stopwatchElapsedMs > 0 ? 'Paused' : 'Ready'}
              </span>
            </div>

            <div className="clock-face">
              <div className="clock-face-label">Elapsed</div>
              <div className="clock-display" aria-label="Stopwatch elapsed">
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
                onClick={stopwatchRunning ? app.pauseStopwatch : app.startStopwatch}
              >
                {stopwatchRunning ? 'Pause Stopwatch' : 'Start Stopwatch'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={app.recordStopwatchLap}
                disabled={!stopwatchRunning}
              >
                Add Lap
              </button>
              <button
                className="btn btn-secondary"
                onClick={app.resetStopwatch}
                disabled={stopwatchElapsedMs === 0 && app.clock.stopwatch.laps.length === 0}
              >
                Reset Stopwatch
              </button>
            </div>

            <div className="clock-laps" aria-live="polite">
              {app.clock.stopwatch.laps.length === 0 ? (
                <div className="clock-empty-state">No laps yet.</div>
              ) : (
                app.clock.stopwatch.laps.map((lap, index) => (
                  <div key={`${lap}-${index}`} className="clock-lap-row">
                    <span>Lap {app.clock.stopwatch.laps.length - index}</span>
                    <strong>{formatClockDuration(lap, { includeCentiseconds: true })}</strong>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card clock-card" aria-labelledby="clock-timer-heading">
            <div className="card-header">
              <div>
                <h2 id="clock-timer-heading" className="card-title">Timer</h2>
                <div className="card-subtitle">Run a countdown for sprints, breaks, or focused work.</div>
              </div>
              <span className={`clock-status ${app.clock.timer.status}`}>
                {app.clock.timer.status === 'running' ? 'Running' : app.clock.timer.status === 'completed' ? 'Finished' : 'Ready'}
              </span>
            </div>

            <div className="clock-face timer">
              <div className="clock-face-label">Remaining</div>
              <div className="clock-display" aria-label="Timer remaining">
                {formatClockDuration(timerRemainingMs)}
              </div>
              <div className="clock-subdisplay">
                Duration {formatClockDuration(app.clock.timer.durationMs)}
                {app.clock.timer.completedAt ? ` · Finished at ${new Date(app.clock.timer.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </div>
              <div className="clock-progress" aria-hidden="true">
                <div className="clock-progress-fill" style={{ width: `${timerProgress * 100}%` }} />
              </div>
            </div>

            <div className="clock-form-row">
              <div className="clock-input-group">
                <label htmlFor="clock-timer-minutes">Minutes</label>
                <input
                  id="clock-timer-minutes"
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
                <label htmlFor="clock-timer-seconds">Seconds</label>
                <input
                  id="clock-timer-seconds"
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
                  onClick={handleApplyCustomDuration}
                  disabled={timerRunning}
                >
                  Set Duration
                </button>
              </div>
            </div>

            <div className="clock-form-row clock-sound-row">
              <div className="clock-input-group">
                <label htmlFor="clock-timer-sound">Alarm sound</label>
                <select
                  id="clock-timer-sound"
                  className="form-select"
                  value={app.clock.timer.sound}
                  onChange={event => app.setTimerSound(event.target.value as ClockTimerSound)}
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
                  onClick={() => void app.previewTimerSound()}
                >
                  Preview Sound
                </button>
              </div>
            </div>

            <div className="clock-sound-note">
              {selectedTimerSound.description}
            </div>

            {durationError && <div className="clock-error">{durationError}</div>}

            <div className="clock-presets">
              {CLOCK.PRESET_MINUTES.map(minutes => (
                <button
                  key={minutes}
                  className="btn btn-secondary btn-sm"
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
                onClick={timerRunning ? app.pauseTimer : app.startTimer}
              >
                {timerRunning ? 'Pause Timer' : 'Start Timer'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={app.resetTimer}
                disabled={!timerRunning && app.clock.timer.status === 'idle' && timerRemainingMs === app.clock.timer.durationMs}
              >
                Reset Timer
              </button>
            </div>

            <div className="clock-note">
              The countdown keeps its place if you leave this surface, and HELM plays the selected alarm when it finishes.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function parseNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

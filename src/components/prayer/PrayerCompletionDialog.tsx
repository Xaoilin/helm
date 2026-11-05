import { useEffect, useRef, useState } from 'react';
import { getPrayerDeadlineBounds } from '../../services/prayerTracking';
import { formatPrayerInstantTime } from '../../services/prayerTimeZone';
import { useMilestoneCelebration } from '../../store/contexts/MilestoneCelebrationContext';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import type { PrayerName, PrayerTiming } from '../../types/domain';
import { PRAYER_TIMING_CHOICES, prayerTimingPoints, prayerTimingStatus } from '../../services/prayerTiming';

export default function PrayerCompletionDialog() {
  const prayer = usePrayerContext();
  const { celebrate } = useMilestoneCelebration();
  const pending = prayer.pendingCompletion;
  const dialogRef = useRef<HTMLElement>(null);
  const promptButtonRef = useRef<HTMLButtonElement>(null);
  const onTimeButtonRef = useRef<HTMLButtonElement>(null);
  const lateButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancelPrayerCompletion = prayer.cancelPrayerCompletion;
  const savingKeysRef = useRef(new Set<string>());
  const [savingPrayers, setSavingPrayers] = useState<Record<string, PrayerName>>({});

  useEffect(() => {
    if (!pending) return;

    const returnFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const getFocusableControls = () => [
      promptButtonRef.current,
      onTimeButtonRef.current,
      lateButtonRef.current,
      cancelButtonRef.current,
    ].filter((control): control is HTMLButtonElement => Boolean(control && !control.disabled));

    const suggestedControl = pending.suggestedStatus === 'late'
      ? lateButtonRef.current
      : onTimeButtonRef.current;
    suggestedControl?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelPrayerCompletion();
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = getFocusableControls();
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstControl = controls[0];
      const lastControl = controls[controls.length - 1];
      const activeElement = document.activeElement;
      const focusIsOutsideDialog = !dialogRef.current?.contains(activeElement);

      if (event.shiftKey && (activeElement === firstControl || focusIsOutsideDialog)) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && (activeElement === lastControl || focusIsOutsideDialog)) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
    };
  }, [cancelPrayerCompletion, pending]);

  const savingNames = Object.values(savingPrayers);
  const progress = savingNames.length > 0 ? (
    <div
      className="milestone-celebration prayer-completion-progress"
      role="status"
      aria-label="Prayer completion progress"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="milestone-celebration-card">
        <span className="spinner" aria-hidden="true" />
        <div className="milestone-celebration-copy">
          <strong>Saving {savingNames.join(' and ')}…</strong>
          <p>Your prayer and XP are being updated.</p>
        </div>
      </div>
    </div>
  ) : null;

  if (!pending) return progress;

  const bounds = prayer.schedule
    ? getPrayerDeadlineBounds(
        prayer.schedule.prayers,
        pending.prayerDate || prayer.today,
        pending.prayerName,
        prayer.schedule.timezone,
      )
    : null;
  const deadlineCopy = bounds
    ? `The on-time window ends at ${bounds.deadlineName} (${formatPrayerInstantTime(
        bounds.deadlineAt,
        prayer.schedule?.timezone ?? '',
      )}).`
    : 'The current schedule is unavailable, so choose the outcome you know is correct.';

  const confirmCompletion = (timing: PrayerTiming) => {
    const status = prayerTimingStatus(timing);
    const key = `${pending.prayerDate || prayer.today}::${pending.prayerName}`;
    if (savingKeysRef.current.has(key)) return;
    const rewarded = prayer.confirmPrayerCompletion(status, timing);
    if (!rewarded) return;
    savingKeysRef.current.add(key);
    setSavingPrayers(current => ({ ...current, [key]: pending.prayerName }));
    // The celebration shows the XP the planner granted once it has rewarded the prayer.
    void rewarded.then(result => {
      savingKeysRef.current.delete(key);
      setSavingPrayers(current => {
        const remaining = { ...current };
        delete remaining[key];
        return remaining;
      });
      // A refusal or reward timeout resolves without a reward; keep the service's notice visible.
      if (!result.gamificationResult && result.xpEarned === 0) return;
      const levelUp = result.gamificationResult?.leveledUp
        ? result.gamificationResult
        : null;
      celebrate({
        tone: levelUp ? 'achievement' : 'prayer',
        eyebrow: levelUp
          ? 'Prayer · Overall level up'
          : status === 'on_time'
            ? 'Prayer kept on time'
            : 'Prayer completed',
        title: levelUp ? `Level ${levelUp.newLevel} reached` : `${result.prayerName} complete`,
        message: `${prayerTimingPoints(timing)} challenge points${result.xpEarned > 0 ? ` · +${result.xpEarned} XP` : ''}${levelUp ? ` · ${levelUp.newTitle}` : ''}`,
      });
    });
  };

  return (
    <>
      {progress}
      <div className="prayer-completion-overlay" onMouseDown={prayer.cancelPrayerCompletion}>
        <section
          ref={dialogRef}
          className="prayer-completion-dialog"
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby="prayer-completion-title"
          aria-describedby="prayer-completion-help"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="prayer-completion-kicker">Prayer outcome</div>
          <h2 id="prayer-completion-title">When did you pray {pending.prayerName}?</h2>
          <p id="prayer-completion-help">{deadlineCopy}</p>
          <div className="prayer-completion-actions">
            {PRAYER_TIMING_CHOICES.map(choice => <button
              key={choice.timing}
              ref={choice.timing === 'prompt' ? promptButtonRef : choice.timing === 'within_window' ? onTimeButtonRef : lateButtonRef}
              type="button"
              className={`prayer-outcome-choice ${choice.timing === 'prompt' ? 'prompt' : choice.status === 'on_time' ? 'on-time' : 'late'}`}
              onClick={() => confirmCompletion(choice.timing)}
            >
              <span aria-hidden="true">{choice.icon}</span>
              <span className="prayer-choice-copy"><strong>{choice.label}</strong><small>{choice.description}</small></span>
              <b className="prayer-choice-points">{prayerTimingPoints(choice.timing)}<small>points</small></b>
            </button>)}
          </div>
          <button
            ref={cancelButtonRef}
            type="button"
            className="btn btn-secondary prayer-completion-cancel"
            onClick={prayer.cancelPrayerCompletion}
          >
            Cancel
          </button>
          <div className="prayer-completion-note">Choose when you prayed, even if you’re logging it later. One tap saves your choice.</div>
        </section>
      </div>
    </>
  );
}

import { useEffect, useRef } from 'react';
import { getPrayerDeadlineBounds } from '../../services/prayerTracking';
import { usePrayerContext } from '../../store/contexts/PrayerContext';

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function PrayerCompletionDialog() {
  const prayer = usePrayerContext();
  const pending = prayer.pendingCompletion;
  const dialogRef = useRef<HTMLElement>(null);
  const onTimeButtonRef = useRef<HTMLButtonElement>(null);
  const lateButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancelPrayerCompletion = prayer.cancelPrayerCompletion;

  useEffect(() => {
    if (!pending) return;

    const returnFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const getFocusableControls = () => [
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

  if (!pending) return null;

  const bounds = prayer.schedule
    ? getPrayerDeadlineBounds(
        prayer.schedule.prayers,
        pending.prayerDate || prayer.today,
        pending.prayerName,
      )
    : null;
  const deadlineCopy = bounds
    ? `The on-time window ends at ${bounds.deadlineName} (${formatClock(bounds.deadlineAt)}).`
    : 'The current schedule is unavailable, so choose the outcome you know is correct.';

  return (
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
        <h2 id="prayer-completion-title">How was {pending.prayerName} prayed?</h2>
        <p id="prayer-completion-help">{deadlineCopy}</p>
        <div className="prayer-completion-actions">
          <button
            ref={onTimeButtonRef}
            type="button"
            className={`prayer-outcome-choice on-time ${pending.suggestedStatus === 'on_time' ? 'suggested' : ''}`}
            onClick={() => prayer.confirmPrayerCompletion('on_time')}
          >
            <span aria-hidden="true">✓</span>
            <strong>On time</strong>
            {pending.suggestedStatus === 'on_time' && <small>Likely from the clock</small>}
          </button>
          <button
            ref={lateButtonRef}
            type="button"
            className={`prayer-outcome-choice late ${pending.suggestedStatus === 'late' ? 'suggested' : ''}`}
            onClick={() => prayer.confirmPrayerCompletion('late')}
          >
            <span aria-hidden="true">◷</span>
            <strong>Late</strong>
            {pending.suggestedStatus === 'late' && <small>Likely from the clock</small>}
          </button>
        </div>
        <button
          ref={cancelButtonRef}
          type="button"
          className="btn btn-secondary prayer-completion-cancel"
          onClick={prayer.cancelPrayerCompletion}
        >
          Cancel
        </button>
        <div className="prayer-completion-note">The highlighted choice is a suggestion only. Nothing is submitted automatically.</div>
      </section>
    </div>
  );
}

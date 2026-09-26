import { usePrayerContext } from '../../store/contexts/PrayerContext';

/** Explains why a prayer completion was refused or not saved, until dismissed. */
export default function PrayerCompletionNotice() {
  const { completionNotice, dismissCompletionNotice } = usePrayerContext();
  if (!completionNotice) return null;

  return (
    <div className="prayer-completion-notice" role="alert">
      <span>{completionNotice}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={dismissCompletionNotice}>
        Dismiss
      </button>
    </div>
  );
}

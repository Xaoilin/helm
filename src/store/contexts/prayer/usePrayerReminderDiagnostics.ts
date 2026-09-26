import { useMemo, useState } from 'react';
import { describeError } from '../../../services/prayerDiagnostics';
import { logError } from '../../../services/logger';

/** Where reminder hooks report what happened, for Settings and Debug diagnostics. */
export interface PrayerReminderReporter {
  /** The key of the reminder most recently scheduled, fired, or deferred. */
  noteNotificationKey: (key: string) => void;
  /** A failure message already reported elsewhere (e.g. by the browser timer). */
  noteError: (message: string) => void;
  /** A thrown failure: shown in diagnostics and logged under `scope`. */
  fail: (scope: string, error: unknown) => void;
}

export interface PrayerReminderDiagnostics {
  lastNotificationKey: string | null;
  lastReminderError: string | null;
  reporter: PrayerReminderReporter;
}

/** Holds the latest reminder key and failure; the reporter is stable for the provider's life. */
export function usePrayerReminderDiagnostics(): PrayerReminderDiagnostics {
  const [lastNotificationKey, setLastNotificationKey] = useState<string | null>(null);
  const [lastReminderError, setLastReminderError] = useState<string | null>(null);

  const reporter = useMemo<PrayerReminderReporter>(() => ({
    noteNotificationKey: setLastNotificationKey,
    noteError: setLastReminderError,
    fail: (scope, error) => {
      setLastReminderError(describeError(error));
      logError(scope, error);
    },
  }), []);

  return { lastNotificationKey, lastReminderError, reporter };
}

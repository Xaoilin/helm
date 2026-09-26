/**
 * Prayer preferences (tracking on, reminders on, reminder lead time) are owned by the prayer
 * service. Once settings load, the service's values replace the app's defaults; later edits in
 * Settings are saved back, and only real edits, never the values just loaded. Failures are logged
 * and retried on the next edit.
 */
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types/domain';
import { PRAYER_REMINDERS } from '../../config/constants';
import {
  getPrayerPreferences,
  isPrayerServiceEnabled,
  savePrayerPreferences,
} from '../../services/backend/prayerServiceApi';
import type { ServicePreferences } from '../../services/backend/contracts';

export function preferencesFromSettings(settings: Settings): ServicePreferences {
  return {
    enabled: settings.prayerEnabled !== false,
    reminderEnabled: settings.prayerReminderEnabled !== false,
    reminderMinutes: settings.prayerReminderMinutes ?? PRAYER_REMINDERS.DEFAULT_MINUTES,
  };
}

type ReminderMinutes = (typeof PRAYER_REMINDERS.OPTIONS_MINUTES)[number];

function isReminderMinutes(value: number): value is ReminderMinutes {
  return (PRAYER_REMINDERS.OPTIONS_MINUTES as readonly number[]).includes(value);
}

/** A lead time the app cannot offer falls back to the default rather than being shown wrongly. */
export function settingsFromPrayerPreferences(
  preferences: ServicePreferences,
): Pick<Settings, 'prayerEnabled' | 'prayerReminderEnabled' | 'prayerReminderMinutes'> {
  return {
    prayerEnabled: preferences.enabled,
    prayerReminderEnabled: preferences.reminderEnabled,
    prayerReminderMinutes: isReminderMinutes(preferences.reminderMinutes)
      ? preferences.reminderMinutes
      : PRAYER_REMINDERS.DEFAULT_MINUTES,
  };
}

function samePreferences(left: ServicePreferences, right: ServicePreferences): boolean {
  return left.enabled === right.enabled
    && left.reminderEnabled === right.reminderEnabled
    && left.reminderMinutes === right.reminderMinutes;
}

/** Returns whether the prayer service has answered (or is not configured), so preferences are final. */
export function usePrayerPreferencesSync(
  loaded: boolean,
  settings: Settings,
  applyPreferences: (preferences: ServicePreferences) => void,
): boolean {
  const enabled = isPrayerServiceEnabled();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);
  const lastSavedRef = useRef<ServicePreferences | null>(null);

  useEffect(() => {
    if (!enabled || !loaded || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const remote = await getPrayerPreferences();
        lastSavedRef.current = remote;
        applyPreferences(remote);
      } catch (error) {
        console.error('Prayer preferences could not be loaded from the prayer service', error);
      } finally {
        setReady(true);
      }
    })();
  }, [applyPreferences, enabled, loaded]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const local = preferencesFromSettings(settings);
    if (lastSavedRef.current && samePreferences(local, lastSavedRef.current)) return;
    lastSavedRef.current = local;
    void savePrayerPreferences(local).catch(error => {
      lastSavedRef.current = null;
      console.error('Prayer preferences could not be saved to the prayer service', error);
    });
  }, [enabled, ready, settings]);

  return ready || !enabled;
}

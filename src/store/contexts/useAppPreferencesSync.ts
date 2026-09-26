/**
 * App preferences (theme, data retention, telemetry, default calendar view, goal tags) are owned by
 * the profile service. Once settings load, the service's values replace the app's defaults; later
 * edits in Settings are saved back as the whole value, and only real edits, never the values just
 * loaded. Nothing is saved until the service's values have loaded, so an outage can never overwrite
 * them with the app's defaults. Save failures are logged and retried on the next edit.
 */
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types/domain';
import {
  getAppPreferences,
  isProfileServiceEnabled,
  saveAppPreferences,
  type AppPreferencesInput,
} from '../../services/backend/profileServiceApi';
import type { ServiceAppPreferences } from '../../services/backend/contracts';

type CalendarTab = NonNullable<Settings['defaultCalendarTab']>;
const CALENDAR_TABS: readonly CalendarTab[] = ['month', 'week', 'agenda', 'accounts'];

export type AppPreferenceSettings = Pick<Settings, 'theme' | 'dataRetentionDays' | 'telemetry' | 'defaultCalendarTab' | 'goalTags'>;

export function appPreferencesFromSettings(settings: AppPreferenceSettings): AppPreferencesInput {
  return {
    theme: settings.theme,
    dataRetentionDays: settings.dataRetentionDays,
    telemetry: settings.telemetry,
    defaultCalendarTab: settings.defaultCalendarTab ?? null,
    goalTags: settings.goalTags ?? [],
  };
}

/** A value the app cannot show (an unknown theme or view) falls back to the app's default. */
export function settingsFromAppPreferences(preferences: ServiceAppPreferences): AppPreferenceSettings {
  const tab = CALENDAR_TABS.find(candidate => candidate === preferences.defaultCalendarTab);
  return {
    theme: preferences.theme === 'light' ? 'light' : 'dark',
    dataRetentionDays: preferences.dataRetentionDays,
    telemetry: preferences.telemetry,
    defaultCalendarTab: tab,
    goalTags: [...preferences.goalTags],
  };
}

function samePreferences(left: AppPreferencesInput, right: AppPreferencesInput): boolean {
  return left.theme === right.theme
    && left.dataRetentionDays === right.dataRetentionDays
    && left.telemetry === right.telemetry
    && left.defaultCalendarTab === right.defaultCalendarTab
    && left.goalTags.length === right.goalTags.length
    && left.goalTags.every((tag, index) => tag === right.goalTags[index]);
}

/** Returns whether the profile service has answered (or is not configured), so preferences are final. */
export function useAppPreferencesSync(
  loaded: boolean,
  settings: Settings,
  applyPreferences: (preferences: ServiceAppPreferences) => void,
): boolean {
  const enabled = isProfileServiceEnabled();
  const [ready, setReady] = useState(false);
  const [synced, setSynced] = useState(false);
  const startedRef = useRef(false);
  const lastSavedRef = useRef<AppPreferencesInput | null>(null);

  useEffect(() => {
    if (!enabled || !loaded || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const remote = await getAppPreferences();
        lastSavedRef.current = appPreferencesFromSettings(settingsFromAppPreferences(remote));
        applyPreferences(remote);
        setSynced(true);
      } catch (error) {
        console.error('App preferences could not be loaded from the profile service', error);
      } finally {
        setReady(true);
      }
    })();
  }, [applyPreferences, enabled, loaded]);

  useEffect(() => {
    if (!enabled || !synced) return;
    const local = appPreferencesFromSettings(settings);
    if (lastSavedRef.current && samePreferences(local, lastSavedRef.current)) return;
    lastSavedRef.current = local;
    void saveAppPreferences(local).catch(error => {
      lastSavedRef.current = null;
      console.error('App preferences could not be saved to the profile service', error);
    });
  }, [enabled, synced, settings]);

  return ready || !enabled;
}

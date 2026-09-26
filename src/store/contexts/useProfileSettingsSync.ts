/**
 * Location and display time zone are global settings owned by the profile service. Once loaded,
 * the service's values replace the app's; the first time, the app's current values seed it.
 * Later edits in Settings are written back. Failures are logged and retried on the next edit.
 */
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types/domain';
import {
  getGlobalSettings,
  isProfileServiceEnabled,
  saveGlobalSettings,
} from '../../services/backend/profileServiceApi';
import type { ServiceGlobalSettings } from '../../services/backend/contracts';

type Location = Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>;

const DEFAULT_CITY = 'Bedford';
const DEFAULT_COUNTRY = 'United Kingdom';

export function locationFromSettings(settings: Settings): Location {
  return {
    city: settings.prayerCity?.trim() || DEFAULT_CITY,
    country: settings.prayerCountry?.trim() || DEFAULT_COUNTRY,
    timeZone: settings.appTimezone ?? null,
  };
}

export function settingsFromLocation(location: Location): Pick<Settings, 'prayerCity' | 'prayerCountry' | 'appTimezone'> {
  return {
    prayerCity: location.city,
    prayerCountry: location.country,
    appTimezone: location.timeZone ?? undefined,
  };
}

function sameLocation(left: Location, right: Location): boolean {
  return left.city === right.city && left.country === right.country && left.timeZone === right.timeZone;
}

export function useProfileSettingsSync(
  loaded: boolean,
  settings: Settings,
  applyLocation: (location: Location) => void,
): void {
  const enabled = isProfileServiceEnabled();
  const [ready, setReady] = useState(false);
  const startedRef = useRef(false);
  const lastSavedRef = useRef<Location | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (!enabled || !loaded || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const remote = await getGlobalSettings();
        if (remote.updatedAt) {
          lastSavedRef.current = remote;
          applyLocation(remote);
        } else {
          const local = locationFromSettings(settingsRef.current);
          lastSavedRef.current = await saveGlobalSettings(local);
        }
      } catch (error) {
        console.error('Global settings could not be loaded from the profile service', error);
      } finally {
        setReady(true);
      }
    })();
  }, [applyLocation, enabled, loaded]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const local = locationFromSettings(settings);
    if (lastSavedRef.current && sameLocation(local, lastSavedRef.current)) return;
    lastSavedRef.current = local;
    void saveGlobalSettings(local).catch(error => {
      lastSavedRef.current = null;
      console.error('Global settings could not be saved to the profile service', error);
    });
  }, [enabled, ready, settings]);
}

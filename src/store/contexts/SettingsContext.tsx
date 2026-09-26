import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Settings, Integration } from '../../types/domain';
import {
  getBrowserTimeZone,
  resolveAppTimeZone,
  type AppTimeZoneResolution,
} from '../../services/appTimeZone';
import { validateIanaTimeZone } from '../../services/timeZone';
import {
  DEVICE_SETTINGS_STORE_KEY,
  loadDeviceStore,
  saveDeviceStore,
} from '../persistence';
import { splitSettings, type DeviceSettings } from '../recordCodec';
import { locationFromSettings, settingsFromLocation, useProfileSettingsSync } from './useProfileSettingsSync';
import { settingsFromPrayerPreferences, usePrayerPreferencesSync } from './usePrayerPreferencesSync';
import { settingsFromAppPreferences, useAppPreferencesSync } from './useAppPreferencesSync';
import type { ServiceAppPreferences, ServiceIntegration, ServicePreferences } from '../../services/backend/contracts';
import { getIntegrations, isProfileServiceEnabled, saveIntegration } from '../../services/backend/profileServiceApi';

// ── Defaults ──
const defaultSettings: Settings = {
  theme: 'dark',
  dataRetentionDays: 90,
  telemetry: false,
  prayerEnabled: true,
  prayerCity: 'Bedford',
  prayerCountry: 'United Kingdom',
  prayerReminderEnabled: true,
  prayerReminderMinutes: 15,
};

const defaultIntegrations: Integration[] = [
  { id: 'int-google', name: 'Google Calendar', provider: 'google', description: 'Sync Google Calendar events', status: 'disconnected', icon: 'calendar' },
];

export { defaultSettings, defaultIntegrations };

/** Providers whose connection record the profile service keeps (`app.profile.integrations.providers`). */
const SERVICE_INTEGRATION_PROVIDERS = new Set(['google']);

/** The offered integrations, with each one's saved connection record from the profile service. */
function hydrateIntegrations(records: ServiceIntegration[]): Integration[] {
  return defaultIntegrations.map(integration => {
    const record = records.find(candidate => candidate.provider === integration.provider);
    return record
      ? {
          ...integration,
          status: record.status,
          configuredAt: record.configuredAt ?? undefined,
          lastError: record.lastError ?? undefined,
        }
      : { ...integration };
  });
}

export interface SettingsContextValue {
  settings: Settings;
  integrations: Integration[];
  loaded: boolean;
  appTimeZone: AppTimeZoneResolution;
  appTimeZoneLoadWarning: string | null;
  /** Location and prayer preferences have come from their services (or those are not configured). */
  serviceSettingsReady: boolean;
  updateSettings: (updates: Partial<Settings>) => void;
  saveAppTimeZonePreference: (timeZone?: string) => Promise<void>;
  updateIntegration: (id: string, updates: Partial<Integration>) => void;
}

export const SettingsCtx = createContext<SettingsContextValue | null>(null);

export function useSettingsContext(): SettingsContextValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error('useSettingsContext must be used within SettingsProvider');
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [integrations, setIntegrations] = useState<Integration[]>(defaultIntegrations);
  const [loaded, setLoaded] = useState(false);
  const [appTimeZoneLoadWarning, setAppTimeZoneLoadWarning] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const browserTimeZone = useMemo(() => getBrowserTimeZone(), []);
  const appTimeZone = useMemo(
    () => resolveAppTimeZone(settings.appTimezone, browserTimeZone),
    [browserTimeZone, settings.appTimezone],
  );

  // Settings shared across devices are owned by the services (profile and prayer); only
  // device-only settings are stored here, in the browser.
  useEffect(() => {
    (async () => {
      const device = await loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY);
      setSettings(prev => {
        const next = { ...prev, ...splitSettings(device).device };
        settingsRef.current = next;
        return next;
      });
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) void saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, splitSettings(settings).device);
  }, [settings, loaded]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (!loaded || !isProfileServiceEnabled()) return;
    getIntegrations()
      .then(records => setIntegrations(hydrateIntegrations(records)))
      .catch(error => console.error('Integrations could not be loaded from the profile service', error));
  }, [loaded]);

  const applyServiceLocation = useCallback((location: Parameters<typeof settingsFromLocation>[0]) => {
    setSettings(prev => {
      const next = { ...prev, ...settingsFromLocation(location) };
      if (!location.timeZone) delete next.appTimezone;
      settingsRef.current = next;
      return next;
    });
  }, []);
  const { ready: locationReady, saveLocation } = useProfileSettingsSync(loaded, settings, applyServiceLocation);

  const applyServicePrayerPreferences = useCallback((preferences: ServicePreferences) => {
    setSettings(prev => {
      const next = { ...prev, ...settingsFromPrayerPreferences(preferences) };
      settingsRef.current = next;
      return next;
    });
  }, []);
  const prayerPreferencesReady = usePrayerPreferencesSync(loaded, settings, applyServicePrayerPreferences);

  const applyServiceAppPreferences = useCallback((preferences: ServiceAppPreferences) => {
    setSettings(prev => {
      const next = { ...prev, ...settingsFromAppPreferences(preferences) };
      if (!next.defaultCalendarTab) delete next.defaultCalendarTab;
      settingsRef.current = next;
      return next;
    });
  }, []);
  const appPreferencesReady = useAppPreferencesSync(loaded, settings, applyServiceAppPreferences);
  const serviceSettingsReady = loaded && locationReady && prayerPreferencesReady && appPreferencesReady;

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => {
      const safe = splitSettings(updates);
      const next = { ...prev, ...safe.shared, ...safe.device, ...safe.service };
      if ('appTimezone' in updates) {
        const timeZone = validateIanaTimeZone(updates.appTimezone);
        if (timeZone) next.appTimezone = timeZone;
        else delete next.appTimezone;
      }
      settingsRef.current = next;
      return next;
    });
  }, []);

  const saveAppTimeZonePreference = useCallback(async (timeZone?: string) => {
    const rawTimeZone = timeZone?.trim() ?? '';
    const validTimeZone = validateIanaTimeZone(rawTimeZone);
    if (rawTimeZone && !validTimeZone) {
      throw new Error('Enter a valid IANA time zone, such as Europe/London.');
    }

    const next = { ...settingsRef.current };
    if (validTimeZone) next.appTimezone = validTimeZone;
    else delete next.appTimezone;
    // The profile service owns the display time zone: confirm it there before showing it.
    await saveLocation(locationFromSettings(next));
    settingsRef.current = next;
    setSettings(next);
    setAppTimeZoneLoadWarning(null);
  }, [saveLocation]);

  const integrationsRef = useRef(integrations);
  useEffect(() => { integrationsRef.current = integrations; }, [integrations]);

  const updateIntegration = useCallback((id: string, updates: Partial<Integration>) => {
    const current = integrationsRef.current.find(integration => integration.id === id);
    if (!current) return;
    const next = { ...current, ...updates };
    setIntegrations(prev => prev.map(integration => integration.id === id ? next : integration));
    if (!isProfileServiceEnabled() || !SERVICE_INTEGRATION_PROVIDERS.has(next.provider)) return;
    void saveIntegration(next.provider, {
      status: next.status === 'mocked' ? 'disconnected' : next.status,
      configuredAt: next.configuredAt ?? null,
      lastError: next.lastError ?? null,
    }).catch(error => console.error('Integration could not be saved to the profile service', error));
  }, []);

  return (
    <SettingsCtx.Provider value={{
      settings,
      integrations,
      loaded,
      appTimeZone,
      appTimeZoneLoadWarning,
      serviceSettingsReady,
      updateSettings,
      saveAppTimeZonePreference,
      updateIntegration,
    }}>
      {children}
    </SettingsCtx.Provider>
  );
}

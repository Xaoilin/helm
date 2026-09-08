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
import { DEFAULT_ASSISTANT_PROVIDER } from '../../config';
import {
  getBrowserTimeZone,
  resolveAppTimeZone,
  type AppTimeZoneResolution,
} from '../../services/appTimeZone';
import { validateIanaTimeZone } from '../../services/timeZone';
import {
  DEVICE_SETTINGS_STORE_KEY,
  loadDeviceStore,
  loadStore,
  saveDeviceStore,
  saveStore,
  saveStoreCommitted,
} from '../persistence';
import { splitSettings, type DeviceSettings } from '../recordCodec';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

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
  lifeHeroEnabled: false,
  assistantProvider: DEFAULT_ASSISTANT_PROVIDER,
};

const defaultIntegrations: Integration[] = [
  { id: 'int-google', name: 'Google Calendar', provider: 'google', description: 'Sync Google Calendar events', status: 'disconnected', icon: 'calendar' },
  { id: 'int-github', name: 'GitHub', provider: 'github', description: 'Read-only GitHub App for merged pull request evidence', status: 'disconnected', icon: 'code' },
];

export { defaultSettings, defaultIntegrations };

function hydrateIntegrations(stored: Integration[] | null): Integration[] {
  const records = stored ?? [];
  // Autosave owns the full collection: keep every stored ID and historical row.
  return [...records, ...defaultIntegrations
    .filter(provider => !records.some(record => record.provider === provider.provider))
    .map(provider => ({ ...provider }))];
}

export interface SettingsContextValue {
  settings: Settings;
  integrations: Integration[];
  loaded: boolean;
  appTimeZone: AppTimeZoneResolution;
  appTimeZoneLoadWarning: string | null;
  updateSettings: (updates: Partial<Settings>) => void;
  saveAppTimeZonePreference: (timeZone?: string) => Promise<void>;
  updateIntegration: (id: string, updates: Partial<Integration>) => void;
}

const SettingsCtx = createContext<SettingsContextValue | null>(null);

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

  const hydrateSettings = useCallback((
    shared: Settings | null,
    device: DeviceSettings | null,
  ): Settings => {
    const rawTimeZone = shared && typeof shared.appTimezone === 'string'
      ? shared.appTimezone.trim()
      : '';
    const validTimeZone = validateIanaTimeZone(rawTimeZone);
    setAppTimeZoneLoadWarning(rawTimeZone && !validTimeZone
      ? `The saved time zone “${rawTimeZone}” is invalid. Automatic is active.`
      : null);
    return {
      ...defaultSettings,
      ...splitSettings(shared).shared,
      ...(device ?? {}),
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [s, i, device] = await Promise.all([
        loadStore<Settings>('settings'),
        loadStore<Integration[]>('integrations'),
        loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY),
      ]);
      const nextSettings = hydrateSettings(s, device);
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setIntegrations(hydrateIntegrations(i));
      setLoaded(true);
    })();
  }, [hydrateSettings]);

  useRemoteStoreRefresh(['settings', 'integrations'], async () => {
    const [sharedSettings, remoteIntegrations, deviceSettings] = await Promise.all([
      loadStore<Settings>('settings'),
      loadStore<Integration[]>('integrations'),
      loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY),
    ]);
    const nextSettings = hydrateSettings(sharedSettings, deviceSettings);
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setIntegrations(hydrateIntegrations(remoteIntegrations));
  });

  useEffect(() => { if (loaded) saveStore('settings', settings); }, [settings, loaded]);
  useEffect(() => {
    if (loaded) void saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, splitSettings(settings).device);
  }, [settings, loaded]);
  useEffect(() => { if (loaded) saveStore('integrations', integrations); }, [integrations, loaded]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => {
      const safe = splitSettings(updates);
      const next = { ...prev, ...safe.shared, ...safe.device };
      if ('elevenLabsSecretId' in updates && !updates.elevenLabsSecretId) delete next.elevenLabsSecretId;
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
    await saveStoreCommitted('settings', next);
    settingsRef.current = next;
    setSettings(next);
    setAppTimeZoneLoadWarning(null);
  }, []);

  const updateIntegration = useCallback((id: string, updates: Partial<Integration>) => {
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }, []);

  return (
    <SettingsCtx.Provider value={{
      settings,
      integrations,
      loaded,
      appTimeZone,
      appTimeZoneLoadWarning,
      updateSettings,
      saveAppTimeZonePreference,
      updateIntegration,
    }}>
      {children}
    </SettingsCtx.Provider>
  );
}

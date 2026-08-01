import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Settings, Integration } from '../../types/domain';
import { DEFAULT_ASSISTANT_PROVIDER } from '../../config';
import {
  DEVICE_SETTINGS_STORE_KEY,
  loadDeviceStore,
  loadStore,
  saveDeviceStore,
  saveStore,
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
  assistantProvider: DEFAULT_ASSISTANT_PROVIDER,
};

const defaultIntegrations: Integration[] = [
  { id: 'int-google', name: 'Google Calendar', provider: 'google', description: 'Sync Google Calendar events', status: 'disconnected', icon: 'calendar' },
  { id: 'int-github', name: 'GitHub', provider: 'github', description: 'Repository and PR notifications', status: 'disconnected', icon: 'code' },
  { id: 'int-slack', name: 'Slack', provider: 'slack', description: 'Team messaging notifications', status: 'disconnected', icon: 'message' },
  { id: 'int-linear', name: 'Linear', provider: 'linear', description: 'Issue tracking and project management', status: 'disconnected', icon: 'list' },
];

export { defaultSettings, defaultIntegrations };

export interface SettingsContextValue {
  settings: Settings;
  integrations: Integration[];
  loaded: boolean;
  updateSettings: (updates: Partial<Settings>) => void;
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

  useEffect(() => {
    (async () => {
      const [s, i, device] = await Promise.all([
        loadStore<Settings>('settings'),
        loadStore<Integration[]>('integrations'),
        loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY),
      ]);
      setSettings({ ...defaultSettings, ...(s ?? {}), ...(device ?? {}) });
      setIntegrations(i ?? defaultIntegrations);
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(['settings', 'integrations'], async () => {
    const [sharedSettings, remoteIntegrations, deviceSettings] = await Promise.all([
      loadStore<Settings>('settings'),
      loadStore<Integration[]>('integrations'),
      loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY),
    ]);
    setSettings({ ...defaultSettings, ...(sharedSettings ?? {}), ...(deviceSettings ?? {}) });
    setIntegrations(remoteIntegrations ?? defaultIntegrations);
  });

  useEffect(() => { if (loaded) saveStore('settings', settings); }, [settings, loaded]);
  useEffect(() => {
    if (loaded) void saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, splitSettings(settings).device);
  }, [settings, loaded]);
  useEffect(() => { if (loaded) saveStore('integrations', integrations); }, [integrations, loaded]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const updateIntegration = useCallback((id: string, updates: Partial<Integration>) => {
    setIntegrations(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }, []);

  return (
    <SettingsCtx.Provider value={{ settings, integrations, loaded, updateSettings, updateIntegration }}>
      {children}
    </SettingsCtx.Provider>
  );
}

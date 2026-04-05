import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Settings, Integration } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';

// ── Defaults ──
const defaultSettings: Settings = {
  credentialSource: 'onepassword-first',
  theme: 'dark',
  dataRetentionDays: 90,
  telemetry: false,
};

const defaultIntegrations: Integration[] = [
  { id: 'int-google', name: 'Google Calendar', provider: 'google', description: 'Sync Google Calendar events', status: 'disconnected', icon: 'calendar' },
  { id: 'int-github', name: 'GitHub', provider: 'github', description: 'Repository and PR notifications', status: 'disconnected', icon: 'code' },
  { id: 'int-1password', name: '1Password', provider: '1password', description: 'Credential management via 1Password CLI', status: 'disconnected', icon: 'key' },
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
      const [s, i] = await Promise.all([
        loadStore<Settings>('settings'),
        loadStore<Integration[]>('integrations'),
      ]);
      setSettings(s ?? defaultSettings);
      setIntegrations(i ?? defaultIntegrations);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStore('settings', settings); }, [settings, loaded]);
  useEffect(() => { if (loaded) saveStore('integrations', integrations); }, [integrations, loaded]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      // Re-init Supabase if connection settings changed
      if (updates.supabaseUrl !== undefined || updates.supabaseAnonKey !== undefined) {
        import('../supabase').then(({ initSupabase }) => {
          initSupabase(newSettings.supabaseUrl || '', newSettings.supabaseAnonKey || '');
        });
      }
      return newSettings;
    });
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

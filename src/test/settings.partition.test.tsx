import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, SettingsProvider, useSettingsContext } from '../store/contexts/SettingsContext';
import { splitSettings } from '../store/recordCodec';

const persistenceMocks = vi.hoisted(() => ({
  loadDeviceStore: vi.fn(),
  loadStore: vi.fn(),
  saveDeviceStore: vi.fn(),
  saveStore: vi.fn(),
  saveStoreCommitted: vi.fn(),
  subscribeStoreKey: vi.fn(),
}));

vi.mock('../store/persistence', () => ({
  DEVICE_SETTINGS_STORE_KEY: 'deviceSettings',
  ...persistenceMocks,
}));

const profileApi = vi.hoisted(() => ({
  isProfileServiceEnabled: vi.fn(() => false),
  getGlobalSettings: vi.fn(),
  saveGlobalSettings: vi.fn(),
  getAppPreferences: vi.fn(),
  saveAppPreferences: vi.fn(),
  getIntegrations: vi.fn(),
  saveIntegration: vi.fn(),
}));

const servicePreferences = {
  theme: 'light', dataRetentionDays: 90, telemetry: true, defaultCalendarTab: 'week', goalTags: ['health'],
  updatedAt: '2026-09-01T00:00:00Z',
};
vi.mock('../services/backend/profileServiceApi', () => profileApi);

const prayerApi = vi.hoisted(() => ({
  isPrayerServiceEnabled: vi.fn(() => false),
  getPrayerPreferences: vi.fn(),
  savePrayerPreferences: vi.fn(),
}));
vi.mock('../services/backend/prayerServiceApi', () => prayerApi);

function PrayerPreferencesProbe() {
  const { loaded, settings, updateSettings } = useSettingsContext();
  return (
    <button type="button" onClick={() => updateSettings({ prayerReminderMinutes: 10 })}>
      {loaded
        ? `${settings.prayerEnabled}|${settings.prayerReminderEnabled}|${settings.prayerReminderMinutes}|${settings.prayerCity}`
        : 'loading'}
    </button>
  );
}

function SettingsProbe() {
  const { loaded, settings, updateSettings } = useSettingsContext();
  return (
    <button
      type="button"
      onClick={() => updateSettings({ theme: 'dark', deepgramApiKey: 'changed-device-token', elevenLabsSecretId: 'a0000000-0000-4000-8000-000000000001' })}
    >
      {loaded ? `${settings.theme}|${settings.prayerCity}|${settings.deepgramApiKey}` : 'loading'}
    </button>
  );
}

function TimeZoneProbe() {
  const { appTimeZone, saveAppTimeZonePreference } = useSettingsContext();
  return (
    <div>
      <span>{`${appTimeZone.source}|${appTimeZone.effectiveTimeZone}`}</span>
      <button type="button" onClick={() => void saveAppTimeZonePreference('America/New_York')}>
        Save New York
      </button>
      <button type="button" onClick={() => void saveAppTimeZonePreference(undefined)}>
        Use Automatic
      </button>
    </div>
  );
}

describe('settings shared/device partition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.loadStore.mockImplementation(async (key: string) => (
      key === 'settings' ? { theme: 'light', prayerCity: 'Leeds' } : []
    ));
    persistenceMocks.loadDeviceStore.mockResolvedValue({
      deepgramApiKey: 'device-token',
      supabaseUrl: 'https://device.example.test',
    });
    persistenceMocks.saveStore.mockResolvedValue(undefined);
    persistenceMocks.saveStoreCommitted.mockResolvedValue(undefined);
    persistenceMocks.saveDeviceStore.mockResolvedValue(undefined);
    persistenceMocks.subscribeStoreKey.mockReturnValue(() => undefined);
    profileApi.isProfileServiceEnabled.mockReturnValue(false);
    profileApi.getGlobalSettings.mockResolvedValue({
      city: 'Bedford', country: 'United Kingdom', timeZone: null, updatedAt: '2026-09-01T00:00:00Z',
    });
    profileApi.getAppPreferences.mockResolvedValue(servicePreferences);
    profileApi.saveAppPreferences.mockImplementation(async (preferences: object) => ({
      ...preferences, updatedAt: '2026-09-26T00:00:00Z',
    }));
    profileApi.getIntegrations.mockResolvedValue([]);
  });

  it('proves codec partition discards provider values from new shared and device writes', () => {
    expect(splitSettings({
      theme: 'light',
      telemetry: true,
      lifeHeroEnabled: true,
      deepgramApiKey: 'secret',
      supabaseUrl: 'https://device.example.test',
      unknownField: 'discarded',
    })).toEqual({
      shared: { lifeHeroEnabled: true },
      device: {
        supabaseUrl: 'https://device.example.test',
      },
      service: { theme: 'light', telemetry: true },
    });
  });

  it('keeps the character-based Life Hero explicitly off by default', () => {
    expect(defaultSettings.lifeHeroEnabled).toBe(false);
  });

  it('keeps a validated voice reference device-only and the public voice ID shared', () => {
    expect(splitSettings({ elevenLabsSecretId: 'a0000000-0000-4000-8000-000000000001', elevenLabsVoiceId: 'voice123', monzoAccessToken: 'plaintext' })).toEqual({
      shared: { elevenLabsVoiceId: 'voice123' }, device: { elevenLabsSecretId: 'a0000000-0000-4000-8000-000000000001' },
      service: {},
    });
    expect(splitSettings({ elevenLabsSecretId: 'accidentally-pasted-provider-key' }))
      .toEqual({ shared: {}, device: {}, service: {} });
  });

  it('allows only validated IANA app time zones, owned by the profile service', () => {
    expect(splitSettings({ appTimezone: 'America/New_York' })).toEqual({
      shared: {},
      device: {},
      service: { appTimezone: 'America/New_York' },
    });
    expect(splitSettings({ appTimezone: 'Not/AZone' })).toEqual({ shared: {}, device: {}, service: {} });
  });

  it('keeps app preferences, prayer preferences and location out of the account record', () => {
    expect(splitSettings({
      theme: 'light',
      prayerEnabled: false,
      prayerReminderEnabled: false,
      prayerReminderMinutes: 30,
      prayerCity: 'Leeds',
      prayerCountry: 'United Kingdom',
    })).toEqual({
      shared: {},
      device: {},
      service: {
        theme: 'light',
        prayerEnabled: false,
        prayerReminderEnabled: false,
        prayerReminderMinutes: 30,
        prayerCity: 'Leeds',
        prayerCountry: 'United Kingdom',
      },
    });
  });

  it('proves SettingsContext hydrates app preferences from the profile service and device fields from the device store', async () => {
    profileApi.isProfileServiceEnabled.mockReturnValue(true);
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    // The retired account record is never read: the theme comes from the profile service.
    const button = await screen.findByRole('button', { name: 'light|Bedford|undefined' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button.textContent).toBe('dark|Bedford|undefined');
    expect(persistenceMocks.loadStore).not.toHaveBeenCalled();
    expect(persistenceMocks.saveStore).not.toHaveBeenCalled();
    expect(profileApi.saveAppPreferences).toHaveBeenCalledTimes(1);
    expect(profileApi.saveAppPreferences).toHaveBeenCalledWith({
      theme: 'dark', dataRetentionDays: 90, telemetry: true, defaultCalendarTab: 'week', goalTags: ['health'],
    });
    expect(persistenceMocks.saveDeviceStore.mock.calls.at(-1)).toEqual([
      'deviceSettings',
      {
        elevenLabsSecretId: 'a0000000-0000-4000-8000-000000000001',
        supabaseUrl: 'https://device.example.test',
      },
    ]);
  });

  it('never saves app preferences before the profile service has loaded them', async () => {
    profileApi.isProfileServiceEnabled.mockReturnValue(true);
    profileApi.getAppPreferences.mockRejectedValue(new Error('profile service unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    const button = await screen.findByRole('button', { name: 'dark|Bedford|undefined' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(profileApi.getAppPreferences).toHaveBeenCalledTimes(1);
    expect(profileApi.saveAppPreferences).not.toHaveBeenCalled();
    expect(persistenceMocks.saveStore).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('proves the provider source keeps device hydration and writes separate from shared settings', () => {
    const root = resolve(__dirname, '../..');
    const source = readFileSync(resolve(root, 'src/store/contexts/SettingsContext.tsx'), 'utf8');

    expect(source).toContain('loadDeviceStore<DeviceSettings>');
    expect(source).toContain('saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, splitSettings(settings).device)');
    expect(source).toContain('useAppPreferencesSync(loaded, settings, applyServiceAppPreferences)');
    expect(source).not.toContain("saveStore('settings'");
    expect(source).not.toContain("loadStore<Settings>('settings')");
  });

  it('commits a preferred app time zone before publishing it and clears back to Automatic', async () => {
    persistenceMocks.loadStore.mockImplementation(async (key: string) => (
      key === 'settings' ? { appTimezone: 'Europe/London' } : []
    ));
    render(
      <SettingsProvider>
        <TimeZoneProbe />
      </SettingsProvider>,
    );

    // A zone saved in the account record is no longer read: the profile service owns it.
    await screen.findByText(/automatic\||utc-fallback\|/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save New York' }));
    });
    expect(screen.getByText('preference|America/New_York')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Automatic' }));
    });
    expect(screen.getByText(/automatic\||utc-fallback\|/)).toBeInTheDocument();
    expect(persistenceMocks.saveStoreCommitted).not.toHaveBeenCalled();
    for (const [key, value] of persistenceMocks.saveStore.mock.calls) {
      if (key === 'settings') expect(splitSettings(value).shared).not.toHaveProperty('appTimezone');
    }
  });

  it('confirms a preferred time zone with the profile service before showing it', async () => {
    profileApi.isProfileServiceEnabled.mockReturnValue(true);
    profileApi.getGlobalSettings.mockResolvedValue({
      city: 'London', country: 'United Kingdom', timeZone: 'Europe/London', updatedAt: '2026-09-01T00:00:00Z',
    });
    profileApi.saveGlobalSettings.mockImplementation(async (location: object) => ({
      ...location, updatedAt: '2026-09-26T00:00:00Z',
    }));
    render(
      <SettingsProvider>
        <TimeZoneProbe />
      </SettingsProvider>,
    );
    await screen.findByText('preference|Europe/London');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save New York' }));
    });

    expect(profileApi.saveGlobalSettings).toHaveBeenCalledTimes(1);
    expect(profileApi.saveGlobalSettings).toHaveBeenCalledWith({
      city: 'London', country: 'United Kingdom', timeZone: 'America/New_York',
    });
    expect(screen.getByText('preference|America/New_York')).toBeInTheDocument();
  });

  it('loads prayer preferences from the prayer service and saves only real edits back', async () => {
    prayerApi.isPrayerServiceEnabled.mockReturnValue(true);
    prayerApi.getPrayerPreferences.mockResolvedValue({ enabled: true, reminderEnabled: false, reminderMinutes: 30 });
    prayerApi.savePrayerPreferences.mockImplementation(async (preferences: object) => preferences);
    render(
      <SettingsProvider>
        <PrayerPreferencesProbe />
      </SettingsProvider>,
    );

    const probe = await screen.findByRole('button', { name: 'true|false|30|Bedford' });
    expect(prayerApi.savePrayerPreferences).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(probe);
    });

    expect(prayerApi.savePrayerPreferences).toHaveBeenCalledTimes(1);
    expect(prayerApi.savePrayerPreferences).toHaveBeenCalledWith({
      enabled: true, reminderEnabled: false, reminderMinutes: 10,
    });
    expect(persistenceMocks.saveStore).not.toHaveBeenCalled();
    prayerApi.isPrayerServiceEnabled.mockReturnValue(false);
  });
});

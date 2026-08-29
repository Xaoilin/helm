import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettingsContext } from '../store/contexts/SettingsContext';
import { splitSettings } from '../store/recordCodec';
import type { Settings } from '../types/domain';

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

function SettingsProbe() {
  const { loaded, settings, updateSettings } = useSettingsContext();
  return (
    <button
      type="button"
      onClick={() => updateSettings({ theme: 'dark', deepgramApiKey: 'changed-device-token' })}
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
  });

  it('proves codec partition keeps shared fields and device credentials disjoint', () => {
    expect(splitSettings({
      theme: 'light',
      telemetry: true,
      deepgramApiKey: 'secret',
      supabaseUrl: 'https://device.example.test',
      unknownField: 'discarded',
    })).toEqual({
      shared: { theme: 'light', telemetry: true },
      device: {
        deepgramApiKey: 'secret',
        supabaseUrl: 'https://device.example.test',
      },
    });
  });

  it('allows only validated account-shared IANA app time zones', () => {
    expect(splitSettings({ appTimezone: 'America/New_York' })).toEqual({
      shared: { appTimezone: 'America/New_York' },
      device: {},
    });
    expect(splitSettings({ appTimezone: 'Not/AZone' })).toEqual({ shared: {}, device: {} });
  });

  it('proves SettingsContext hydrates both stores and writes device fields through the device path', async () => {
    render(
      <SettingsProvider>
        <SettingsProbe />
      </SettingsProvider>,
    );

    const button = await screen.findByRole('button', { name: 'light|Leeds|device-token' });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button.textContent).toBe('dark|Leeds|changed-device-token');
    const savedSettings = persistenceMocks.saveStore.mock.calls
      .filter(([key]) => key === 'settings')
      .at(-1)?.[1] as Settings;
    const savedDevice = persistenceMocks.saveDeviceStore.mock.calls.at(-1);
    expect(splitSettings(savedSettings).device).toEqual({
      deepgramApiKey: 'changed-device-token',
      supabaseUrl: 'https://device.example.test',
    });
    expect(savedDevice).toEqual([
      'deviceSettings',
      {
        deepgramApiKey: 'changed-device-token',
        supabaseUrl: 'https://device.example.test',
      },
    ]);
  });

  it('proves the provider source keeps device hydration and writes separate from shared settings', () => {
    const root = resolve(__dirname, '../..');
    const source = readFileSync(resolve(root, 'src/store/contexts/SettingsContext.tsx'), 'utf8');

    expect(source).toContain('loadDeviceStore<DeviceSettings>');
    expect(source).toContain('saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, splitSettings(settings).device)');
    expect(source).toContain("saveStore('settings', settings)");
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

    await screen.findByText('preference|Europe/London');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save New York' }));
    });
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenLastCalledWith(
      'settings',
      expect.objectContaining({ appTimezone: 'America/New_York' }),
    );
    expect(screen.getByText('preference|America/New_York')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use Automatic' }));
    });
    const committedSettings = persistenceMocks.saveStoreCommitted.mock.calls.at(-1)?.[1] as Settings;
    expect(committedSettings).not.toHaveProperty('appTimezone');
    expect(screen.getByText(/automatic\||utc-fallback\|/)).toBeInTheDocument();
  });
});

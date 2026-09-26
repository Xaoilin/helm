import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultIntegrations, SettingsProvider, useSettingsContext } from '../store/contexts/SettingsContext';
import type { ServiceIntegration } from '../services/backend/contracts';

const persistence = vi.hoisted(() => ({
  loadStore: vi.fn(), loadDeviceStore: vi.fn(), saveStore: vi.fn(),
  saveDeviceStore: vi.fn(), saveStoreCommitted: vi.fn(), subscribeStoreKey: vi.fn(),
}));
vi.mock('../store/persistence', () => ({ DEVICE_SETTINGS_STORE_KEY: 'deviceSettings', ...persistence }));

const profileApi = vi.hoisted(() => ({
  isProfileServiceEnabled: vi.fn(() => true),
  getGlobalSettings: vi.fn(),
  saveGlobalSettings: vi.fn(),
  getAppPreferences: vi.fn(),
  saveAppPreferences: vi.fn(),
  getIntegrations: vi.fn(),
  saveIntegration: vi.fn(),
}));
vi.mock('../services/backend/profileServiceApi', () => profileApi);

let context: ReturnType<typeof useSettingsContext>;
function Probe() {
  const current = useSettingsContext();
  useEffect(() => { context = current; }, [current]);
  return <div>{current.loaded ? 'ready' : 'loading'}</div>;
}

const savedGoogle: ServiceIntegration = {
  provider: 'google', status: 'error', configuredAt: '2026-07-01T12:00:00Z',
  lastError: 'Reconnect required', updatedAt: '2026-07-01T12:00:00Z',
};

describe('integration hydration from the profile service', () => {
  let records: ServiceIntegration[];
  beforeEach(() => {
    vi.clearAllMocks();
    records = [];
    profileApi.isProfileServiceEnabled.mockReturnValue(true);
    profileApi.getIntegrations.mockImplementation(async () => records);
    profileApi.getGlobalSettings.mockRejectedValue(new Error('not under test'));
    profileApi.getAppPreferences.mockRejectedValue(new Error('not under test'));
    profileApi.saveGlobalSettings.mockRejectedValue(new Error('not under test'));
    profileApi.saveIntegration.mockImplementation(async (provider: string, integration: object) => ({
      provider, ...integration, updatedAt: '2026-09-26T00:00:00Z',
    }));
    persistence.loadDeviceStore.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('keeps supported setup discoverable when the service has no records', async () => {
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');
    await waitFor(() => expect(profileApi.getIntegrations).toHaveBeenCalledOnce());
    expect(context.integrations).toEqual(defaultIntegrations);
  });

  it('applies each saved connection record to its offered integration and never reads the account record', async () => {
    records = [savedGoogle, { ...savedGoogle, provider: 'historical', status: 'connected' }];
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');

    await waitFor(() => expect(context.integrations[0]).toMatchObject({
      id: 'int-google', provider: 'google', status: 'error',
      configuredAt: '2026-07-01T12:00:00Z', lastError: 'Reconnect required',
    }));
    expect(context.integrations.map(integration => integration.provider)).toEqual(['google', 'github']);
    expect(context.integrations[1]).toEqual(defaultIntegrations[1]);
    expect(persistence.loadStore).not.toHaveBeenCalled();
  });

  it('saves a Google connection change to the profile service, not to the account record', async () => {
    records = [savedGoogle];
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');
    await waitFor(() => expect(context.integrations[0].status).toBe('error'));

    act(() => context.updateIntegration('int-google', { status: 'connected', lastError: undefined }));
    expect(context.integrations[0]).toMatchObject({ status: 'connected', lastError: undefined });
    expect(profileApi.saveIntegration).toHaveBeenCalledOnce();
    expect(profileApi.saveIntegration).toHaveBeenCalledWith('google', {
      status: 'connected', configuredAt: '2026-07-01T12:00:00Z', lastError: null,
    });

    act(() => context.updateIntegration('int-github', { status: 'connected' }));
    expect(context.integrations[1].status).toBe('connected');
    expect(profileApi.saveIntegration).toHaveBeenCalledOnce();
    expect(persistence.saveStore).not.toHaveBeenCalled();
  });

  it('keeps the offered integrations and saves nothing when the profile service is not configured', async () => {
    profileApi.isProfileServiceEnabled.mockReturnValue(false);
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');

    act(() => context.updateIntegration('int-google', { status: 'connected' }));
    expect(context.integrations[0].status).toBe('connected');
    expect(profileApi.getIntegrations).not.toHaveBeenCalled();
    expect(profileApi.saveIntegration).not.toHaveBeenCalled();
    expect(persistence.saveStore).not.toHaveBeenCalled();
  });
});

import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider, useSettingsContext } from '../store/contexts/SettingsContext';
import type { Integration } from '../types/domain';

const persistence = vi.hoisted(() => ({
  loadStore: vi.fn(), loadDeviceStore: vi.fn(), saveStore: vi.fn(),
  saveDeviceStore: vi.fn(), saveStoreCommitted: vi.fn(), subscribeStoreKey: vi.fn(),
}));
vi.mock('../store/persistence', () => ({ DEVICE_SETTINGS_STORE_KEY: 'deviceSettings', ...persistence }));

let context: ReturnType<typeof useSettingsContext>;
function Probe() {
  const current = useSettingsContext();
  useEffect(() => { context = current; }, [current]);
  return <div>{current.loaded ? 'ready' : 'loading'}</div>;
}

const google: Integration = {
  id: 'existing-google', provider: 'google', name: 'My calendar', description: 'Saved choice',
  icon: 'calendar', status: 'error', configuredAt: '2026-07-01T12:00:00Z', lastError: 'Reconnect required',
};
const historical: Integration[] = [
  { ...google, id: 'other-google', status: 'disconnected' },
  { ...google, id: 'old-slack', provider: 'slack', status: 'mocked' },
  { ...google, id: 'old-linear', provider: 'linear', status: 'connected' },
  { ...google, id: 'unknown-provider', provider: 'historical' },
];

describe('integration catalogue hydration', () => {
  let records: Integration[] | null;
  const refresh = new Map<string, () => void>();
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.clear();
    records = [];
    persistence.loadStore.mockImplementation(async (key: string) => key === 'integrations' ? records : null);
    persistence.loadDeviceStore.mockResolvedValue(null);
    persistence.subscribeStoreKey.mockImplementation((key, callback) => {
      refresh.set(key, callback);
      return () => refresh.delete(key);
    });
  });

  it.each([null, []])('keeps supported setup discoverable for an empty collection (%j)', async initial => {
    records = initial;
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');
    expect(context.integrations.map(record => record.provider)).toEqual(['google', 'github']);
    expect(context.integrations.every(record => record.status === 'disconnected')).toBe(true);
  });

  it('fills a partial collection without replacing IDs, choices or historical records in autosave', async () => {
    records = [google, ...historical];
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');
    expect(context.integrations.slice(0, records.length)).toEqual(records);
    expect(context.integrations.filter(record => record.provider === 'google')).toHaveLength(2);
    expect(context.integrations.filter(record => record.provider === 'github')).toHaveLength(1);
    expect(context.integrations).not.toContainEqual(expect.objectContaining({ id: 'int-google' }));
    expect(persistence.saveStore).toHaveBeenCalledWith('integrations', context.integrations);

    act(() => context.updateIntegration(google.id, { status: 'connected' }));
    expect(context.integrations[0]).toEqual({ ...google, status: 'connected' });
    expect(context.integrations.slice(1, 1 + historical.length)).toEqual(historical);
  });

  it('applies the same merge on remote refresh and keeps complete provider records unchanged', async () => {
    records = [google, { ...google, id: 'existing-github', provider: 'github', status: 'connected' }, ...historical];
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText('ready');
    expect(context.integrations).toEqual(records);

    records = [{ ...google, lastError: 'Remote reconnect required' }, ...historical];
    await act(async () => refresh.get('integrations')?.());
    await waitFor(() => expect(context.integrations[0]).toEqual(records![0]));
    expect(context.integrations.slice(0, records.length)).toEqual(records);
    expect(context.integrations.filter(record => record.provider === 'github')).toHaveLength(1);
    expect(persistence.saveStore).toHaveBeenLastCalledWith('integrations', context.integrations);

    records = [];
    await act(async () => refresh.get('integrations')?.());
    await waitFor(() => expect(context.integrations.map(record => record.provider)).toEqual(['google', 'github']));
  });
});

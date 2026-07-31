import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

const {
  isAuthenticatedMock,
  isSupabaseReadyMock,
} = vi.hoisted(() => ({
  isAuthenticatedMock: vi.fn(() => false),
  isSupabaseReadyMock: vi.fn(() => false),
}));

vi.mock('../store/supabase', () => ({
  applyHelmMutations: vi.fn(),
  fetchHelmAccountSnapshot: vi.fn(),
  fetchHelmCollections: vi.fn(),
  getCurrentUserId: vi.fn(() => null),
  getSupabaseRealtimeSnapshot: vi.fn(() => ({
    state: 'unavailable',
    lastEventAt: null,
    lastStatusAt: null,
    lastError: null,
  })),
  isAuthenticated: isAuthenticatedMock,
  isSupabaseReady: isSupabaseReadyMock,
  probeHelmAccountVersion: vi.fn(async () => 0),
  subscribeHelmBroadcast: vi.fn(() => () => {}),
  subscribeSupabaseRealtimeSnapshot: vi.fn(() => () => {}),
}));

import {
  DEVICE_SETTINGS_STORE_KEY,
  getSyncSessionSnapshot,
  loadDeviceStore,
  loadStore,
  resetDatabasePersistence,
  saveDeviceStore,
  saveStore,
} from '../store/persistence';

describe('database-authoritative persistence boundaries', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    isAuthenticatedMock.mockReturnValue(false);
    isSupabaseReadyMock.mockReturnValue(false);
    resetDatabasePersistence();
  });

  it('never reads a shared browser snapshot while signed out', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([{ id: 'device-task' }]));

    await expect(loadStore('tasks')).resolves.toBeNull();
    expect(getSyncSessionSnapshot().status).toBe('blocked');
  });

  it('never writes shared data to browser or native storage', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Blocked write' }]);

    expect(localStorage.getItem('helm:tasks')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('write_store', expect.anything());
  });

  it('keeps explicitly device-bound settings local', async () => {
    await saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, {
      microphoneDeviceId: 'device-microphone',
      ollamaEndpoint: 'http://127.0.0.1:11434',
    });

    await expect(loadDeviceStore(DEVICE_SETTINGS_STORE_KEY)).resolves.toEqual({
      microphoneDeviceId: 'device-microphone',
      ollamaEndpoint: 'http://127.0.0.1:11434',
    });
    expect(localStorage.getItem('helm:device:deviceSettings')).toContain('device-microphone');
    expect(localStorage.getItem('helm:settings')).toBeNull();
  });
});

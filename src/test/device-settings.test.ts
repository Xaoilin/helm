import { afterEach, describe, expect, it } from 'vitest';
import { clearRetiredDashboardCaches, loadDeviceSettings, saveDeviceSettings } from '../store/deviceSettings';

afterEach(() => localStorage.clear());

describe('device-only settings in browser storage', () => {
  it('reads the current key, falls back to the original key once, and drops everything but device fields', () => {
    expect(loadDeviceSettings()).toEqual({});

    localStorage.setItem('helm:device:deviceSettings', JSON.stringify({
      googleOAuthClientId: 'client-legacy', deepgramApiKey: 'plaintext', theme: 'light',
    }));
    expect(loadDeviceSettings()).toEqual({ googleOAuthClientId: 'client-legacy' });

    saveDeviceSettings({ googleOAuthClientId: 'client-2', monzoAccessToken: 'plaintext', prayerCity: 'Leeds' });
    expect(JSON.parse(localStorage.getItem('helm:device:deviceSettings:v2')!)).toEqual({ googleOAuthClientId: 'client-2' });
    expect(loadDeviceSettings()).toEqual({ googleOAuthClientId: 'client-2' });
    // The original source is left byte-for-byte unchanged.
    expect(JSON.parse(localStorage.getItem('helm:device:deviceSettings')!)).toMatchObject({ deepgramApiKey: 'plaintext' });
  });

  it('treats unreadable stored settings as none', () => {
    localStorage.setItem('helm:device:deviceSettings:v2', '{not json');
    expect(loadDeviceSettings()).toEqual({});
  });

  it('removes only the retired dashboard caches', () => {
    localStorage.setItem('helm:dashboardFocusCache:v1', '{}');
    localStorage.setItem('helm:dashboardFocusHostedReview:v1', '{}');
    localStorage.setItem('helm:device:deviceSettings:v2', '{}');
    clearRetiredDashboardCaches();
    expect(localStorage.getItem('helm:dashboardFocusCache:v1')).toBeNull();
    expect(localStorage.getItem('helm:dashboardFocusHostedReview:v1')).toBeNull();
    expect(localStorage.getItem('helm:device:deviceSettings:v2')).toBe('{}');
  });
});

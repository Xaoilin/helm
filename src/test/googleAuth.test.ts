import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGoogleTokens,
  isTokenValid,
  loadGoogleTokens,
  requestGoogleAuthorizationCode,
  saveGoogleTokens,
  type GoogleTokens,
} from '../services/googleAuth';

describe('googleAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    Reflect.deleteProperty(window, 'google');
  });

  const sampleTokens: GoogleTokens = {
    accessToken: 'ya29.test-token',
    expiresAt: Date.now() + 3600000,
    scope: 'https://www.googleapis.com/auth/calendar',
  };

  it('saves and loads legacy browser tokens for migration diagnostics', () => {
    saveGoogleTokens('acc1', sampleTokens);
    expect(loadGoogleTokens('acc1')).toEqual(sampleTokens);
  });

  it('clears legacy browser tokens per account', () => {
    saveGoogleTokens('acc1', sampleTokens);
    saveGoogleTokens('acc2', { ...sampleTokens, accessToken: 'ya29.other-token' });

    clearGoogleTokens('acc1');

    expect(loadGoogleTokens('acc1')).toBeNull();
    expect(loadGoogleTokens('acc2')?.accessToken).toBe('ya29.other-token');
  });

  it('treats near-expiry legacy tokens as invalid', () => {
    expect(isTokenValid({
      accessToken: 'ya29.almost-expired',
      expiresAt: Date.now() + 30_000,
      scope: 'calendar',
    })).toBe(false);
  });

  it('requests a Google authorization code through the GIS code client', async () => {
    const requestCode = vi.fn(() => {
      callback?.({
        code: 'google-auth-code',
        scope: 'https://www.googleapis.com/auth/calendar',
      });
    });
    let callback: ((response: { code?: string; scope?: string; error?: string; error_description?: string }) => void) | undefined;
    const initCodeClient = vi.fn((config: {
      client_id: string;
      scope: string;
      callback: (response: { code?: string; scope?: string; error?: string; error_description?: string }) => void;
      login_hint?: string;
      select_account?: boolean;
    }) => {
      callback = config.callback;
      return { requestCode };
    });

    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          oauth2: {
            initCodeClient,
            revoke: vi.fn(),
          },
        },
      },
    });

    await expect(requestGoogleAuthorizationCode('client-id', {
      loginHint: 'alisa@example.com',
      selectAccount: true,
    })).resolves.toEqual({
      code: 'google-auth-code',
      scope: 'https://www.googleapis.com/auth/calendar',
    });

    expect(initCodeClient).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'client-id',
      login_hint: 'alisa@example.com',
      select_account: true,
    }));
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it('surfaces GIS code-flow errors to the caller', async () => {
    const requestCode = vi.fn(() => {
      callback?.({
        error: 'access_denied',
        error_description: 'The user cancelled the flow.',
      });
    });
    let callback: ((response: { code?: string; scope?: string; error?: string; error_description?: string }) => void) | undefined;

    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          oauth2: {
            initCodeClient: vi.fn((config: { callback: typeof callback }) => {
              callback = config.callback;
              return { requestCode };
            }),
            revoke: vi.fn(),
          },
        },
      },
    });

    await expect(requestGoogleAuthorizationCode('client-id')).rejects.toThrow('The user cancelled the flow.');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveGoogleTokens,
  loadGoogleTokens,
  clearGoogleTokens,
  isTokenValid,
  getValidAccessToken,
  type GoogleTokens,
} from '../services/googleAuth';

describe('googleAuth token management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const sampleTokens: GoogleTokens = {
    accessToken: 'ya29.test-token',
    expiresAt: Date.now() + 3600000,
    scope: 'https://www.googleapis.com/auth/calendar',
  };

  describe('saveGoogleTokens / loadGoogleTokens', () => {
    it('should save and load tokens', () => {
      saveGoogleTokens('acc1', sampleTokens);
      const loaded = loadGoogleTokens('acc1');
      expect(loaded).toEqual(sampleTokens);
    });

    it('should return null for non-existent account', () => {
      expect(loadGoogleTokens('nonexistent')).toBeNull();
    });

    it('should isolate tokens per account', () => {
      const tokens2: GoogleTokens = { ...sampleTokens, accessToken: 'ya29.other-token' };
      saveGoogleTokens('acc1', sampleTokens);
      saveGoogleTokens('acc2', tokens2);
      expect(loadGoogleTokens('acc1')?.accessToken).toBe('ya29.test-token');
      expect(loadGoogleTokens('acc2')?.accessToken).toBe('ya29.other-token');
    });
  });

  describe('clearGoogleTokens', () => {
    it('should remove tokens for an account', () => {
      saveGoogleTokens('acc1', sampleTokens);
      clearGoogleTokens('acc1');
      expect(loadGoogleTokens('acc1')).toBeNull();
    });

    it('should not affect other accounts', () => {
      saveGoogleTokens('acc1', sampleTokens);
      saveGoogleTokens('acc2', sampleTokens);
      clearGoogleTokens('acc1');
      expect(loadGoogleTokens('acc2')).not.toBeNull();
    });
  });

  describe('isTokenValid', () => {
    it('should return true for fresh tokens', () => {
      const tokens: GoogleTokens = {
        accessToken: 'ya29.fresh',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        scope: 'calendar',
      };
      expect(isTokenValid(tokens)).toBe(true);
    });

    it('should return false for expired tokens', () => {
      const tokens: GoogleTokens = {
        accessToken: 'ya29.expired',
        expiresAt: Date.now() - 1000, // 1 second ago
        scope: 'calendar',
      };
      expect(isTokenValid(tokens)).toBe(false);
    });

    it('should return false for tokens expiring within 60s', () => {
      const tokens: GoogleTokens = {
        accessToken: 'ya29.almost',
        expiresAt: Date.now() + 30000, // 30 seconds from now
        scope: 'calendar',
      };
      expect(isTokenValid(tokens)).toBe(false);
    });

    it('should return false for null tokens', () => {
      expect(isTokenValid(null)).toBe(false);
    });
  });

  describe('getValidAccessToken (no-popup regression)', () => {
    it('should return stored token even if expired when no GIS available', async () => {
      const expiredTokens: GoogleTokens = {
        accessToken: 'ya29.expired-but-stored',
        expiresAt: Date.now() - 3600000, // 1 hour ago
        scope: 'calendar',
      };
      saveGoogleTokens('acc-expired', expiredTokens);

      // With empty clientId, skips refresh attempt and returns expired token as fallback
      const token = await getValidAccessToken('acc-expired', '');
      expect(token).toBe('ya29.expired-but-stored');
    });

    it('should return stored token when still valid', async () => {
      const freshTokens: GoogleTokens = {
        accessToken: 'ya29.fresh',
        expiresAt: Date.now() + 3600000,
        scope: 'calendar',
      };
      saveGoogleTokens('acc-fresh', freshTokens);

      const token = await getValidAccessToken('acc-fresh', 'client-id');
      expect(token).toBe('ya29.fresh');
    });

    it('should throw when no tokens exist at all', async () => {
      await expect(getValidAccessToken('acc-none', 'client-id'))
        .rejects.toThrow('No stored tokens');
    });
  });
});

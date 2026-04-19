import { describe, expect, it } from 'vitest';
import { shouldReloadForAuthStateChange } from '../services/authStateReload';

describe('shouldReloadForAuthStateChange', () => {
  it('ignores background token refresh events for the same signed-in user', () => {
    expect(shouldReloadForAuthStateChange('TOKEN_REFRESHED', 'user-1', 'user-1')).toBe(false);
  });

  it('reloads when the signed-in user changes', () => {
    expect(shouldReloadForAuthStateChange('SIGNED_IN', 'user-1', 'user-2')).toBe(true);
  });

  it('reloads when the current signed-in user signs out', () => {
    expect(shouldReloadForAuthStateChange('SIGNED_OUT', 'user-1', null)).toBe(true);
  });
});

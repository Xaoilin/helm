// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkForPublishedRelease,
  compareSemverVersions,
  shouldForceRefreshForRelease,
} from '../services/releaseRefresh';

describe('checkForPublishedRelease', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forces a one-time reload when the deployed release is newer', async () => {
    const reload = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.8' }),
    });

    const didReload = await checkForPublishedRelease({
      currentVersion: '0.2.7',
      fetcher,
      origin: 'https://xaoilin.github.io',
      protocol: 'https:',
      reload,
      sessionStore: sessionStorage,
    });

    expect(didReload).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('helm:release-refresh:0.2.8')).toBe('done');
  });

  it('does not reload when the published release is the same or older', async () => {
    const reload = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.8' }),
    });

    const didReload = await checkForPublishedRelease({
      currentVersion: '0.2.8',
      fetcher,
      origin: 'https://xaoilin.github.io',
      protocol: 'https:',
      reload,
      sessionStore: sessionStorage,
    });

    expect(didReload).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload twice for the same published version in one tab session', async () => {
    const reload = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.9' }),
    });

    const firstCheck = await checkForPublishedRelease({
      currentVersion: '0.2.8',
      fetcher,
      origin: 'https://xaoilin.github.io',
      protocol: 'https:',
      reload,
      sessionStore: sessionStorage,
    });

    const secondCheck = await checkForPublishedRelease({
      currentVersion: '0.2.8',
      fetcher,
      origin: 'https://xaoilin.github.io',
      protocol: 'https:',
      reload,
      sessionStore: sessionStorage,
    });

    expect(firstCheck).toBe(true);
    expect(secondCheck).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('release version comparison', () => {
  it('compares semver values numerically', () => {
    expect(compareSemverVersions('0.2.9', '0.2.8')).toBe(1);
    expect(compareSemverVersions('0.2.8', '0.2.8')).toBe(0);
    expect(compareSemverVersions('0.2.8', '0.3.0')).toBe(-1);
  });

  it('only refreshes when the published release is newer', () => {
    expect(shouldForceRefreshForRelease('0.2.8', '0.2.9')).toBe(true);
    expect(shouldForceRefreshForRelease('0.2.8', '0.2.8')).toBe(false);
    expect(shouldForceRefreshForRelease('0.2.8', '0.2.7')).toBe(false);
    expect(shouldForceRefreshForRelease('0.2.8', 'invalid')).toBe(false);
  });
});

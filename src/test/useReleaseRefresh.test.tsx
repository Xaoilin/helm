import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { TIMING } from '../config/constants';
import { useReleaseRefresh } from '../hooks/useReleaseRefresh';
import * as releaseRefreshService from '../services/releaseRefresh';

function ReleaseRefreshHarness({ enabled = true }: { enabled?: boolean }) {
  useReleaseRefresh({ enabled });
  return null;
}

describe('useReleaseRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(releaseRefreshService, 'checkForPublishedRelease').mockResolvedValue(false);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('checks immediately and on the release polling interval', async () => {
    render(<ReleaseRefreshHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(releaseRefreshService.checkForPublishedRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(TIMING.RELEASE_POLL_INTERVAL);
      await Promise.resolve();
    });

    expect(releaseRefreshService.checkForPublishedRelease).toHaveBeenCalledTimes(2);
  });

  it('checks when the tab becomes visible again', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    render(<ReleaseRefreshHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(releaseRefreshService.checkForPublishedRelease).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(releaseRefreshService.checkForPublishedRelease).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForPublishedRelease } from '../services/releaseRefresh';
import {
  configureOperationalTransport,
  setOperationalAccount,
} from '../services/operationalTelemetry';

const response = (version: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ version }),
});

describe('release refresh safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    configureOperationalTransport(null);
    setOperationalAccount(null);
    setOperationalAccount('synthetic-release-account');
  });

  afterEach(() => {
    setOperationalAccount(null);
    configureOperationalTransport(null);
    vi.useRealTimers();
  });

  it('rechecks reload safety after the manifest request and leaves the release retryable', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    let safe = true;
    const fetcher = vi.fn(() => new Promise<ReturnType<typeof response>>(resolve => { finish = resolve; }));
    const reload = vi.fn();
    const sessionStore = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const pending = checkForPublishedRelease({
      currentVersion: '1.0.0',
      fetcher,
      origin: 'https://example.test',
      protocol: 'https:',
      reload,
      sessionStore,
      canReload: () => safe,
    });

    safe = false;
    finish(response('1.0.1'));

    await expect(pending).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStore.setItem).not.toHaveBeenCalled();
  });

  it('starts the keepalive diagnostics batch before performing one safe reload', async () => {
    const send = vi.fn(async () => {});
    configureOperationalTransport(send);
    const reload = vi.fn(() => expect(send).toHaveBeenCalled());

    await expect(checkForPublishedRelease({
      currentVersion: '1.0.0',
      fetcher: vi.fn(async () => response('1.0.1')),
      origin: 'https://example.test',
      protocol: 'https:',
      reload,
      sessionStore: { getItem: () => null, setItem: vi.fn() },
      canReload: () => true,
    })).resolves.toBe(true);

    expect(reload).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it('aborts a held manifest request at the bounded deadline', async () => {
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<ReturnType<typeof response>>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const pending = checkForPublishedRelease({
      fetcher,
      origin: 'https://example.test',
      protocol: 'https:',
      reload: vi.fn(),
      sessionStore: { getItem: () => null, setItem: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe(false);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

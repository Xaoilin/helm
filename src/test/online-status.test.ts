import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { callService, resetServiceCircuits } from '../services/backend/serviceClient';

vi.mock('../store/supabase', () => ({
  SessionUnavailableError: class extends Error {},
  getFreshAccessToken: async () => 'synthetic-access-token',
}));

beforeEach(() => {
  resetServiceCircuits();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('recovers from a false offline flag when an authenticated service answers, without an online event', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  const { result } = renderHook(useOnlineStatus);
  expect(result.current).toBe(false);

  await act(async () => { await callService('https://svc.test', 'GET', '/data', null); });

  expect(navigator.onLine).toBe(false);
  expect(result.current).toBe(true);

  // A later network change discards the earlier connection evidence.
  act(() => { window.dispatchEvent(new Event('offline')); });
  expect(result.current).toBe(false);
});

it('recognizes a service refusal as reachable while still reporting its operation error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(
    { code: 'conflict', message: 'Already saved.' }, { status: 409 }));
  const { result } = renderHook(useOnlineStatus);

  await act(async () => {
    await expect(callService('https://svc.test', 'POST', '/data', null))
      .rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  expect(result.current).toBe(true);
});

it('keeps the offline state when a service cannot be reached', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
  const { result } = renderHook(useOnlineStatus);

  await act(async () => {
    await expect(callService('https://svc.test', 'POST', '/data', null))
      .rejects.toMatchObject({ code: 'network' });
  });

  expect(result.current).toBe(false);
});

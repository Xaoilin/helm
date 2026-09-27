import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
}));

vi.mock('../services/releaseRefresh', () => ({
  checkForPublishedRelease: mocks.check,
}));

import { useReleaseRefresh } from '../hooks/useReleaseRefresh';

beforeEach(() => {
  mocks.check.mockReset().mockImplementation(({ signal }: { signal: AbortSignal }) => (
    new Promise<boolean>(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }))
  ));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('defers reload for open editors, visible text drafts, hidden state, and disposal', async () => {
  const { unmount } = renderHook(() => useReleaseRefresh({ enabled: true }));
  await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce());
  const options = mocks.check.mock.calls[0][0] as { signal: AbortSignal; canReload: () => boolean };

  expect(options.canReload()).toBe(true);

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  expect(options.canReload()).toBe(false);
  dialog.remove();

  const draft = document.createElement('textarea');
  draft.value = 'unsaved message';
  draft.getClientRects = () => [{ width: 100, height: 20 } as DOMRect] as unknown as DOMRectList;
  document.body.append(draft);
  expect(options.canReload()).toBe(false);
  draft.remove();

  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  expect(options.canReload()).toBe(false);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

  unmount();
  expect(options.signal.aborted).toBe(true);
  expect(options.canReload()).toBe(false);
});

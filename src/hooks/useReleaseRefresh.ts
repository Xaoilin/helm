import { useEffect } from 'react';
import { TIMING } from '../config/constants';
import { checkForPublishedRelease } from '../services/releaseRefresh';
import { getPersistenceHealthSnapshot } from '../store/persistence';

type UseReleaseRefreshOptions = {
  enabled?: boolean;
};

function hasVisibleEditableDraft(): boolean {
  const editables = document.querySelectorAll<HTMLElement>(
    'textarea:not(:disabled):not([readonly]), input:not([type]):not(:disabled):not([readonly]), input[type="text"]:not(:disabled):not([readonly]), input[type="search"]:not(:disabled):not([readonly]), input[type="email"]:not(:disabled):not([readonly]), input[type="url"]:not(:disabled):not([readonly]), input[type="tel"]:not(:disabled):not([readonly]), [contenteditable="true"]',
  );
  return [...editables].some(element => {
    if (element.getClientRects().length === 0) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value.trim().length > 0;
    }
    return (element.textContent || '').trim().length > 0;
  });
}

export function useReleaseRefresh({
  enabled = import.meta.env.MODE !== 'test',
}: UseReleaseRefreshOptions = {}): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let disposed = false;
    let checking = false;
    let activeController: AbortController | null = null;

    const canReload = () => (
      !disposed
      && document.visibilityState !== 'hidden'
      && getPersistenceHealthSnapshot().supabaseQueue.queuedCount === 0
      && document.querySelector('[role="dialog"][aria-modal="true"]') === null
      && !hasVisibleEditableDraft()
    );

    const runCheck = async () => {
      if (disposed || checking || document.visibilityState === 'hidden') {
        return;
      }

      checking = true;
      const controller = new AbortController();
      activeController = controller;
      try {
        await checkForPublishedRelease({ signal: controller.signal, canReload });
      } finally {
        if (activeController === controller) activeController = null;
        checking = false;
      }
    };

    void runCheck();

    const intervalId = window.setInterval(() => {
      void runCheck();
    }, TIMING.RELEASE_POLL_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runCheck();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      activeController?.abort();
      activeController = null;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);
}

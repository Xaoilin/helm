import { useEffect } from 'react';
import { TIMING } from '../config/constants';
import { checkForPublishedRelease } from '../services/releaseRefresh';

type UseReleaseRefreshOptions = {
  enabled?: boolean;
};

export function useReleaseRefresh({
  enabled = import.meta.env.MODE !== 'test',
}: UseReleaseRefreshOptions = {}): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let disposed = false;
    let checking = false;

    const runCheck = async () => {
      if (disposed || checking || document.visibilityState === 'hidden') {
        return;
      }

      checking = true;
      try {
        await checkForPublishedRelease();
      } finally {
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
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);
}

/**
 * The banking review, a private dated snapshot kept by the finance service (one per account) and separate
 * from manual accounts. The app only reads it; agents replace it through the Finance MCP. A failed reload
 * keeps the last confirmed review on screen and says it may be out of date.
 */
import { useCallback, useState } from 'react';
import type { FinanceReview } from '../../types/domain';
import { getReview, isFinanceServiceEnabled } from '../../services/backend/financeServiceApi';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';

export interface FinanceReviewState {
  review: FinanceReview | null;
  loaded: boolean;
  error: string | null;
  /** The shown review is the last confirmed one and may be out of date. */
  stale: boolean;
  refresh: () => Promise<void>;
}

export function useFinanceReview(): FinanceReviewState {
  const [review, setReview] = useState<FinanceReview | null>(null);
  const load = useCallback(async () => setReview(await getReview()), []);
  const { loaded, error, reload } = useServiceLoad('Banking review', isFinanceServiceEnabled(), load,
    LIVE_DOMAINS.finance);
  return { review, loaded, error, stale: Boolean(error) && review !== null, refresh: reload };
}

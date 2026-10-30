/**
 * The banking review, a private dated snapshot kept by the finance service (one per account) and separate
 * from manual accounts. The app reads it and saves narrow scenario-profile commands; agents use Finance MCP. A failed reload
 * keeps the last confirmed review on screen and says it may be out of date.
 */
import { useCallback, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { FinanceReview } from '../../types/domain';
import { changeLoanProfile, getReview, isFinanceServiceEnabled, type LoanProfileChange } from '../../services/backend/financeServiceApi';
import { loanProfileSchema } from '../../services/backend/financeContracts';
import { useSyncAvailability } from '../SyncAvailabilityContext';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { errorMessage, useServiceLoad } from './useServiceLoad';

interface ProfileAttempt {
  signature: string;
  requestId: string;
  expectedUpdatedAt: string;
}

export interface FinanceReviewState {
  review: FinanceReview | null;
  loaded: boolean;
  error: string | null;
  /** The shown review is the last confirmed one and may be out of date. */
  stale: boolean;
  refresh: () => Promise<void>;
  savingProfile: boolean;
  profilesWritable: boolean;
  changeProfile: (change: LoanProfileChange) => Promise<void>;
}

export function useFinanceReview(): FinanceReviewState {
  const [review, setReview] = useState<FinanceReview | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<ProfileAttempt | null>(null);
  const { readOnly } = useSyncAvailability();
  const load = useCallback(async () => setReview(await getReview()), []);
  const { loaded, error, reload } = useServiceLoad('Banking review', isFinanceServiceEnabled(), load,
    LIVE_DOMAINS.finance);
  const changeProfile = useCallback(async (change: LoanProfileChange) => {
    if (inFlight.current) throw new Error('A profile change is already saving.');
    if (!review || !loaded || error || readOnly) throw new Error('Connect to Finance and reload the review before saving a profile.');
    const signature = JSON.stringify(change);
    const attempt = retry.current?.signature === signature ? retry.current
      : { signature, requestId: uuid(), expectedUpdatedAt: review.updatedAt };
    retry.current = attempt;
    inFlight.current = true;
    setSavingProfile(true);
    try {
      const confirmed = await changeLoanProfile(change, attempt.expectedUpdatedAt, attempt.requestId);
      const saved = confirmed.loanProfiles?.find(profile => profile.id === (change.operation === 'save' ? change.profile.id : change.profileId));
      if (change.operation === 'save' ? !saved || JSON.stringify(saved) !== JSON.stringify(loanProfileSchema.parse(change.profile)) : saved) {
        throw new Error('Finance did not confirm the profile change. Reload and try again.');
      }
      setReview(current => current && Date.parse(current.updatedAt) > Date.parse(confirmed.updatedAt) ? current : confirmed);
      retry.current = null;
      setWriteError(null);
    } catch (failure) {
      setWriteError(errorMessage(failure));
      // A version conflict needs a fresh attempt; unknown transport outcomes retain the exact command.
      if (failure instanceof Error && 'status' in failure && failure.status === 409) retry.current = null;
      void reload();
      throw failure;
    } finally {
      inFlight.current = false;
      setSavingProfile(false);
    }
  }, [review, loaded, error, readOnly, reload]);
  return {
    review, loaded, error: writeError ?? error, stale: Boolean(error) && review !== null, refresh: reload,
    savingProfile, profilesWritable: isFinanceServiceEnabled() && loaded && !error && !readOnly && review !== null,
    changeProfile,
  };
}

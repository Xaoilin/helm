import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FinanceReview } from '../../types/domain';
import { getSyncSessionSnapshot, loadStore, subscribeSyncSession } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

const sessionIdentity = () => {
  const session = getSyncSessionSnapshot();
  return JSON.stringify([session.userId, session.status, session.hasUsableSnapshot]);
};

/** The imported review is a private, read-only snapshot, separate from manual accounts. */
export function useFinanceReview() {
  const sessionKey = useSyncExternalStore(subscribeSyncSession, sessionIdentity);
  const [userId, status, hasUsableSnapshot] = JSON.parse(sessionKey) as [string | null, string, boolean];
  const [state, setState] = useState<{ owner: string; review: FinanceReview | null; error: string | null } | null>(null);
  const generation = useRef(0);
  const readable = Boolean(userId) && (status === 'ready' || (status === 'reconnecting' && hasUsableSnapshot));

  const refresh = useCallback(async () => {
    const session = getSyncSessionSnapshot();
    const requestedSession = sessionIdentity();
    const request = ++generation.current;
    if (!session.userId || (session.status !== 'ready'
      && !(session.status === 'reconnecting' && session.hasUsableSnapshot))) return;
    const owner = session.userId;
    try {
      const reviews = await loadStore<FinanceReview[]>('financeReviews');
      if (sessionIdentity() !== requestedSession || generation.current !== request) return;
      setState({ owner, review: reviews?.find(review => review.id === 'current') ?? null, error: null });
    } catch (failure) {
      if (sessionIdentity() !== requestedSession || generation.current !== request) return;
      const message = failure instanceof Error ? failure.message
        : failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : String(failure);
      setState(previous => ({ owner, review: previous?.owner === owner ? previous.review : null, error: message }));
    }
  }, []);

  useEffect(() => {
    setState(previous => readable && previous?.owner === userId ? previous : null);
    void refresh();
    return () => { generation.current += 1; };
  }, [sessionKey, userId, readable, refresh]);
  useRemoteStoreRefresh(['financeReviews'], refresh);

  const current = readable && state?.owner === userId ? state : null;
  return {
    review: current?.review ?? null,
    loaded: !readable || current !== null,
    error: !readable ? 'Reconnect your signed-in account to view the banking review.' : current?.error ?? null,
    stale: readable && (status !== 'ready' || Boolean(current?.error)),
    refresh,
  };
}

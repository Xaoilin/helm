import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { v4 as uuid } from 'uuid';
import type { EquityPosition, EquityPositionDraft } from '../../types/domain';
import { createEquityPosition, updateEquityPosition, deleteEquityPosition } from '../../services/equityAccount';
import { getSyncSessionSnapshot, loadStore, refreshDatabasePersistence, subscribeSyncSession } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

const errorMessage = (error: unknown) => error instanceof Error ? error.message
  : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

export function useEquityPositions() {
  // Persistence returns a fresh snapshot object; expose a stable primitive to React.
  const sessionKey = useSyncExternalStore(subscribeSyncSession, () => {
    const current = getSyncSessionSnapshot();
    return JSON.stringify([current.userId, current.status, current.readOnly]);
  });
  const [userId, status, readOnly] = JSON.parse(sessionKey) as [string | null, string, boolean];
  const session = { userId, status, readOnly };
  const [state, setState] = useState<{ owner: string | null; positions: EquityPosition[] }>({ owner: null, positions: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const retry = useRef<{ key: string; requestId: string; positionId: string } | null>(null);
  const writable = session.status === 'ready' && !session.readOnly && Boolean(session.userId);

  const refresh = useCallback(async (throwOnError = false) => {
    const userId = getSyncSessionSnapshot().userId;
    const request = ++generation.current;
    try {
      const positions = await loadStore<EquityPosition[]>('equityPositions');
      if (getSyncSessionSnapshot().userId !== userId || request !== generation.current) return;
      setState({ owner: userId, positions: positions ?? [] });
      setError(null);
    } catch (failure) {
      if (getSyncSessionSnapshot().userId !== userId || request !== generation.current) return;
      setState({ owner: userId, positions: [] });
      setError(errorMessage(failure));
      if (throwOnError) throw failure;
    } finally {
      if (getSyncSessionSnapshot().userId === userId && request === generation.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [session.userId, session.status, refresh]);
  useRemoteStoreRefresh(['equityPositions'], refresh);

  const mutate = async (operation: () => Promise<unknown>) => {
    const userId = getSyncSessionSnapshot().userId;
    const requireAccount = () => {
      const current = getSyncSessionSnapshot();
      if (!userId || current.userId !== userId || current.status !== 'ready' || current.readOnly) {
        throw new Error('A writable signed-in account is required. Reopen Finance after reconnecting.');
      }
    };
    if (inFlight.current) throw new Error('An equity change is already saving.');
    requireAccount();
    inFlight.current = true;
    setSaving(true);
    try {
      await operation();
      requireAccount();
      await refreshDatabasePersistence();
      requireAccount();
      await refresh(true);
    } catch (failure) {
      if (getSyncSessionSnapshot().userId === userId) setError(errorMessage(failure));
      throw failure;
    } finally { inFlight.current = false; setSaving(false); }
  };

  const save = async (draft: EquityPositionDraft, existing?: EquityPosition) => {
    const key = JSON.stringify([session.userId, existing?.id, existing?.updatedAt, draft]);
    if (retry.current?.key !== key) retry.current = { key, requestId: uuid(), positionId: existing?.id ?? uuid() };
    const attempt = retry.current;
    await mutate(() => existing
      ? updateEquityPosition(attempt.requestId, existing.id, draft, existing.updatedAt)
      : createEquityPosition(attempt.requestId, { ...draft, id: attempt.positionId }));
    retry.current = null;
  };
  const remove = async (position: EquityPosition) => {
    const key = JSON.stringify([session.userId, 'remove', position.id, position.updatedAt]);
    if (retry.current?.key !== key) retry.current = { key, requestId: uuid(), positionId: position.id };
    await mutate(() => deleteEquityPosition(retry.current!.requestId, position.id, position.updatedAt));
    retry.current = null;
  };
  return { positions: state.owner === session.userId && session.userId && session.status === 'ready' ? state.positions : [],
    loaded, error, saving, writable, save, remove, refresh };
}

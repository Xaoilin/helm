/**
 * Equity positions, kept by the finance service. A save is confirmed by the service before it shows. Edits
 * and removals carry the position's `updatedAt`, so a position changed elsewhere (another tab or an agent)
 * is refused instead of overwritten. A save whose result is unknown keeps its request ID and position ID,
 * so repeating the same change applies it once.
 */
import { useCallback, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { EquityPosition, EquityPositionDraft } from '../../types/domain';
import {
  createEquityPosition,
  deleteEquityPosition,
  loadEquityPositions,
  updateEquityPosition,
} from '../../services/equityAccount';
import { isFinanceServiceEnabled } from '../../services/backend/financeServiceApi';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { errorMessage, useServiceLoad } from './useServiceLoad';

/** One change being saved: a retry of the same change reuses its IDs. */
interface Attempt {
  key: string;
  requestId: string;
  positionId: string;
}

export interface EquityPositionsState {
  positions: EquityPosition[];
  loaded: boolean;
  error: string | null;
  saving: boolean;
  writable: boolean;
  /** The shown positions are the last confirmed ones and may be out of date. */
  stale: boolean;
  save: (draft: EquityPositionDraft, existing?: EquityPosition) => Promise<void>;
  remove: (position: EquityPosition) => Promise<void>;
  refresh: () => Promise<void>;
}

function attemptFor(previous: Attempt | null, key: string, positionId: () => string): Attempt {
  return previous?.key === key ? previous : { key, requestId: uuid(), positionId: positionId() };
}

export function useEquityPositions(): EquityPositionsState {
  const enabled = isFinanceServiceEnabled();
  const [positions, setPositions] = useState<EquityPosition[]>([]);
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<Attempt | null>(null);

  const load = useCallback(async () => setPositions(await loadEquityPositions()), []);
  const { loaded, error: loadError, reload } = useServiceLoad('Equity', enabled, load, LIVE_DOMAINS.equity);

  const mutate = useCallback(async (attempt: Attempt, operation: () => Promise<void>) => {
    if (inFlight.current) throw new Error('An equity change is already saving.');
    inFlight.current = true;
    setSaving(true);
    retry.current = attempt;
    try {
      await operation();
      retry.current = null;
      setWriteError(null);
    } catch (failure) {
      setWriteError(errorMessage(failure));
      void reload();
      throw failure;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [reload]);

  const save = useCallback(async (draft: EquityPositionDraft, existing?: EquityPosition) => {
    const key = JSON.stringify(['save', existing?.id, existing?.updatedAt, draft]);
    const attempt = attemptFor(retry.current, key, () => existing?.id ?? uuid());
    await mutate(attempt, async () => {
      const saved = existing
        ? await updateEquityPosition(attempt.requestId, existing.id, draft, existing.updatedAt)
        : await createEquityPosition(attempt.requestId, attempt.positionId, draft);
      setPositions(current => current.some(position => position.id === saved.id)
        ? current.map(position => (position.id === saved.id ? saved : position))
        : [...current, saved]);
    });
  }, [mutate]);

  const remove = useCallback(async (position: EquityPosition) => {
    const key = JSON.stringify(['remove', position.id, position.updatedAt]);
    const attempt = attemptFor(retry.current, key, () => position.id);
    await mutate(attempt, async () => {
      await deleteEquityPosition(attempt.requestId, position.id, position.updatedAt);
      setPositions(current => current.filter(candidate => candidate.id !== position.id));
    });
  }, [mutate]);

  const refresh = useCallback(async () => {
    setWriteError(null);
    await reload();
  }, [reload]);

  const error = writeError ?? loadError;
  return {
    positions,
    loaded,
    error,
    saving,
    writable: enabled && loaded && !loadError,
    stale: Boolean(loadError) && positions.length > 0,
    save,
    remove,
    refresh,
  };
}

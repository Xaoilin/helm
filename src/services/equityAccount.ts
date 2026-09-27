/**
 * Equity position reads and writes through the finance service, observed as `equity` operations. Each
 * write takes the caller's request ID as its Idempotency-Key, so retrying the same change applies it once.
 */
import type { EquityPosition, EquityPositionDraft } from '../types/domain';
import {
  deleteEquityPosition as deleteInService,
  getAllEquityPositions,
  saveEquityPosition,
} from './backend/financeServiceApi';
import { observeOperationalOperation } from './operationalTelemetry';

export function loadEquityPositions(): Promise<EquityPosition[]> {
  return observeOperationalOperation('equity', 'read', getAllEquityPositions);
}

export function createEquityPosition(requestId: string, positionId: string, position: EquityPositionDraft):
Promise<EquityPosition> {
  return observeOperationalOperation('equity', 'write', () => saveEquityPosition(positionId, position, null, requestId));
}

export function updateEquityPosition(requestId: string, positionId: string, position: EquityPositionDraft,
  expectedUpdatedAt: string): Promise<EquityPosition> {
  return observeOperationalOperation('equity', 'write',
    () => saveEquityPosition(positionId, position, expectedUpdatedAt, requestId));
}

export function deleteEquityPosition(requestId: string, positionId: string, expectedUpdatedAt: string): Promise<void> {
  return observeOperationalOperation('equity', 'write', () => deleteInService(positionId, expectedUpdatedAt, requestId));
}

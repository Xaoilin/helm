import { getClient } from '../store/supabase';
import type { EquityPosition, EquityPositionDraft } from '../types/domain';
import { observeOperationalOperation } from './operationalTelemetry';

interface EquityMutationReceipt {
  positionId: string;
  position: EquityPosition | null;
  accountVersion: number;
}

async function callEquityMutation(
  name: 'equity_add_position' | 'equity_update_position' | 'equity_remove_position',
  args: Record<string, unknown>,
): Promise<EquityMutationReceipt> {
  return observeOperationalOperation('equity', 'write', async () => {
    const client = getClient();
    if (!client) throw new Error('Stocks and options require a configured signed-in database connection.');
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    if (!data || typeof data.positionId !== 'string') {
      throw new Error('The database did not confirm the equity change.');
    }
    return data as EquityMutationReceipt;
  });
}

export function createEquityPosition(requestId: string, position: EquityPositionDraft & { id: string }) {
  return callEquityMutation('equity_add_position', { p_request_id: requestId, p_position: position });
}

export function updateEquityPosition(requestId: string, positionId: string, position: EquityPositionDraft, expectedUpdatedAt: string) {
  return callEquityMutation('equity_update_position', {
    p_request_id: requestId, p_position_id: positionId, p_position: position, p_expected_updated_at: expectedUpdatedAt,
  });
}

export function deleteEquityPosition(requestId: string, positionId: string, expectedUpdatedAt: string) {
  return callEquityMutation('equity_remove_position', {
    p_request_id: requestId, p_position_id: positionId, p_confirm: true, p_expected_updated_at: expectedUpdatedAt,
  });
}

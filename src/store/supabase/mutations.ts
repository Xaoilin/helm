/** Semantic mutation RPCs; every write is confirmed by the database. */
import { logError } from '../../services/logger';
import type { HelmMutation, HelmMutationResult } from '../databaseTypes';
import { requireClient } from './client';
import { asRecord } from './json';
import { mapRecord } from './records';

function mapMutationResult(value: unknown, requestId: string): HelmMutationResult {
  const record = asRecord(value);
  const changes = Array.isArray(record.changes)
    ? record.changes.map(change => {
        const row = asRecord(change);
        return mapRecord({
          user_id: String(row.userId || ''),
          collection: String(row.collection || ''),
          record_id: String(row.recordId || ''),
          payload: row.payload,
          position: typeof row.position === 'number' ? row.position : null,
          revision: Number(row.revision || 0),
          account_version: Number(row.accountVersion || 0),
          created_at: String(row.createdAt || ''),
          updated_at: String(row.updatedAt || ''),
          deleted_at: typeof row.deletedAt === 'string' ? row.deletedAt : null,
        });
      })
    : [];
  return {
    requestId: typeof record.requestId === 'string' ? record.requestId : requestId,
    accountVersion: Number(record.accountVersion || 0),
    changes,
  };
}

export async function applyHelmMutations(
  requestId: string,
  operations: HelmMutation[],
): Promise<HelmMutationResult> {
  if (operations.length === 0) {
    throw new Error('At least one Sabah One mutation is required.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('apply_helm_mutations', {
    p_request_id: requestId,
    p_operations: operations,
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  return mapMutationResult(data, requestId);
}

export async function applyHelmInventoryMutations(
  requestId: string,
  operations: HelmMutation[],
): Promise<HelmMutationResult> {
  if (operations.length === 0) {
    throw new Error('At least one Sabah One Inventory mutation is required.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('apply_helm_inventory_mutations', {
    p_request_id: requestId,
    p_operations: operations,
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  return mapMutationResult(data, requestId);
}

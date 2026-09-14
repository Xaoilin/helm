import { getClient } from '../store/supabase';
import type { EmploymentHistoryEntry } from '../types/domain';
import type { EmploymentApplicationDraft } from './employmentTracker';

export type EmploymentApplicationPatch = {
  [Key in keyof EmploymentApplicationDraft]?: EmploymentApplicationDraft[Key] | null;
};

interface EmploymentMutationReceipt {
  applicationId: string;
}

async function callEmploymentMutation(
  name: 'employment_add_application' | 'employment_update_application' | 'employment_add_history' | 'employment_remove_application',
  args: Record<string, unknown>,
): Promise<EmploymentMutationReceipt> {
  const client = getClient();
  if (!client) throw new Error('Employment requires a configured signed-in database connection.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  if (!data || typeof data.applicationId !== 'string') {
    throw new Error('The database did not confirm the Employment change.');
  }
  return data as EmploymentMutationReceipt;
}

export function createEmploymentApplication(
  requestId: string,
  application: EmploymentApplicationDraft & { id: string },
) {
  return callEmploymentMutation('employment_add_application', {
    p_request_id: requestId,
    p_application: application,
  });
}

export function updateEmploymentApplication(
  requestId: string,
  applicationId: string,
  patch: EmploymentApplicationPatch,
  expectedUpdatedAt: string,
) {
  return callEmploymentMutation('employment_update_application', {
    p_request_id: requestId,
    p_application_id: applicationId,
    p_patch: patch,
    p_expected_updated_at: expectedUpdatedAt,
  });
}

export function appendEmploymentHistory(
  requestId: string,
  applicationId: string,
  history: EmploymentHistoryEntry,
) {
  return callEmploymentMutation('employment_add_history', {
    p_request_id: requestId,
    p_application_id: applicationId,
    p_history: history,
  });
}

export function deleteEmploymentApplication(
  requestId: string,
  applicationId: string,
  expectedUpdatedAt: string,
) {
  return callEmploymentMutation('employment_remove_application', {
    p_request_id: requestId,
    p_application_id: applicationId,
    p_confirm: true,
    p_expected_updated_at: expectedUpdatedAt,
  });
}

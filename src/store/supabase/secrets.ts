/**
 * Account-owned Vault secret operations. Values are revealed one at a time and
 * never cached here.
 */
import type { HelmSecretDetail, HelmSecretSummary, SaveHelmSecretInput, SecretKind } from '../../types/domain';
import { requireClient } from './client';
import { asRecord } from './json';

const SECRET_KINDS = new Set<SecretKind>([
  'password',
  'api_key',
  'access_token',
  'database',
  'private_key',
  'webhook',
  'other',
]);

function mapSecretSummary(value: unknown): HelmSecretSummary {
  const row = asRecord(value);
  const kind = String(row.kind || 'other');
  return {
    secretId: String(row.secretId || ''),
    label: String(row.label || ''),
    kind: SECRET_KINDS.has(kind as SecretKind) ? kind as SecretKind : 'other',
    environment: typeof row.environment === 'string' ? row.environment : null,
    projectCatalogKeys: Array.isArray(row.projectCatalogKeys)
      ? row.projectCatalogKeys.filter((entry): entry is string => typeof entry === 'string')
      : [],
    sourceRef: typeof row.sourceRef === 'string' ? row.sourceRef : null,
    revision: Number(row.revision || 0),
    accountVersion: Number(row.accountVersion || 0),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : null,
  };
}

export async function listHelmSecrets(): Promise<{
  accountVersion: number;
  secrets: HelmSecretSummary[];
}> {
  const database = requireClient();
  const { data, error } = await database.rpc('list_helm_secrets');
  if (error) throw error;
  const result = asRecord(data);
  return {
    accountVersion: Number(result.accountVersion || 0),
    secrets: Array.isArray(result.secrets)
      ? result.secrets.map(mapSecretSummary).filter(secret => secret.secretId && secret.label)
      : [],
  };
}

export async function revealHelmSecret(secretId: string): Promise<HelmSecretDetail> {
  const database = requireClient();
  const { data, error } = await database.rpc('reveal_helm_secret', {
    p_secret_id: secretId,
  });
  if (error) throw error;
  const result = asRecord(data);
  if (typeof result.secretId !== 'string' || typeof result.value !== 'string') {
    throw new Error('The Sabah One secret response was invalid.');
  }
  return {
    secretId: result.secretId,
    value: result.value,
    username: typeof result.username === 'string' ? result.username : null,
    url: typeof result.url === 'string' ? result.url : null,
    notes: typeof result.notes === 'string' ? result.notes : null,
  };
}

export async function saveHelmSecret(
  requestId: string,
  input: SaveHelmSecretInput,
): Promise<HelmSecretSummary> {
  const database = requireClient();
  const { data, error } = await database.rpc('save_helm_secret', {
    p_request_id: requestId,
    p_secret_id: input.secretId ?? null,
    p_label: input.label,
    p_kind: input.kind,
    p_environment: input.environment || null,
    p_project_catalog_keys: [...new Set(input.projectCatalogKeys)],
    p_value: input.value || null,
    p_username: input.username || null,
    p_url: input.url || null,
    p_notes: input.notes || null,
    p_source_ref: input.sourceRef || null,
  });
  if (error) throw error;
  const result = mapSecretSummary(data);
  if (!result.secretId || !result.label) throw new Error('The Sabah One secret response was invalid.');
  return result;
}

export async function setHelmSecretArchived(
  requestId: string,
  secretId: string,
  archived: boolean,
): Promise<HelmSecretSummary> {
  const database = requireClient();
  const { data, error } = await database.rpc('set_helm_secret_archived', {
    p_request_id: requestId,
    p_secret_id: secretId,
    p_archived: archived,
  });
  if (error) throw error;
  const result = mapSecretSummary(data);
  if (!result.secretId || !result.label) throw new Error('The Sabah One secret response was invalid.');
  return result;
}

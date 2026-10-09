import { VOICE_PROVIDER_NAMES, type VoiceServerDependencies } from './handler.ts';

interface VoiceVaultClient {
  auth: { getUser: (token: string) => Promise<{ data: { user: unknown }; error: unknown }> };
  rpc: (name: string, parameters?: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }>;
}
const API_KEY_KIND = 'api_key';

/** Reuses the signed-in account's existing first-party Vault boundary. */
export async function authorizeVoiceAccount(request: Request, createClient: (token: string) => VoiceVaultClient): ReturnType<VoiceServerDependencies['authorize']> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) return null;
  const client = createClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { readKey: async (secretId, provider) => {
    // These RPCs reject OAuth agent tokens and bind every read to auth.uid().
    const summaries = await client.rpc('list_helm_secrets');
    const catalogue = summaries.data as { secrets?: unknown[] } | null;
    if (summaries.error || !Array.isArray(catalogue?.secrets)) return null;
    const entry = catalogue.secrets.find(value => {
      const secret = value as { secretId?: string; label?: string; kind?: string; archivedAt?: string } | null;
      return secret?.secretId === secretId && secret.kind === API_KEY_KIND && !secret.archivedAt
        && typeof secret.label === 'string' && VOICE_PROVIDER_NAMES[provider].test(secret.label);
    });
    if (!entry) return null;
    const revealed = await client.rpc('reveal_helm_secret', { p_secret_id: secretId });
    const secret = revealed.data as { value?: unknown } | null;
    return !revealed.error && typeof secret?.value === 'string' ? secret.value : null;
  } };
}

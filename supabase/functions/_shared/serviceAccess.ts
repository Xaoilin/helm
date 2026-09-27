// One cheap read decides whether an agent may use a Sabah One service right now. The service checks the
// agent's own OAuth token and its approval for that part of Sabah One on every request: it refuses an
// unapproved agent with 403 agent_not_approved and an invalid token with 401.

const PROBE_TIMEOUT_MS = 15_000;

export type ServiceAccess = 'approved' | 'not_approved' | 'invalid_token' | 'unavailable';

export async function probeServiceAccess(url: URL, token: string): Promise<ServiceAccess> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return 'unavailable';
  }
  await response.body?.cancel();
  if (response.ok) return 'approved';
  if (response.status === 403) return 'not_approved';
  if (response.status === 401) return 'invalid_token';
  return 'unavailable';
}

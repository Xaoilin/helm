export async function verifyOperationalUser(token: string, options: { url: string; key: string; fetcher?: typeof fetch }): Promise<string | null> {
  if (!options.url || !options.key) throw new Error('configuration');
  const response = await (options.fetcher ?? fetch)(`${options.url}/auth/v1/user`, {
    headers: { apikey: options.key, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3_000), redirect: 'error',
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('auth_unavailable');
  const user = await response.json();
  if (!user || typeof user.id !== 'string' || user.role !== 'authenticated' || user.is_anonymous === true) return null;
  // Claims are considered only after server verification, never as authentication.
  try {
    const encoded = token.split('.')[1].replace(/-/gu, '+').replace(/_/gu, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (claims.client_id) return null;
  } catch { return null; }
  return user.id;
}

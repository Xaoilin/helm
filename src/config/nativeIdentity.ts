/** Build-managed native identity endpoints remain independent from Lina One. */
export function independentEndpoint(value: string | undefined): string {
  const endpoint = value?.trim() || '';
  if (!endpoint) return '';
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || ['api.lina.xaoilin.com', 'upojxgbvbwlarmvldnfx.supabase.co'].includes(url.hostname)) {
    throw new Error('Sabah One requires its own HTTP(S) identity endpoint without embedded credentials.');
  }
  return endpoint;
}

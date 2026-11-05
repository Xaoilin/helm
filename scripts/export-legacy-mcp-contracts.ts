/**
 * TEMPORARY migration oracle: export tool discovery from the existing Edge handlers using only
 * synthetic identity and approval responses. Remove after native MCP parity and Supabase retirement.
 * Runtime network access is not granted; every unexpected fetch fails before it can leave the process.
 */
const fixtureAuth = 'https://migration-fixture.supabase.test';
const fixtureBackend = 'https://migration-fixture.backend.test';
const userId = '10000000-0000-4000-8000-000000000001';
Deno.env.set('SUPABASE_URL', fixtureAuth);
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-only');
Deno.env.set('SABAH_ONE_LIFE_API_URL', fixtureBackend);
Deno.env.set('SABAH_ONE_FINANCE_API_URL', fixtureBackend);

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === fixtureAuth && url.pathname === '/auth/v1/user') {
    return Response.json({ id: userId, aud: 'authenticated', role: 'authenticated' });
  }
  if (url.origin === fixtureBackend && request.method === 'GET' && url.pathname.endsWith('/access')) {
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected migration fixture fetch: ${request.method} ${url.origin}${url.pathname}`);
};

for (const domain of ['finance', 'equity', 'inventory', 'employment']) {
  const handlerUrl = new URL(`../supabase/functions/sabah-one-${domain}-mcp/handler.ts`, import.meta.url);
  const { handleRequest } = await import(handlerUrl.href);
  const claims = { sub: userId, client_id: 'synthetic-client', exp: Math.floor(Date.now() / 1000) + 3600, scope: 'openid' };
  const encoded = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const response = await handleRequest(new Request(`${fixtureAuth}/functions/v1/sabah-one-${domain}-mcp/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer header.${encoded}.signature`,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }));
  if (!response.ok) throw new Error(`${domain} discovery failed: ${response.status}`);
  const raw = await response.text();
  const messages = response.headers.get('content-type')?.includes('text/event-stream')
    ? raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)))
    : [JSON.parse(raw)];
  const tools = messages.at(-1)?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) throw new Error(`${domain} returned no tool contract`);
  const contract = JSON.stringify(tools, null, 2) + '\n';
  for (const directory of ['../contracts/access-service/mcp/']) {
    const output = new URL(directory, import.meta.url);
    await Deno.mkdir(output, { recursive: true });
    await Deno.writeTextFile(new URL(`${domain}-tools.json`, output), contract);
  }
  console.log(`${domain}: ${tools.length} tool contracts exported with synthetic inputs`);
}

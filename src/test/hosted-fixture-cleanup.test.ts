import { createServer } from 'node:http';
import { once } from 'node:events';
import { AuthApiError, createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { cleanupHostedFixture, fixturePreferencesUrl } from '../../scripts/lib/hosted-fixture-cleanup';

function fixture() {
  const admin = createClient('https://fixture.supabase.co', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth.admin;
  const signOut = vi.spyOn(admin, 'signOut').mockResolvedValue({ data: null, error: null });
  const removeClient = vi.spyOn(admin.oauth, 'deleteClient').mockResolvedValue({ data: {}, error: null });
  const removeUser = vi.spyOn(admin, 'deleteUser').mockResolvedValue({ data: { user: null }, error: null });
  const readUser = vi.spyOn(admin, 'getUserById').mockResolvedValue({
    data: { user: null }, error: new AuthApiError('User not found', 404, 'user_not_found'),
  });
  let enabled = true;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    if (init?.method === 'PUT') enabled = false;
    return Response.json({ enabled, reminderEnabled: enabled, reminderMinutes: 15 });
  });
  const observe = vi.fn();
  const options = { admin, fixtureId: 'synthetic-user', directToken: 'synthetic-jwt',
    oauthClientId: 'synthetic-client', prayerBaseUrl: 'https://prayer.example.invalid', fetcher, observe };
  return { options, signOut, removeClient, removeUser, readUser, fetcher, observe };
}

describe('hosted synthetic fixture cleanup proof', () => {
  it('disables work, revokes and removes Auth, then independently reads both boundaries', async () => {
    const f = fixture();
    expect(await cleanupHostedFixture(f.options)).toEqual({ authRemoved: true, authAbsenceConfirmed: true,
      clientRemoved: true, serviceWorkStopped: true, confirmed: true });
    expect(f.fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(JSON.parse(String(f.fetcher.mock.calls[1][1]?.body))).toEqual({
      enabled: false, reminderEnabled: false, reminderMinutes: 15,
    });
    expect(f.fetcher.mock.calls[1][1]?.headers).toHaveProperty('Idempotency-Key');
    expect(f.signOut.mock.invocationCallOrder[0]).toBeLessThan(f.removeUser.mock.invocationCallOrder[0]);
    expect(f.removeUser.mock.invocationCallOrder[0]).toBeLessThan(f.readUser.mock.invocationCallOrder[0]);
    expect(f.readUser.mock.invocationCallOrder[0]).toBeLessThan(f.fetcher.mock.invocationCallOrder[2]);
  });

  it.each([401, 503, 202])('fails when post-delete service proof returns HTTP %s', async status => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async () => Response.json({ enabled: true, reminderEnabled: true, reminderMinutes: 15 }))
      .mockImplementationOnce(async () => Response.json({ enabled: false, reminderEnabled: false, reminderMinutes: 15 }))
      .mockImplementationOnce(async () => new Response(null, { status }));
    const receipt = await cleanupHostedFixture(f.options);
    expect(receipt.authRemoved).toBe(true);
    expect(receipt.authAbsenceConfirmed).toBe(true);
    expect(receipt.serviceWorkStopped).toBe(false);
    expect(receipt.confirmed).toBe(false);
  });

  it.each([
    { enabled: true, reminderEnabled: false, reminderMinutes: 15 },
    { enabled: false, reminderEnabled: true, reminderMinutes: 15 },
    { enabled: false },
  ])('rejects active or malformed retained profile proof: %j', async body => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(Response.json({ enabled: true, reminderEnabled: true, reminderMinutes: 15 }))
      .mockResolvedValueOnce(Response.json({ enabled: false, reminderEnabled: false, reminderMinutes: 15 }))
      .mockResolvedValueOnce(Response.json(body));
    expect((await cleanupHostedFixture(f.options)).confirmed).toBe(false);
  });

  it('does not accept Auth delete success when absence readback is unavailable', async () => {
    const f = fixture();
    f.readUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('private-response', 500) });
    const receipt = await cleanupHostedFixture(f.options);
    expect(receipt.authRemoved).toBe(true);
    expect(receipt.authAbsenceConfirmed).toBe(false);
    expect(receipt.confirmed).toBe(false);
  });

  it('still revokes and deletes the fixture if service cleanup fails, without leaking diagnostics', async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(new Error('private-token-and-response'));
    expect((await cleanupHostedFixture(f.options)).confirmed).toBe(false);
    expect(f.signOut).toHaveBeenCalledWith('synthetic-jwt', 'global');
    expect(f.removeClient).toHaveBeenCalledWith('synthetic-client');
    expect(f.removeUser).toHaveBeenCalledWith('synthetic-user');
    expect(f.readUser).toHaveBeenCalledWith('synthetic-user');
    expect(JSON.stringify(f.observe.mock.calls)).not.toContain('private-token-and-response');
  });

  it('still deletes Auth when session and OAuth client cleanup fail', async () => {
    const f = fixture();
    f.signOut.mockRejectedValue(new Error('session failure'));
    f.removeClient.mockRejectedValue(new Error('client failure'));
    expect((await cleanupHostedFixture(f.options)).confirmed).toBe(false);
    expect(f.removeUser).toHaveBeenCalledOnce();
    expect(f.readUser).toHaveBeenCalledOnce();
  });

  it('deletes Auth but fails proof when no fixture token was obtained', async () => {
    const f = fixture();
    expect((await cleanupHostedFixture({ ...f.options, directToken: undefined })).confirmed).toBe(false);
    expect(f.removeUser).toHaveBeenCalledOnce();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each(['https://prayer.example.invalid/sabah-one', 'https://prayer.example.invalid/sabah-one/'])('preserves the product API prefix %s', base => {
    expect(fixturePreferencesUrl(base)).toBe('https://prayer.example.invalid/sabah-one/api/prayer/v1/preferences');
  });

  it.each(['', 'http://prayer.example.invalid', 'https://user:secret@prayer.example.invalid',
    'https://prayer.example.invalid/?token=private', 'https://prayer.example.invalid/api'])('rejects unsafe or missing configured service origins: %s', value => {
    expect(() => fixturePreferencesUrl(value)).toThrow('configured HTTPS Prayer service origin');
  });

  it.each(['', '/sabah-one'])('exercises real HTTP and Auth SDK error decoding at prefix %s', async prefix => {
    let deleted = false;
    let enabled = true;
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.setHeader('Content-Type', 'application/json');
      if (request.url === `${prefix}/api/prayer/v1/preferences`) {
        if (request.method === 'PUT') {
          let raw = '';
          for await (const chunk of request) raw += chunk;
          enabled = JSON.parse(raw).enabled;
        }
        response.end(JSON.stringify({ enabled, reminderEnabled: enabled, reminderMinutes: 15 }));
      } else if (request.method === 'DELETE') {
        deleted = true;
        response.end('{}');
      } else if (request.method === 'GET' && deleted) {
        response.writeHead(404);
        response.end(JSON.stringify({ code: 'user_not_found', msg: 'User not found' }));
      } else response.end('{}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Synthetic server not listening');
    const origin = `http://127.0.0.1:${address.port}`;
    const admin = createClient(origin, 'synthetic-public-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).auth.admin;
    try {
      const receipt = await cleanupHostedFixture({ admin, fixtureId: '00000000-0000-4000-8000-000000000325', directToken: 'synthetic-jwt',
        prayerBaseUrl: `https://prayer.example.invalid${prefix}`, observe: () => {},
        fetcher: (input, init) => fetch(`${origin}${new URL(String(input)).pathname}`, init) });
      expect(receipt.confirmed).toBe(true);
      expect(requests).toEqual([`GET ${prefix}/api/prayer/v1/preferences`, `PUT ${prefix}/api/prayer/v1/preferences`,
        'POST /auth/v1/logout?scope=global', 'DELETE /auth/v1/admin/users/00000000-0000-4000-8000-000000000325',
        'GET /auth/v1/admin/users/00000000-0000-4000-8000-000000000325', `GET ${prefix}/api/prayer/v1/preferences`]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

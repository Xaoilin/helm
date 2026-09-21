import { describe, expect, it, vi } from 'vitest';
import { createOperationalHandler } from '../../supabase/functions/operational-events/handler';
import { verifyOperationalUser } from '../../supabase/functions/operational-events/auth';
import { parseOperationalBatch } from '../../supabase/functions/_shared/operationalEvents';
import type { OperationalEvent } from '../types/domain';

const event = (): OperationalEvent => ({ id: crypto.randomUUID(), correlationId: crypto.randomUUID(), occurredAt: new Date().toISOString(), release: '0.2.164', domain: 'realtime', operation: 'subscription', outcome: 'failed', reason: 'closed', attempt: 1, durationMs: 100, recoveryMs: null, freshness: 'stale' });
const request = (body: unknown, token = 'synthetic-token') => new Request('https://synthetic.test/operational-events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const token = (claims = {}) => `synthetic.${btoa(JSON.stringify(claims))}.signature`;

describe('first-party operational collector', () => {
  it('emits only the exact normalized envelope and rejects secret/payload fields', async () => {
    const emit = vi.fn();
    const handler = createOperationalHandler({ authenticate: async () => 'private-account-id', emit, now: Date.now, enabled: () => true });
    const safe = event();
    expect((await handler(request({ events: [safe] }))).status).toBe(200);
    expect(emit).toHaveBeenCalledWith(safe);
    expect((await handler(request({ events: [{ ...safe, message: 'secret=DO_NOT_LOG' }] }))).status).toBe(400);
    expect((await handler(request({ events: [{ ...safe, reason: 'secret=DO_NOT_LOG' }] }))).status).toBe(400);
    expect((await handler(request({ events: Array.from({ length: 11 }, event) }))).status).toBe(400);
    expect((await handler(request({ events: [safe], userId: 'private-account-id' }))).status).toBe(400);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/DO_NOT_LOG|private-account-id/);
  });
  it('bounds body, rate and disabled/auth-unavailable paths without logging', async () => {
    const emit = vi.fn();
    const handler = createOperationalHandler({ authenticate: async () => 'fixture', emit, now: Date.now, enabled: () => true });
    expect((await handler(request({ secret: 'x'.repeat(12001) }))).status).toBe(413);
    for (let i = 0; i < 5; i++) expect((await handler(request({ events: [event()] }))).status).toBe(200);
    expect((await handler(request({ events: [event()] }))).status).toBe(429);
    const denied = createOperationalHandler({ authenticate: async () => null, emit, now: Date.now, enabled: () => true });
    expect((await denied(request({ events: [event()] }))).status).toBe(401);
    const unavailable = createOperationalHandler({ authenticate: async () => { throw new Error('SECRET'); }, emit, now: Date.now, enabled: () => true });
    const response = await unavailable(request({ events: [event()] }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('SECRET');
    const disabled = createOperationalHandler({ authenticate: async () => 'fixture', emit, now: Date.now, enabled: () => false });
    expect((await disabled(request({ events: [event()] }))).status).toBe(503);
  });
  it('requires verified nonanonymous first-party identity; OAuth approval cannot broaden access', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'synthetic-id', role: 'authenticated', is_anonymous: false })));
    const options = { url: 'https://synthetic.test', key: 'public', fetcher };
    expect(await verifyOperationalUser(token(), options)).toBe('synthetic-id');
    expect(await verifyOperationalUser(token({ client_id: 'approved-other-domain-client' }), options)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    expect(await verifyOperationalUser(token(), options)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'fixture', role: 'authenticated', is_anonymous: true })));
    expect(await verifyOperationalUser(token(), options)).toBeNull();
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(verifyOperationalUser(token(), options)).rejects.toThrow('auth_unavailable');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('rejects old timestamps, nonfinite numbers, payload-shaped fields and non-v4 identifiers', () => {
    const safe = event();
    for (const patch of [{ occurredAt: '2000-01-01T00:00:00.000Z' }, { durationMs: Infinity }, { id: 'record-private-id' }, { reason: { toString: () => 'ok', secret: 'no' } }, { recoveryMs: -1 }]) {
      expect(parseOperationalBatch({ events: [{ ...safe, ...patch }] })).toBeNull();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyOperationalFailure, configureOperationalTransport, exportOperationalDiagnostics, flushOperationalEvents, flushOperationalEventsForReload, getOperationalSnapshot, observeOperationalOperation, recordOperationalEvent, setOperationalAccount } from '../services/operationalTelemetry';
import { parseOperationalBatch } from '../services/operationalEvents';

const failure = () => recordOperationalEvent({ domain: 'realtime', operation: 'subscription', outcome: 'failed', reason: 'closed' });

describe('bounded operational telemetry', () => {
  beforeEach(() => { vi.useFakeTimers(); configureOperationalTransport(null); setOperationalAccount(null); setOperationalAccount('synthetic-a'); });
  afterEach(() => { setOperationalAccount(null); configureOperationalTransport(null); vi.useRealTimers(); });
  it('correlates failure and recovery and excludes raw payloads from exports', async () => {
    failure();
    await vi.advanceTimersByTimeAsync(2500);
    failure();
    recordOperationalEvent({ domain: 'realtime', operation: 'subscription', outcome: 'ok', reason: 'subscribed', freshness: 'fresh' });
    const raw = new Error('network failed token=NEVER_EXPORT account=private@example.test');
    await expect(observeOperationalOperation('database', 'read', async () => { throw raw; })).rejects.toBe(raw);
    const snapshot = getOperationalSnapshot();
    expect(snapshot.events[2]).toMatchObject({ outcome: 'recovered', recoveryMs: 2500, correlationId: snapshot.events[0].correlationId });
    expect(snapshot.counters).toMatchObject({ disconnects: 1, failedReads: 1, recoveries: 1, lastRecoveryMs: 2500 });
    expect(exportOperationalDiagnostics()).not.toMatch(/NEVER_EXPORT|private@example|synthetic-a/);
    expect(parseOperationalBatch({ events: snapshot.events })).toEqual(snapshot.events);
  });
  it('bounds a hung sink, retries three times and leaves business work independent', async () => {
    const send = vi.fn(() => new Promise<void>(() => {}));
    configureOperationalTransport(send);
    failure();
    const flush = flushOperationalEvents();
    expect(await observeOperationalOperation('database', 'write', async () => 'confirmed')).toBe('confirmed');
    await vi.advanceTimersByTimeAsync(3000);
    await flush;
    expect(getOperationalSnapshot().sink).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(66_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(getOperationalSnapshot().dropped).toBeGreaterThan(0);
    expect(getOperationalSnapshot().pending).toBeLessThanOrEqual(1);
  });
  it('caps rate, queue, ring and retention, exposing dropped evidence', async () => {
    configureOperationalTransport(async () => {});
    for (let i = 0; i < 500; i++) failure();
    expect(getOperationalSnapshot()).toMatchObject({ pending: 50, dropped: 450 });
    expect(getOperationalSnapshot().events).toHaveLength(60);
    for (let minute = 0; minute < 4; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      for (let i = 0; i < 60; i++) failure();
    }
    expect(getOperationalSnapshot().events).toHaveLength(200);
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect(getOperationalSnapshot().events).toHaveLength(0);
  });
  it('drops old-account queued and in-flight completions without sending under a new identity', async () => {
    const send = vi.fn(async () => {});
    configureOperationalTransport(send);
    failure();
    const flush = flushOperationalEvents();
    setOperationalAccount('synthetic-b');
    await flush;
    expect(send).not.toHaveBeenCalled();
    expect(getOperationalSnapshot().events).toEqual([]);
    let complete!: () => void;
    const work = observeOperationalOperation('database', 'read', () => new Promise<void>(resolve => { complete = resolve; }));
    setOperationalAccount('synthetic-c');
    complete();
    await work;
    expect(getOperationalSnapshot().events).toEqual([]);
  });
  it.each([400, 401, 403, 422])('does not retry permanent sink HTTP %s', async status => {
    const send = vi.fn(async () => { throw Object.assign(new Error('not retained'), { status }); });
    configureOperationalTransport(send);
    failure();
    await flushOperationalEvents();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getOperationalSnapshot()).toMatchObject({ pending: 0, dropped: 1, sink: 'unavailable' });
  });
  it('never labels an unrelated concurrent read as recovery', async () => {
    let finish!: () => void;
    const success = observeOperationalOperation('database', 'read', () => new Promise<void>(resolve => { finish = resolve; }));
    await expect(observeOperationalOperation('database', 'read', async () => { throw new TypeError('network'); })).rejects.toThrow();
    finish();
    await success;
    const snapshot = getOperationalSnapshot();
    expect(snapshot.events.map(event => event.outcome)).toEqual(['failed', 'ok']);
    expect(new Set(snapshot.events.map(event => event.correlationId)).size).toBe(2);
    expect(snapshot.counters.recoveries).toBe(0);
  });
  it('starts a bounded latest-event batch before reload without awaiting a failed or hung sink', async () => {
    const send = vi.fn(() => new Promise<void>(() => {}));
    configureOperationalTransport(send);
    recordOperationalEvent({ domain: 'release', operation: 'reload', outcome: 'changed', reason: 'release_available' });
    expect(flushOperationalEventsForReload()).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0][0]).toMatchObject({ domain: 'release', operation: 'reload', reason: 'release_available' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(send.mock.calls[0][1].aborted).toBe(true);
  });
  it.each([
    [{ status: 401 }, 'unauthorized'], [{ status: 403 }, 'forbidden'], [{ status: 503 }, 'server_error'],
    [{ name: 'TimeoutError' }, 'timeout'], [{ status: 429 }, 'rate_limited'],
    [new TypeError('Failed to fetch SECRET'), 'network'],
  ])('normalizes failure without retaining its contents', (error, reason) => {
    expect(classifyOperationalFailure(error)).toBe(reason);
  });
});

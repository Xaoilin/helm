import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.resetModules(); });
it('keeps a public release failure through the first HTTP session bootstrap, then clears it between accounts', async () => {
  vi.resetModules(); vi.useFakeTimers();
  const telemetry = await import('../services/operationalTelemetry');
  telemetry.recordOperationalEvent({ domain: 'release', operation: 'manifest', outcome: 'failed', reason: 'server_error' });
  telemetry.setOperationalAccount('first-synthetic-account');
  await vi.advanceTimersByTimeAsync(1000);
  telemetry.recordOperationalEvent({ domain: 'release', operation: 'manifest', outcome: 'ok', reason: 'ok' });
  expect(telemetry.getOperationalSnapshot().events.at(-1)).toMatchObject({ outcome: 'recovered', recoveryMs: 1000 });
  telemetry.setOperationalAccount('second-synthetic-account');
  expect(telemetry.getOperationalSnapshot().events).toEqual([]);
  telemetry.recordOperationalEvent({ domain: 'release', operation: 'manifest', outcome: 'ok', reason: 'ok' });
  expect(telemetry.getOperationalSnapshot().events.at(-1)?.outcome).toBe('ok');
});

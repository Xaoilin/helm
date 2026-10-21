import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('web-vitals', () => ({ onCLS: vi.fn(), onFCP: vi.fn(), onINP: vi.fn(), onLCP: vi.fn(), onTTFB: vi.fn() }));
import { recordWebMeasurement, startBrowserObservability } from '../services/browserObservability';
import { configureOperationalTransport, getOperationalSnapshot, setOperationalAccount } from '../services/operationalTelemetry';

afterEach(() => { setOperationalAccount(null); configureOperationalTransport(null); });
describe('browser health metadata', () => {
  it('reports global failures without retaining messages, URLs or rejected values', () => {
    setOperationalAccount('test');
    const stop = startBrowserObservability();
    window.dispatchEvent(new ErrorEvent('error', { message: 'SECRET', filename: 'https://private.test/account' }));
    window.dispatchEvent(new Event('unhandledrejection'));
    recordWebMeasurement('cls', 0.15);
    recordWebMeasurement('lcp', Number.NaN);
    stop();
    const snapshot = getOperationalSnapshot();
    expect(snapshot.events.map(event => event.operation)).toEqual(['exception', 'unhandled_rejection', 'cls']);
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|private.test/);
  });
});

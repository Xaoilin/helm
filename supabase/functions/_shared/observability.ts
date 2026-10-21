/** Bounded operational metadata only. Account data, headers, URLs and error messages never enter it. */
type Handler = (request: Request) => Response | Promise<Response>;
type Diagnostic = { at: number; status: string; durationMs: number; dropped?: number };
type BackgroundRuntime = { waitUntil: (work: Promise<unknown>) => void };
const LIMIT = 50;
const TIMEOUT_MS = 2000;

export function observeEdgeHandler(service: string, handler: Handler, options: {
  endpoint?: string; authorization?: string; fetcher?: typeof fetch;
  background?: (work: Promise<unknown>) => void;
} = {}): (request: Request) => Promise<Response> {
  const endpoint = options.endpoint ?? Deno.env.get('SABAH_OBSERVABILITY_OTLP_ENDPOINT');
  const authorization = options.authorization ?? Deno.env.get('SABAH_OBSERVABILITY_OTLP_AUTHORIZATION');
  const fetcher = options.fetcher ?? fetch;
  const background = options.background ?? ((work: Promise<unknown>) => {
    const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: BackgroundRuntime }).EdgeRuntime;
    runtime?.waitUntil(work);
  });
  const queue: Diagnostic[] = [];
  let pending = false;
  let dropped = 0;
  let windowStart = Date.now();
  let successes = 0;
  let failures = 0;

  async function flush(): Promise<void> {
    let batchLength = 0;
    try {
      // One batch for concurrent requests; it runs after the response through EdgeRuntime.waitUntil.
      await new Promise(resolve => setTimeout(resolve, 250));
      const batch = queue.splice(0, LIMIT);
      batchLength = batch.length;
      if (dropped && batch.length) { batch[0].dropped = dropped; dropped = 0; }
      const body = { resourceLogs: [{ resource: { attributes: [
        { key: 'service.name', value: { stringValue: service } },
        { key: 'deployment.environment.name', value: { stringValue: 'production' } },
      ] }, scopeLogs: [{ scope: { name: 'sabah.edge' }, logRecords: batch.map(event => ({
        timeUnixNano: String(event.at * 1_000_000),
        severityNumber: event.status === 'exception' || event.status === '5xx' ? 17 : 9,
        body: { stringValue: JSON.stringify({ message: 'Edge request', status: event.status,
          duration_ms: event.durationMs, dropped: event.dropped ?? 0 }) },
      })) }] }] };
      const response = await fetcher(`${endpoint}/v1/logs`, { method: 'POST',
        headers: { Authorization: authorization!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      await response.body?.cancel();
      if (!response.ok) dropped = Math.min(1_000_000, dropped + batch.length);
    } catch { dropped = Math.min(1_000_000, dropped + batchLength); }
    finally {
      pending = false;
      if (queue.length) { pending = true; background(flush()); }
    }
  }

  function record(status: string, started: number): void {
    if (!endpoint || !authorization) return;
    const now = Date.now();
    if (now - windowStart >= 60_000 || now < windowStart) { windowStart = now; successes = 0; failures = 0; }
    const failed = status === 'exception' || status === '5xx';
    if (failed ? ++failures > 60 : ++successes > 30) {
      dropped = Math.min(1_000_000, dropped + 1); return;
    }
    if (queue.length >= LIMIT) {
      const normal = queue.findIndex(event => event.status !== 'exception' && event.status !== '5xx');
      if (!failed || normal < 0) { dropped = Math.min(1_000_000, dropped + 1); return; }
      queue.splice(normal, 1);
      dropped = Math.min(1_000_000, dropped + 1);
    }
    queue.push({ at: now, status, durationMs: Math.min(86_400_000, Math.max(0, Math.round(performance.now() - started))) });
    if (!pending) { pending = true; background(flush()); }
  }

  return async request => {
    const started = performance.now();
    try {
      const response = await handler(request);
      try { record(`${Math.floor(response.status / 100)}xx`, started); } catch { /* Diagnostic failures never change product responses. */ }
      return response;
    } catch (error) {
      try { record('exception', started); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  };
}

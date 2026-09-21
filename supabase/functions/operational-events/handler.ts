import { ASSISTANT_DEPLOY_SHA } from '../_shared/assistantDeployment.ts';
import { OPERATIONAL_MAX_BYTES, parseOperationalBatch } from '../_shared/operationalEvents.ts';
import type { OperationalEvent } from '../../../src/types/domain.ts';

interface CollectorDependencies {
  authenticate: (token: string) => Promise<string | null>;
  emit: (event: OperationalEvent) => void;
  now: () => number;
  enabled: () => boolean;
}
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function readBoundedBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > OPERATIONAL_MAX_BYTES) throw new Error('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 2_000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > OPERATIONAL_MAX_BYTES) throw new Error('too_large');
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(deadline);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (timedOut) throw new Error('body_timeout');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Per-isolate bounds complement the browser budget. This is not a global quota. */
export function createOperationalHandler(dependencies: CollectorDependencies) {
  const buckets = new Map<string, { count: number; start: number }>();
  let globalStart = 0;
  let globalCount = 0;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return reply({ ok: true, releaseSha: ASSISTANT_DEPLOY_SHA, schemaVersion: 1, enabled: dependencies.enabled() });
    if (request.method !== 'POST') return reply({ code: 'method_not_allowed' }, 405);
    if (!dependencies.enabled()) return reply({ code: 'telemetry_disabled' }, 503);
    const token = /^Bearer (\S{1,4096})$/iu.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) return reply({ code: 'sign_in_required' }, 401);
    let principal: string | null;
    try { principal = await dependencies.authenticate(token); }
    catch { return reply({ code: 'auth_unavailable' }, 503); }
    if (!principal) return reply({ code: 'sign_in_required' }, 401);
    const now = dependencies.now();
    for (const [key, bucket] of buckets) if (now - bucket.start >= 60_000) buckets.delete(key);
    if (now - globalStart >= 60_000 || now < globalStart) { globalStart = now; globalCount = 0; }
    const bucket = buckets.get(principal) ?? { count: 0, start: now };
    if (bucket.count >= 6 || globalCount >= 8 || (!buckets.has(principal) && buckets.size >= 256)) return reply({ code: 'rate_limited' }, 429);
    bucket.count += 1;
    buckets.set(principal, bucket);
    globalCount += 1;
    let body: unknown;
    try { body = await readBoundedBody(request); }
    catch (error) { return reply({ code: error instanceof Error && error.message === 'too_large' ? 'batch_too_large' : 'invalid_batch' }, error instanceof Error && error.message === 'too_large' ? 413 : 400); }
    const events = parseOperationalBatch(body, now);
    if (!events) return reply({ code: 'invalid_batch' }, 400);
    // No principal, token, headers, request body, URL, raw error, or business IDs enter this log.
    try { for (const event of events) dependencies.emit(event); }
    catch { return reply({ code: 'collection_unavailable' }, 503); }
    return reply({ ok: true, accepted: events.length, releaseSha: ASSISTANT_DEPLOY_SHA, schemaVersion: 1 });
  };
}

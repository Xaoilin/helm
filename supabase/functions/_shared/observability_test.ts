import assert from 'node:assert/strict';
import { observeEdgeHandler } from './observability.ts';

Deno.test('telemetry cannot delay or change an edge response and strips private data', async () => {
  const exports: Promise<unknown>[] = [];
  const sent: string[] = [];
  const response = new Response('private account payload', { status: 503 });
  const observed = observeEdgeHandler('synthetic', async () => response, {
    endpoint: 'https://example.test', authorization: 'synthetic',
    background: work => { exports.push(work); },
    fetcher: async (_url, init) => { sent.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });
  const returned = await observed(new Request('https://private.test/SECRET', { headers: { Authorization: 'SECRET' } }));
  assert.equal(returned, response);
  assert.equal(sent.length, 0);
  await Promise.all(exports);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('5xx'));
  assert.ok(!/SECRET|private.test|account payload/.test(sent[0]));
});

Deno.test('a failed collector leaves original exceptions and later requests intact', async () => {
  const tasks: Promise<unknown>[] = [];
  const failure = new Error('NEVER_EXPORT');
  const observed = observeEdgeHandler('synthetic', () => { throw failure; }, {
    endpoint: 'https://example.test', authorization: 'synthetic', background: work => { tasks.push(work); },
    fetcher: async () => { throw new Error('network'); },
  });
  await assert.rejects(() => observed(new Request('https://example.test')), (error: unknown) => error === failure);
  await Promise.all(tasks);
});

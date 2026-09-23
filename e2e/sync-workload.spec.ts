import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { Request } from '@playwright/test';
import { expect, openApp, test } from './support/helm-fixture';

// This same scenario/fixture is replayed on both revisions. HTTP and Broadcast
// are mocked; only the application and its scheduling/cache decisions are real.
test('measures a bounded comparable account read workload', async ({ page, scenario }, testInfo) => {
  test.setTimeout(90_000);
  const now = '2026-09-22T12:00:00.000Z';
  const stores = {
    tasks: Array.from({ length: 20 }, (_, index) => ({
      id: `task-${index}`, title: `Synthetic task ${index}`, description: 'Controlled workload',
      completed: false, priority: 'medium', category: 'task', dueDate: '2026-09-22',
      createdAt: now, updatedAt: now,
    })),
    assistantActivityLog: Array.from({ length: 100 }, (_, index) => ({
      id: `activity-${index}`, title: `Synthetic activity ${index}`, description: 'Controlled workload',
      createdAt: now, updatedAt: now,
    })),
  };
  const control = await scenario({ now, stores });
  const requests: Array<{
    trigger: string; endpoint: string; collections: string[] | null;
    requestBytes: number; responseBytes: number; status: number;
    durationMs: number | null;
  }> = [];
  const pending = new Set<Promise<void>>();
  const failedRequests: Array<{ trigger: string; endpoint: string }> = [];
  const triggers = new Map<Request, string>();
  let trigger = 'startup';
  const accountRead = (request: Request) => /\/rest\/v1\/(?:helm_account_state|helm_records|rpc\/get_helm_(?:account_snapshot(?:_for_collections)?|changed_collections))(?:\?|$)/u.test(request.url());
  page.on('request', request => { if (accountRead(request)) triggers.set(request, trigger); });
  page.on('requestfailed', request => {
    if (accountRead(request)) failedRequests.push({
      trigger: triggers.get(request) ?? 'unknown', endpoint: new URL(request.url()).pathname,
    });
  });
  page.on('response', response => {
    const request = response.request();
    if (!accountRead(request)) return;
    const capture = (async () => {
      await response.finished();
      const timing = request.timing();
      const body = request.postDataJSON() as { p_collections?: string[] } | null;
      requests.push({
        trigger: triggers.get(request) ?? 'unknown', endpoint: new URL(request.url()).pathname,
        collections: body?.p_collections ?? null,
        requestBytes: Buffer.byteLength(request.postData() ?? ''),
        responseBytes: (await response.body()).byteLength, status: response.status(),
        durationMs: timing.responseEnd >= 0 ? Math.round(timing.responseEnd * 100) / 100 : null,
      });
    })();
    pending.add(capture);
    void capture.finally(() => pending.delete(capture));
  });
  const settle = async () => {
    await page.waitForTimeout(80);
    await Promise.all(pending);
  };

  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Synthetic task 0" as complete', exact: true })).toBeVisible();
  await settle();

  trigger = 'same-account-fresh-revisit';
  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Synthetic task 0" as complete', exact: true })).toBeVisible();
  await settle();

  trigger = 'visible-idle-10-minutes';
  // Advance in the original 15-second cadence: a single fastForward would
  // deliberately skip repeated timer firings and undercount the old client.
  for (let index = 0; index < 40; index += 1) {
    await page.clock.fastForward(15_000);
    await settle();
  }

  trigger = 'missed-change-foreground';
  control.applyRemoteMutations([{ op: 'patch', collection: 'tasks', recordId: 'task-0', set: { title: 'Recovered task' } }]);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('checkbox', { name: 'Mark "Recovered task" as complete', exact: true })).toBeVisible();
  await settle();

  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.status === 200)).toBe(true);
  expect(failedRequests).toHaveLength(0);
  expect(requests.filter(request => request.trigger === 'same-account-fresh-revisit')).toHaveLength(0);

  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  const result = {
    schemaVersion: 1, release: packageJson.version,
    sourceCommit: process.env.HELM_WORKLOAD_SOURCE_COMMIT ?? null,
    observedAt: new Date().toISOString(),
    environment: 'Actual application in Chromium; identical mocked HTTP/Broadcast fixtures and fake browser clock. No live database or personal account.',
    denominator: 'One client; startup and Tasks navigation; fresh Dashboard/Tasks revisit; 600 simulated visible-idle seconds; one missed remote task update and foreground event.',
    fixtureSha256: createHash('sha256').update(JSON.stringify(stores)).digest('hex'),
    fixture: { tasks: 20, inactiveActivityRecords: 100 },
    responseBytesMeaning: 'Uncompressed mocked HTTP response bodies; excludes headers, TLS, and other application domains.',
    latencyMeaning: 'Measured local mocked HTTP timing only; not production database/network latency.',
    passed: true, requests, failedRequests,
  };
  const output = testInfo.outputPath('sync-workload.json');
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.HELM_WORKLOAD_OUTPUT) await writeFile(process.env.HELM_WORKLOAD_OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  await testInfo.attach('sync-workload', { path: output, contentType: 'application/json' });
});

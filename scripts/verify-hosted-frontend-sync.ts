#!/usr/bin/env tsx
// Protected post-deploy acceptance. Only disposable synthetic Auth identities
// and the JavaScript served by GitHub Pages are used by the browser clients.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { chromium, expect, type Browser, type BrowserContext, type Page, type Response as BrowserResponse } from '@playwright/test';

const pagesUrl = 'https://xaoilin.github.io/helm/';
const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/u, '');
const publicKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const managementToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const deploymentSha = process.env.ASSISTANT_DEPLOY_SHA || '';
const observations: Array<{ scenario: string; passed: boolean; durationMs: number }> = [];
type NetworkCounts = { recordGets: number; rpcPosts: number; mutationPosts: number; http4xx: number; http5xx: number; requestFailures: number };
const network: Record<string, NetworkCounts> = {};
const fixtures: Array<{ id: string; token?: string; removed: boolean }> = [];
const browserBindings: Array<{ client: string; navigation: string; entryPath: string; sha256: string }> = [];
let browser: Browser | undefined;
let browserContexts = 0;
let passed = false;
let assetSha256: string | undefined;
let expectedEntryPath: string | undefined;
let phase = 'bootstrap';

class AcceptanceFailure extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AcceptanceFailure(message);
}

async function step(scenario: string, run: () => Promise<void>): Promise<void> {
  phase = scenario;
  const started = performance.now();
  try {
    await run();
    observations.push({ scenario, passed: true, durationMs: Math.round(performance.now() - started) });
  } catch {
    observations.push({ scenario, passed: false, durationMs: Math.round(performance.now() - started) });
    throw new AcceptanceFailure(`${scenario} failed.`);
  }
}

function phaseCounts(): NetworkCounts {
  return network[phase] ??= { recordGets: 0, rpcPosts: 0, mutationPosts: 0, http4xx: 0, http5xx: 0, requestFailures: 0 };
}

function boundedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
}

async function get(url: string): Promise<Response> {
  return fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
}

function appAsset(html: string): string {
  const path = html.match(/<script[^>]+src="([^"]+\/assets\/[^\"]+\.js)"/u)?.[1];
  check(path && path.startsWith('/helm/assets/'), 'Pages app asset missing.');
  return path;
}

async function waitForExactPagesBuild(version: string): Promise<void> {
  const localHtml = await readFile('dist/index.html', 'utf8');
  const expectedPath = appAsset(localHtml);
  const expectedBytes = await readFile(`dist${expectedPath.slice('/helm'.length)}`);
  const expectedHash = createHash('sha256').update(expectedBytes).digest('hex');
  expectedEntryPath = expectedPath;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try {
      const stamp = Date.now();
      const [release, index] = await Promise.all([
        get(`${pagesUrl}release.json?acceptance=${stamp}`),
        get(`${pagesUrl}?acceptance=${stamp}`),
      ]);
      if (release.ok && index.ok && (await release.json() as { version?: string }).version === version
        && appAsset(await index.text()) === expectedPath) {
        const asset = await get(new URL(expectedPath, pagesUrl).toString());
        if (asset.ok) {
          const observedHash = createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex');
          if (observedHash === expectedHash) {
            assetSha256 = observedHash;
            return;
          }
        }
      }
    } catch {
      // Pages may still be publishing; bound the wait and retain no response body.
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new AcceptanceFailure('Exact protected Pages JavaScript was not served before the deadline.');
}

async function navigateBound(
  page: Page,
  client: string,
  navigation: string,
  navigate: () => Promise<BrowserResponse | null>,
): Promise<void> {
  check(expectedEntryPath && assetSha256, 'Protected frontend candidate was not established.');
  const expectedPath = expectedEntryPath;
  const entryResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === new URL(pagesUrl).origin && url.pathname === expectedPath
      && response.request().resourceType() === 'script'
      && response.request().frame() === page.mainFrame();
  }, { timeout: 30_000 }).catch(() => null);
  const document = await navigate();
  check(document?.ok() && new URL(document.url()).origin === new URL(pagesUrl).origin
    && new URL(document.url()).pathname === new URL(pagesUrl).pathname
    && appAsset(await document.text()) === expectedPath,
    'Browser navigation did not receive the protected Pages document.');
  const script = await entryResponse;
  check(script && script.ok(), 'Browser did not load the protected Pages entry script.');
  const hash = createHash('sha256').update(await script.body()).digest('hex');
  check(hash === assetSha256, 'Browser loaded different Pages JavaScript bytes.');
  browserBindings.push({ client, navigation, entryPath: expectedPath, sha256: hash });
}

async function createFixture(admin: SupabaseClient): Promise<Session> {
  const email = `helm-frontend-acceptance-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  check(!created.error && created.data.user?.id, 'Synthetic Auth identity creation failed.');
  const fixture = { id: created.data.user.id, token: undefined as string | undefined, removed: false };
  fixtures.push(fixture);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  check(!link.error && link.data.user?.id === fixture.id && link.data.properties?.hashed_token,
    'Synthetic Auth login link failed.');
  const client = createClient(supabaseUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  });
  const login = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' });
  check(!login.error && login.data.user?.id === fixture.id && login.data.session?.access_token,
    'Synthetic Auth session verification failed.');
  fixture.token = login.data.session.access_token;
  return login.data.session;
}

async function openClient(session: Session, client: string): Promise<{ context: BrowserContext; page: Page }> {
  check(browser, 'Browser unavailable.');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  browserContexts += 1;
  const page = await context.newPage();
  await page.addInitScript(({ key, sessionValue }) => {
    localStorage.setItem(key, sessionValue);
  }, { key: `sb-${projectRef}-auth-token`, sessionValue: JSON.stringify(session) });
  page.on('response', response => {
    if (!response.url().startsWith(supabaseUrl)) return;
    const counts = phaseCounts();
    if (response.status() >= 500) counts.http5xx += 1;
    else if (response.status() >= 400) counts.http4xx += 1;
    const path = new URL(response.url()).pathname;
    if (path.includes('/rest/v1/rpc/apply_helm_mutations')) counts.mutationPosts += 1;
    else if (path.includes('/rest/v1/rpc/') && response.request().method() === 'POST') counts.rpcPosts += 1;
    else if (path.includes('/rest/v1/helm_records') && response.request().method() === 'GET') counts.recordGets += 1;
  });
  page.on('requestfailed', request => {
    if (request.url().startsWith(supabaseUrl)) phaseCounts().requestFailures += 1;
  });
  await navigateBound(page, client, 'initial', () => page.goto(pagesUrl, {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  }));
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  return { context, page };
}

function task(page: Page, title: string) {
  return page.getByRole('checkbox', { name: `Mark "${title}" as complete` });
}

async function addTask(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add Task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Task' });
  await dialog.getByLabel('Title').fill(title);
  const write = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/apply_helm_mutations')
    && response.request().postData()?.includes('"collection":"tasks"') === true, { timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  check((await write).ok(), 'Synthetic task write was not confirmed.');
  await expect(task(page, title)).toBeVisible({ timeout: 10_000 });
}

async function main(): Promise<void> {
  check(/^https:\/\/[a-z0-9]+\.supabase\.co$/u.test(supabaseUrl)
    && supabaseUrl === `https://${projectRef}.supabase.co` && publicKey && managementToken
    && /^[a-f0-9]{40}$/u.test(deploymentSha), 'Exact protected target and fixture credentials required.');
  await mkdir('test-results', { recursive: true });
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
  await step('Exact deployed Pages JavaScript', () => waitForExactPagesBuild(packageJson.version));

  const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${managementToken}` }, signal: AbortSignal.timeout(30_000),
  });
  check(keysResponse.ok, 'Synthetic Auth administration configuration failed.');
  const keys = await keysResponse.json() as Array<{ name?: string; api_key?: string }>;
  const serviceKey = Array.isArray(keys) ? keys.find(key => key.name === 'service_role')?.api_key : undefined;
  check(serviceKey, 'Synthetic Auth administration credential unavailable.');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  });
  let cleanupFailed = false;
  try {
    const firstSession = await createFixture(admin);
    const otherSession = await createFixture(admin);
    browser = await chromium.launch({ headless: true });
    phase = 'browser bootstrap';
    const first = await openClient(firstSession, 'first');
    const second = await openClient(firstSession, 'second');
    const other = await openClient(otherSession, 'other-account');
    const firstTitle = `Synthetic live sync ${randomUUID()}`;
    const offlineTitle = `Synthetic reconnect ${randomUUID()}`;

    await step('Immediate update in independent same-account browser', async () => {
      await addTask(first.page, firstTitle);
      await expect(task(second.page, firstTitle)).toBeVisible({ timeout: 8_000 });
      await second.page.screenshot({ path: 'test-results/frontend-sync-same-account.png' });
    });
    await step('Separate-account isolation', async () => {
      await expect(task(other.page, firstTitle)).toHaveCount(0);
      await navigateBound(other.page, 'other-account', 'isolation-reload', () => other.page.reload());
      await expect(other.page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
      await other.page.getByRole('button', { name: 'All Tasks', exact: true }).click();
      await expect(task(other.page, firstTitle)).toHaveCount(0);
    });
    await step('Offline and reconnect recovery', async () => {
      await second.context.setOffline(true);
      phase = 'offline';
      await addTask(first.page, offlineTitle);
      await new Promise(resolve => setTimeout(resolve, 1_000));
      await expect(task(second.page, offlineTitle)).toHaveCount(0);
      phase = 'recovery';
      await second.context.setOffline(false);
      await expect(task(second.page, offlineTitle)).toBeVisible({ timeout: 25_000 });
    });
    await step('Same-account revisit retains confirmed data', async () => {
      await second.page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
      await second.page.getByRole('button', { name: 'Navigate to Tasks' }).click();
      await second.page.getByRole('button', { name: 'All Tasks', exact: true }).click();
      await expect(task(second.page, firstTitle)).toBeVisible();
      await expect(task(second.page, offlineTitle)).toBeVisible();
      await navigateBound(second.page, 'second', 'revisit-reload', () => second.page.reload());
      await expect(second.page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
      await second.page.getByRole('button', { name: 'All Tasks', exact: true }).click();
      await expect(task(second.page, firstTitle)).toBeVisible();
      await expect(task(second.page, offlineTitle)).toBeVisible();
    });
    passed = true;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const fixture of fixtures) {
      if (fixture.token) {
        const revoked = await admin.auth.admin.signOut(fixture.token, 'global').catch(() => null);
        if (!revoked || revoked.error) cleanupFailed = true;
      }
      const removed = await admin.auth.admin.deleteUser(fixture.id).catch(() => null);
      fixture.removed = Boolean(removed && !removed.error);
    }
    if (fixtures.some(fixture => !fixture.removed)) cleanupFailed = true;
    if (cleanupFailed) passed = false;
  }
  if (cleanupFailed) throw new AcceptanceFailure('Synthetic Auth fixture cleanup failed.');
}

main().catch(error => {
  console.error(error instanceof AcceptanceFailure ? error.message : 'Hosted frontend sync acceptance failed.');
  process.exitCode = 1;
}).finally(async () => {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/frontend-sync-post-deploy.json', `${JSON.stringify({
    deploymentSha, pagesUrl, assetSha256, passed,
    fixtureCount: fixtures.length, fixturesRemoved: fixtures.length > 0 && fixtures.every(fixture => fixture.removed),
    browserContexts, sameAccountSession: 'shared synthetic Auth session in separate isolated browser contexts',
    browserBindings, network, observations,
  }, null, 2)}\n`);
});

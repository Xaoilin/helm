import type { Page, WebSocketRoute } from '@playwright/test';
import { test, expect, openApp, type ScenarioLoader } from './support/helm-fixture';
import { makeTask } from '../src/test/fixtures';
import { VOICE, type VoiceDecision } from '../supabase/functions/_shared/jevVoice';

const KEY_IDS = { jev: '11111111-1111-4111-8111-111111111111', speech: '22222222-2222-4222-8222-222222222222' };
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const VOICE_URL = '**/functions/v1/sabah-one-jev-voice';

async function prepareVoice(page: Page, scenario: ScenarioLoader) {
  const fixture = await scenario({ stores: { tasks: [makeTask({ id: TASK_ID, title: 'Buy milk' })] } });
  await page.route('**/rest/v1/rpc/list_helm_secrets*', route => route.fulfill({ json: { accountVersion: 1, secrets: [
    { secretId: KEY_IDS.jev, kind: 'api_key', label: 'TypeSafe' }, { secretId: KEY_IDS.speech, kind: 'api_key', label: 'Deepgram' },
  ] } }));
  const commands: string[] = [];
  await page.route(VOICE_URL, async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'speech_token') { await route.fulfill({ json: { accessToken: 'synthetic-ephemeral-token', expiresIn: 30 } }); return; }
    const command = String(body.input.transcript);
    commands.push(command);
    const decision: VoiceDecision = { action: 'none', page: null, itemId: null, text: null, confident: true,
      model: VOICE.model, inputTokens: 1036, decisionMs: 330 };
    if (command === 'Open Calendar') Object.assign(decision, { action: 'navigate', page: 'calendar' });
    if (command === 'Find Buy milk') Object.assign(decision, { action: 'find', itemId: `tasks:${TASK_ID}` });
    if (command === 'add a task to buy bread') Object.assign(decision, { action: 'add_task', text: 'buy bread' });
    if (command === 'Complete Buy milk') Object.assign(decision, { action: 'complete_task', itemId: `tasks:${TASK_ID}` });
    await route.fulfill({ json: decision });
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Toggle Jev voice prototype' }).click();
  const panel = page.getByRole('region', { name: 'Jev voice prototype', exact: true });
  await expect(panel.getByRole('button', { name: 'Enable microphone' })).toBeEnabled();
  return { ...fixture, commands, panel };
}

async function runCommand(page: Page, command: string) {
  await page.getByRole('textbox', { name: 'Or type a command' }).fill(command);
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled();
}

test('Jev voice navigates, finds and requires confirmed service writes', async ({ page, scenario }) => {
  const { services, panel } = await prepareVoice(page, scenario);
  await runCommand(page, 'Open Calendar');
  await expect(page.getByRole('main', { name: 'calendar surface' })).toBeVisible();
  await runCommand(page, 'Find Buy milk');
  await expect(panel.getByText('Found Buy milk in tasks.', { exact: true })).toBeVisible();
  await runCommand(page, 'add a task to buy bread');
  expect(services.planner.tasks).toHaveLength(1);
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(services.planner.tasks).toHaveLength(1);
  await runCommand(page, 'add a task to buy bread');
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByText('Added task: buy bread', { exact: true })).toBeVisible();
  expect(services.planner.tasks.filter(task => task.title === 'buy bread')).toHaveLength(1);
  await runCommand(page, 'Complete Buy milk');
  expect(services.planner.tasks.find(task => task.id === TASK_ID)?.completed).toBe(false);
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByText('Completed task: Buy milk', { exact: true })).toBeVisible();
  expect(services.planner.tasks.find(task => task.id === TASK_ID)?.completed).toBe(true);
  await runCommand(page, 'Delete everything');
  await expect(panel.getByText('No clear supported command. Try one page or one item by name.')).toBeVisible();
  expect(services.planner.tasks).toHaveLength(2);
});

test('Jev voice shows a refused save without an optimistic task or success receipt', async ({ page, scenario }) => {
  const { services, panel } = await prepareVoice(page, scenario);
  await page.route('**/api/planner/v1/tasks/*', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 409, json: { code: 'voice_fixture_refused', message: 'Synthetic task save refused.' } })
    : route.fallback());
  await runCommand(page, 'add a task to buy bread');
  await panel.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Synthetic task save refused');
  await expect(panel.getByText('Save was not confirmed. Check Tasks before repeating the command.')).toBeVisible();
  expect(services.planner.tasks).toHaveLength(1);
  await expect(panel.getByText('Added task: buy bread', { exact: true })).toHaveCount(0);
});

test('streaming speech waits for wake and over, confirms once and stops when hidden', async ({ page, scenario }) => {
  let socket: WebSocketRoute | undefined;
  await page.addInitScript(() => {
    let stopped = 0;
    Object.defineProperty(window, '__voiceTrackStops', { get: () => stopped });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] }) } });
    class TestRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive';
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: TestRecorder });
  });
  await page.routeWebSocket('wss://api.deepgram.com/v1/listen*', ws => { socket = ws; });
  const { services, commands, panel } = await prepareVoice(page, scenario);
  await panel.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(panel.getByText('Listening', { exact: true })).toBeVisible();
  let start = 0;
  function say(transcript: string) {
    socket!.send(JSON.stringify({ type: 'Results', is_final: true, start: start++, duration: 1, channel: { alternatives: [{ transcript }] } }));
  }
  say('add a task to buy bread over');
  say('Hey Sabah add a task to');
  await expect(panel.getByText('Heard: Hey Sabah add a task to', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(0);
  say('buy bread over');
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  expect(commands).toEqual(['add a task to buy bread']);
  expect(services.planner.tasks).toHaveLength(1);
  say('confirm over');
  await expect(panel.getByText('Added task: buy bread', { exact: true })).toBeVisible();
  expect(commands).toHaveLength(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel.getByText('Mic off', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__voiceTrackStops'))).toBe(1);
  expect(services.planner.tasks).toHaveLength(2);
});

for (const width of [320, 768, 1440]) {
  test(`Jev panel fits ${width}px and supports its own keyboard scrolling and Escape`, async ({ page, scenario }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { panel } = await prepareVoice(page, scenario);
    await panel.getByText('Provider keys', { exact: true }).click();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await panel.focus();
    const before = await panel.evaluate(element => ({ top: element.scrollTop, overflowing: element.scrollHeight > element.clientHeight }));
    await page.keyboard.press('PageDown');
    if (before.overflowing) await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(before.top);
    await panel.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`jev-voice-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Toggle Jev voice prototype' })).toBeFocused();
  });
}

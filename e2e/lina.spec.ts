import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { CapabilityId } from '../src/assistant/capabilities';
import { toAssistantToolName } from '../src/assistant/toolSchemas';

const SETTINGS_KEY = 'helm:settings';

type VoiceAssistantDebugState = {
  assistantState: string;
  voiceSessionMode: string;
  wakeWordArmed: boolean;
};

type AssistantMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type PlanningBundle = {
  entityCandidates?: {
    tasks?: Array<{ id: string; label: string }>;
    calendarEvents?: Array<{ id: string; label: string }>;
  };
};

type HostedTurn =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'tool_calls';
      toolCalls: Array<{
        callId: string;
        name: string;
        arguments: string;
      }>;
    };

function normalizeTranscript(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function parsePlanningBundle(messages: AssistantMessage[]): PlanningBundle {
  const bundleMessage = messages.find(message =>
    message.role === 'system' && message.content.startsWith('Planning bundle JSON:\n'),
  );
  if (!bundleMessage) return {};

  try {
    return JSON.parse(bundleMessage.content.replace('Planning bundle JSON:\n', '')) as PlanningBundle;
  } catch {
    return {};
  }
}

function makeTextTurn(
  mode: 'reply' | 'clarify' | 'confirm' | 'tool_calls',
  assistantMessage: string,
  toolCalls: Array<{
    capability: string;
    args: Record<string, string | boolean | string[]>;
  }> = [],
): HostedTurn {
  return {
    type: 'text',
    text: JSON.stringify({
      mode,
      assistantMessage,
      toolCalls: toolCalls.map(toolCall => ({
        capability: toolCall.capability,
        args: toolCall.args,
      })),
    }),
  };
}

function makeToolTurn(
  toolCalls: Array<{
    callId: string;
    capability: CapabilityId;
    args: Record<string, string | boolean | string[]>;
  }>,
): HostedTurn {
  return {
    type: 'tool_calls',
    toolCalls: toolCalls.map(toolCall => ({
      callId: toolCall.callId,
      name: toAssistantToolName(toolCall.capability),
      arguments: JSON.stringify(toolCall.args),
    })),
  };
}

function parseNarrationPayload(messages: AssistantMessage[]): Record<string, unknown> {
  const content = messages[messages.length - 1]?.content || '';
  const prefix = 'Verified turn facts JSON:\n';
  if (!content.startsWith(prefix)) {
    return {};
  }

  try {
    return JSON.parse(content.slice(prefix.length)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildTurnResponse(messages: AssistantMessage[]): HostedTurn {
  const transcript = messages[messages.length - 1]?.content || '';
  const normalized = normalizeTranscript(transcript);
  const bundle = parsePlanningBundle(messages);
  const taskCandidates = bundle.entityCandidates?.tasks || [];

  if (normalized === 'open calendar') {
    return makeToolTurn([
      { callId: 'call_open_calendar', capability: 'navigation.go_to_surface', args: { surface: 'calendar' } },
    ]);
  }

  if (normalized === 'show me all my tasks') {
    return makeToolTurn([
      { callId: 'call_open_all_tasks', capability: 'tasks.open_view', args: { tab: 'all', resetFilters: true } },
    ]);
  }

  if (normalized === 'show my goals') {
    return makeToolTurn([
      { callId: 'call_open_goals', capability: 'tasks.open_view', args: { tab: 'goals', resetFilters: true } },
    ]);
  }

  if (normalized === 'show today s tasks' || normalized === 'show todays tasks') {
    return makeToolTurn([
      { callId: 'call_open_today_tasks', capability: 'tasks.open_view', args: { tab: 'today', resetFilters: true } },
    ]);
  }

  if (normalized === 'can you add a task for me to put the mirror up on the office') {
    return makeToolTurn([
      {
        callId: 'call_create_task_office_mirror',
        capability: 'tasks.create_task',
        args: {
          title: 'put the mirror up on the office',
          priority: 'medium',
          category: 'task',
        },
      },
    ]);
  }

  if (normalized === 'add task hang up the mirror in this small office') {
    return makeToolTurn([
      {
        callId: 'call_create_task_small_office_mirror',
        capability: 'tasks.create_task',
        args: {
          title: 'hang up the mirror in this small office',
          priority: 'medium',
          category: 'task',
        },
      },
    ]);
  }

  if (normalized === 'add task buy mirror hooks for the hallway') {
    return makeToolTurn([
      {
        callId: 'call_create_task_mirror_hooks',
        capability: 'tasks.create_task',
        args: {
          title: 'buy mirror hooks for the hallway',
          priority: 'medium',
          category: 'task',
        },
      },
    ]);
  }

  if (normalized === 'show me that task' || normalized === 'show me that task.') {
    const taskId = taskCandidates[0]?.id || '';
    if (!taskId) {
      return makeTextTurn('clarify', 'Which task should I show you?');
    }

    return makeToolTurn([
      {
        callId: 'call_reveal_task',
        capability: 'tasks.reveal_task',
        args: {
          taskId,
        },
      },
    ]);
  }

  if (normalized === 'delete all of the tasks related to mirrors' || normalized === 'no i said delete all of the tasks related to mirrors') {
    const taskIds = taskCandidates
      .filter(task => task.label.toLowerCase().includes('mirror'))
      .map(task => task.id);
    return makeTextTurn('confirm', `I can delete ${taskIds.length} tasks. Do you want me to do that?`, [
      {
        capability: 'tasks.delete_matching',
        args: {
          taskIds,
        },
      },
    ]);
  }

  if (normalized === 'delete all of the tasks related to minors') {
    return makeTextTurn('clarify', `I couldn't find any tasks matching "minors".`);
  }

  return makeTextTurn('reply', 'I can help once a live planner gives me a grounded action for that request.');
}

function buildNarrationResponse(messages: AssistantMessage[]): string {
  const payload = parseNarrationPayload(messages);
  const turnState = typeof payload.turnState === 'string' ? payload.turnState : '';
  const executedToolResults = Array.isArray(payload.executedToolResults)
    ? payload.executedToolResults as Array<Record<string, unknown>>
    : [];
  const firstResult = executedToolResults[0];
  const firstCapability = typeof firstResult?.capability === 'string' ? firstResult.capability : '';
  const firstSummary = typeof firstResult?.summary === 'string' ? firstResult.summary : '';

  if (turnState === 'awaiting_confirmation') {
    const requested = Array.isArray(payload.requestedToolCalls)
      ? payload.requestedToolCalls as Array<Record<string, unknown>>
      : [];
    const deleteCall = requested.find(call => call.capability === 'tasks.delete_matching');
    if (deleteCall) {
      const args = typeof deleteCall.args === 'object' && deleteCall.args !== null
        ? deleteCall.args as { taskIds?: string[] }
        : {};
      return args.taskIds && args.taskIds.length > 1
        ? `I can delete ${args.taskIds.length} tasks. Do you want me to do that?`
        : 'Do you want me to delete that task?';
    }
    return 'Do you want me to go ahead?';
  }

  if (turnState === 'cancelled') {
    return "Okay, I won't do that.";
  }

  if (turnState === 'clarify') {
    return typeof payload.clarifyReason === 'string' ? payload.clarifyReason : 'I need a bit more detail first.';
  }

  if (turnState === 'executed') {
    if (firstCapability === 'tasks.create_task') {
      const facts = Array.isArray(firstResult?.facts) ? firstResult.facts : [];
      const created = facts.find(fact => typeof fact === 'string' && fact.startsWith('Created the task "'));
      const title = typeof created === 'string'
        ? (created.match(/^Created the task "(.+)"\.$/u)?.[1] || '')
        : '';
      return title ? `Added "${title}" to your tasks.` : 'Added that task to your tasks.';
    }

    if (firstCapability === 'tasks.reveal_task') {
      const entities = Array.isArray(firstResult?.entities) ? firstResult.entities as Array<Record<string, unknown>> : [];
      const label = typeof entities[0]?.label === 'string' ? entities[0].label : 'that task';
      return `Opening "${label}" in your tasks.`;
    }

    if (firstCapability === 'tasks.delete_matching') {
      return firstSummary || 'Deleted that task.';
    }

    if (firstCapability === 'tasks.open_view') {
      return firstSummary || 'Opening your tasks.';
    }

    if (firstCapability === 'navigation.go_to_surface') {
      return firstSummary || 'Opening that surface.';
    }

    if (firstSummary) {
      return firstSummary;
    }
  }

  return 'How can I help next?';
}

test.describe('Lina Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ settingsKey }) => {
      localStorage.clear();
      localStorage.setItem(settingsKey, JSON.stringify({
        credentialSource: 'onepassword-first',
        theme: 'dark',
        dataRetentionDays: 90,
        telemetry: false,
        assistantProvider: 'hosted',
        assistantLanguage: 'en',
        supabaseUrl: 'https://helm.test.supabase.co',
        supabaseAnonKey: 'helm-test-anon-key',
      }));
    }, {
      settingsKey: SETTINGS_KEY,
    });
    await page.route('**/functions/v1/assistant-openai', async route => {
      const body = route.request().postDataJSON() as {
        action?: string;
        messages?: AssistantMessage[];
      } | null;

      if (body?.action === 'health') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.4',
          }),
        });
        return;
      }

      if (body?.action === 'turn') {
        const turn = buildTurnResponse(body?.messages || []);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.4',
            turn,
            rawResponse: turn.type === 'text' ? turn.text : JSON.stringify(turn.toolCalls),
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
          text: JSON.stringify({
            assistantMessage: buildNarrationResponse(body?.messages || []),
          }),
        }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('.sidebar');
  });

  test('should show L button on dashboard', async ({ page }) => {
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel when L button clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    // Panel should appear with Lina header
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should close panel when X clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button[aria-label="Close Lina"]')).toBeVisible();
    await page.locator('button[aria-label="Close Lina"]').click();
    // Panel should be gone, L button should be back
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should close panel on Escape', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel with Ctrl+Shift+L', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'L',
        code: 'KeyL',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }));
    });
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should show quick command chips', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button:has-text("next meeting")')).toBeVisible();
    await expect(page.locator('button:has-text("tasks left")')).toBeVisible();
    await expect(page.locator('button:has-text("prayer times")')).toBeVisible();
  });

  test('should keep the wake word armed while the manual popup is open', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.waitForFunction(() => {
      const debugWindow = window as Window & {
        __helmVoiceAssistantDebug?: {
          getState?: () => VoiceAssistantDebugState;
        };
      };
      return typeof debugWindow.__helmVoiceAssistantDebug?.getState === 'function';
    });

    const manualState = await page.evaluate(() => {
      const debugWindow = window as Window & {
        __helmVoiceAssistantDebug?: {
          getState?: () => VoiceAssistantDebugState;
        };
      };
      return debugWindow.__helmVoiceAssistantDebug?.getState?.();
    });
    expect(manualState).toMatchObject({
      assistantState: 'open',
      voiceSessionMode: 'manual',
      wakeWordArmed: true,
    });
  });

  test('should respond to quick command chip click', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.locator('button:has-text("tasks left")').click();
    // Should show a response — either English or Arabic depending on lang setting
    await expect(page.locator('.va-lina')).toBeVisible({ timeout: 10000 });
  });

  test('should respond to text input', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    const input = page.locator('input[placeholder*="Type"]');
    await input.fill('open calendar');
    await input.press('Enter');
    // Should navigate to calendar
    await expect(page.locator('h1:has-text("Calendar")')).toBeVisible({ timeout: 5000 });
  });

  test('should switch task tabs from Lina without needing a specific task', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    const input = page.locator('input[placeholder*="Type"]');

    await input.fill('show me all my tasks');
    await input.press('Enter');
    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'All Tasks' })).toHaveClass(/active/);

    await input.fill('show my goals');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Goals' })).toHaveClass(/active/);

    await input.fill("show today's tasks");
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Today' })).toHaveClass(/active/);
  });

  test('should create a polite task request and reveal it in All Tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');
    await input.fill('Can you add a task for me to put the mirror up on the office?');
    await input.press('Enter');

    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "put the mirror up on the office" to your tasks.');

    await input.fill('Show me that task.');
    await input.press('Enter');

    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'All Tasks' })).toHaveClass(/active/);
    await expect(page.locator('.all-task-card.assistant-focus, .task-row.assistant-focus').first()).toContainText('put the mirror up on the office');
  });

  test('should keep undated assistant-created tasks out of Today but visible in All Tasks', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');
    await input.fill('Can you add a task for me to put the mirror up on the office?');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "put the mirror up on the office" to your tasks.');

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Today' })).toHaveClass(/active/);
    await expect(page.locator('text=Nothing for today')).toBeVisible();
    await expect(page.locator('text=put the mirror up on the office')).toHaveCount(0);

    await page.getByRole('button', { name: 'All Tasks' }).click();
    await expect(page.locator('text=put the mirror up on the office')).toBeVisible();
  });

  test('should export the active chat conversation as markdown', async ({ page }) => {
    await page.addInitScript(({ conversations }) => {
      localStorage.setItem('helm:conversations', JSON.stringify(conversations));
    }, {
      conversations: [
        {
          id: 'conv-export',
          title: 'Delete my Internet task.',
          createdAt: '2026-04-13T09:00:00.000Z',
          updatedAt: '2026-04-13T09:05:00.000Z',
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Delete my Internet task.',
              timestamp: '2026-04-13T09:00:00.000Z',
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'I can delete that. Do you want me to continue?',
              timestamp: '2026-04-13T09:00:05.000Z',
            },
          ],
        },
      ],
    });

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.getByText('Delete my Internet task.').click();
    await expect(page.getByRole('heading', { name: 'Delete my Internet task.' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export .md' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();

    expect(download.suggestedFilename()).toMatch(/^helm-chat-delete-my-internet-task-/);
    expect(downloadPath).not.toBeNull();

    const markdown = readFileSync(downloadPath!, 'utf8');
    expect(markdown).toContain('# HELM Chat Export');
    expect(markdown).toContain('## Transcript');
    expect(markdown).toContain('Delete my Internet task.');
    expect(markdown).toContain('I can delete that. Do you want me to continue?');
  });

  test('should confirm and delete all matching mirror tasks from chat', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');

    await input.fill('Add task hang up the mirror in this small office');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "hang up the mirror in this small office" to your tasks.');

    await input.fill('Add task buy mirror hooks for the hallway');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "buy mirror hooks for the hallway" to your tasks.');

    await input.fill('Delete all of the tasks related to mirrors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks');

    await input.fill('yes');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Deleted 2 tasks.');

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await page.getByRole('button', { name: 'All Tasks' }).click();
    await expect(page.locator('text=hang up the mirror in this small office')).toHaveCount(0);
    await expect(page.locator('text=buy mirror hooks for the hallway')).toHaveCount(0);
  });

  test('should learn "no, I said" corrections and reuse them for later commands', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Chat' }).click();
    await page.locator('.chat-main button:has-text("New conversation")').click();

    const input = page.locator('input[placeholder*="Type a message"]');

    await input.fill('Add task hang up the mirror in this small office');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "hang up the mirror in this small office" to your tasks.');

    await input.fill('Add task buy mirror hooks for the hallway');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('Added "buy mirror hooks for the hallway" to your tasks.');

    await input.fill('Delete all of the tasks related to minors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText(`I couldn't find any tasks matching "minors".`);

    await input.fill('No, I said delete all of the tasks related to mirrors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks');

    await input.fill('cancel');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText("Okay, I won't do that.");

    await input.fill('Delete all of the tasks related to minors');
    await input.press('Enter');
    await expect(page.locator('.chat-message.assistant').last()).toContainText('I can delete 2 tasks');
  });
});

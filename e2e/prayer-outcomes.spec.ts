import type { Page } from '@playwright/test';
import { toAssistantToolName } from '../src/assistant/toolSchemas';
import { expect, test } from './support/helm-fixture';

test('tracks prayer outcomes, warns globally, persists stats, and clarifies chat and voice status', async ({
  page,
  scenario,
}) => {
  await scenario('prayer', {
    assistant: body => {
      if (body.action === 'health') {
        return { ok: true, provider: 'openai', model: 'gpt-5.4' };
      }
      if (body.action === 'turn') {
        const transcript = [...(body.messages || [])]
          .reverse()
          .find(message => message.role === 'user')
          ?.content.toLowerCase() || '';
        const prayerName = transcript.includes('asr') ? 'Asr' : 'Dhuhr';
        return {
          ok: true,
          provider: 'openai',
          model: 'gpt-5.4',
          turn: {
            type: 'tool_calls',
            toolCalls: [{
              callId: `complete_${prayerName.toLowerCase()}`,
              name: toAssistantToolName('tasks.complete_matching'),
              arguments: JSON.stringify({ taskId: `prayer-${prayerName.toLowerCase()}` }),
            }],
          },
        };
      }
      return {
        ok: true,
        provider: 'openai',
        model: 'gpt-5.4',
        text: JSON.stringify({ assistantMessage: 'Prayer outcome recorded.' }),
      };
    },
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const reminder = page.getByRole('alert').filter({ hasText: 'Pray Fajr before it is too late' });
  await expect(reminder).toBeVisible();
  await expect(reminder).toContainText('Sunrise');
  const pulse = reminder.locator('.prayer-deadline-pulse');
  await expect(pulse).toHaveCSS('animation-name', 'prayer-gentle-pulse');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pulse).toHaveCSS('animation-name', 'none');
  await expect(pulse).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await reminder.getByRole('button', { name: 'Mark Fajr prayed' }).click();
  await page.getByRole('button', { name: /On time/ }).click();
  await expect(reminder).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'Navigate to Profile' }).click();
  await expect(page.getByRole('img', {
    name: 'All prayers: 100% on time, 0% late, 0% missed',
  })).toBeVisible();
  await page.getByRole('heading', { name: 'Prayer outcomes' }).scrollIntoViewIfNeeded();

  await page.getByRole('button', { name: 'Navigate to Chat' }).click();
  await page.locator('.chat-main button:has-text("New conversation")').click();
  const chatInput = page.locator('input[placeholder*="Type a message"]');
  await chatInput.fill('complete Dhuhr');
  await chatInput.press('Enter');
  await expect(page.locator('.chat-message.assistant').last()).toContainText('On time or late?');
  await chatInput.fill('late');
  await chatInput.press('Enter');
  await expect.poll(() => prayerStatus(page, '2026-07-28::Dhuhr')).toBe('late');

  await page.waitForFunction(() => Boolean((window as Window & {
    __helmVoiceAssistantDebug?: { submitVoiceTranscript?: (text: string) => void };
  }).__helmVoiceAssistantDebug?.submitVoiceTranscript));
  await page.evaluate(() => {
    (window as Window & {
      __helmVoiceAssistantDebug?: { submitVoiceTranscript?: (text: string) => void };
    }).__helmVoiceAssistantDebug?.submitVoiceTranscript?.('complete Asr');
  });
  await expect(page.locator('.va-lina')).toContainText('On time or late?');
  await page.evaluate(() => {
    (window as Window & {
      __helmVoiceAssistantDebug?: { submitVoiceTranscript?: (text: string) => void };
    }).__helmVoiceAssistantDebug?.submitVoiceTranscript?.('on time');
  });
  await expect.poll(() => prayerStatus(page, '2026-07-28::Asr')).toBe('on_time');

  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  await expect(page.getByText('On time').first()).toBeVisible();
  await expect(page.getByText('Late').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close Lina' }).click();
  await expect(page.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();
  await expect(page.locator('.va-bubble')).toBeHidden();
  await page.locator('.prayer-stats-card').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();
  await expect(page.locator('.va-bubble')).toBeHidden();
});

async function prayerStatus(page: Page, prayerId: string) {
  return page.evaluate(async id => {
    const response = await fetch('/__helm_e2e_db');
    if (!response.ok) throw new Error('Could not read the HELM database fixture.');
    const rows = await response.json() as Array<{
      collection: string;
      deleted_at: string | null;
      payload: { status?: string };
      record_id: string;
    }>;
    return rows.find(row => (
      row.collection === 'prayerTracking'
      && row.record_id === `record:${id}`
      && row.deleted_at === null
    ))?.payload.status;
  }, prayerId);
}

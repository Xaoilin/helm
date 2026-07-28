import { expect, test } from '@playwright/test';
import { toAssistantToolName } from '../src/assistant/toolSchemas';

const prayerTasks = ['Fajr', 'Dhuhr', 'Asr'].map((prayerName, index) => ({
  id: `prayer-${prayerName.toLowerCase()}`,
  title: `${prayerName} Prayer`,
  description: '',
  completed: false,
  priority: 'medium',
  category: 'prayer',
  prayerName,
  recurring: { frequency: 'daily' },
  createdAt: `2026-07-28T04:0${index}:00.000Z`,
  updatedAt: `2026-07-28T04:0${index}:00.000Z`,
}));

test('tracks prayer outcomes, warns globally, persists stats, and clarifies chat and voice status', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-28T05:36:00.000Z') });
  await page.addInitScript(({ tasks }) => {
    if (sessionStorage.getItem('helm:e2e-prayer-seeded') === 'yes') {
      return;
    }

    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('helm:e2e-prayer-seeded', 'yes');
    localStorage.setItem('helm:settings', JSON.stringify({
      theme: 'dark',
      dataRetentionDays: 90,
      telemetry: false,
      prayerEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
      prayerReminderEnabled: true,
      prayerReminderMinutes: 15,
      assistantEnabled: true,
      assistantLanguage: 'en',
      assistantProvider: 'hosted',
      supabaseUrl: 'https://helm.test.supabase.co',
      supabaseAnonKey: 'helm-test-anon-key',
    }));
    localStorage.setItem('helm:tasks', JSON.stringify(tasks));
    sessionStorage.setItem('helm:shell-surface', 'settings');
  }, { tasks: prayerTasks });

  await page.route('**/api.aladhan.com/v1/timingsByCity**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: '06:50',
            Dhuhr: '13:00',
            Asr: '16:30',
            Sunset: '20:00',
            Maghrib: '20:15',
            Isha: '21:45',
            Midnight: '00:15',
          },
          date: {
            hijri: {
              day: '12',
              month: { en: 'Safar' },
              year: '1448',
            },
          },
          meta: { timezone: 'Europe/London' },
        },
      }),
    });
  });

  await page.route('**/functions/v1/assistant-openai', async route => {
    const body = route.request().postDataJSON() as {
      action?: string;
      messages?: Array<{ role: string; content: string }>;
    } | null;
    if (body?.action === 'health') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, provider: 'openai', model: 'gpt-5.4' }),
      });
      return;
    }
    if (body?.action === 'turn') {
      const transcript = [...(body.messages || [])].reverse().find(message => message.role === 'user')?.content.toLowerCase() || '';
      const prayerName = transcript.includes('asr') ? 'Asr' : 'Dhuhr';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        text: JSON.stringify({ assistantMessage: 'Prayer outcome recorded.' }),
      }),
    });
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
  await page.screenshot({
    path: 'test-results/prayer-outcomes-profile.png',
  });

  await page.getByRole('button', { name: 'Navigate to Chat' }).click();
  await page.locator('.chat-main button:has-text("New conversation")').click();
  const chatInput = page.locator('input[placeholder*="Type a message"]');
  await chatInput.fill('complete Dhuhr');
  await chatInput.press('Enter');
  await expect(page.locator('.chat-message.assistant').last()).toContainText('On time or late?');
  await chatInput.fill('late');
  await chatInput.press('Enter');
  await expect.poll(async () => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{"records":{}}') as {
      records: Record<string, { status?: string }>;
    };
    return state.records['2026-07-28::Dhuhr']?.status;
  })).toBe('late');

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
  await expect.poll(async () => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('helm:prayerTracking') || '{"records":{}}') as {
      records: Record<string, { status?: string }>;
    };
    return state.records['2026-07-28::Asr']?.status;
  })).toBe('on_time');

  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  await expect(page.getByText('On time').first()).toBeVisible();
  await expect(page.getByText('Late').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close Lina' }).click();
  await expect(page.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();
  await expect(page.locator('.va-bubble')).toBeHidden();
  await page.locator('.prayer-stats-card').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();
  await expect(page.locator('.va-bubble')).toBeHidden();
  await page.screenshot({
    path: 'test-results/prayer-outcomes-reminder.png',
  });
});

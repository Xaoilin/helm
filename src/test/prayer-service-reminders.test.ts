import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyMomentumState } from '../types/domain';
import type {
  ServiceMomentumReminderPillar,
  ServicePrayerReminder,
  ServicePrayerReminders,
} from '../services/backend/contracts';
import { prayerNoticeDataSchema, prayerReminderEventDataSchema } from '../services/backend/liveContracts';
import {
  getPrayerReminders,
  saveMomentumReminders,
  snoozePrayerReminder,
} from '../services/backend/prayerServiceApi';
import { ServiceError } from '../services/backend/serviceClient';
import {
  buildMomentumReminderPillars,
  canSnoozeReminder,
  latestCompletedDate,
  mergeReminder,
  reminderFromDeadlineEvent,
  sameMomentumReminderPillars,
  selectActiveReminders,
} from '../services/prayerServiceReminders';
import { createDefaultDailyMomentumState, recordDailyMomentumProgress } from '../services/dailyMomentum';
import { createPrayerTrackingState, setPrayerOutcome } from '../services/prayerTracking';
import { makeMomentumState } from './fixtures';

vi.mock('../config', () => ({ PRAYER_BACKEND_URL: 'https://prayer.test' }));
vi.mock('../store/supabase', () => ({
  getFreshAccessToken: async () => 'token',
  SessionUnavailableError: class extends Error {},
}));

afterEach(() => vi.restoreAllMocks());

function fixture<T>(name: string): { status: number; body: T } {
  return JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'prayer-service', `${name}.json`), 'utf8')) as {
    status: number;
    body: T;
  };
}

const reminders = fixture<ServicePrayerReminders>('reminders').body;
const opportunity = reminders.active.find(reminder => reminder.kind === 'prayer-opportunity')!;
const momentum = reminders.active.find(reminder => reminder.kind === 'momentum')!;
const tracking = createPrayerTrackingState(new Date('2026-09-01T00:00:00Z'));
const whileActive = new Date(Date.parse(opportunity.firesAt) + 60_000);

/** Daily Momentum with the Learn pillar's Level 1 (two pages of reading) complete on `date`. */
function learnCompletedOn(date: string): DailyMomentumState {
  return recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
    date, pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 2,
  });
}

describe('prayer reminder API', () => {
  it('loads the active reminders and the momentum preferences the service holds', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(reminders));

    await expect(getPrayerReminders()).resolves.toEqual(reminders);
    expect(fetchMock.mock.calls[0][0]).toBe('https://prayer.test/api/prayer/v1/reminders');
  });

  it('snoozes a reminder once, named by the reminder so a retry is applied once', async () => {
    const snoozed = fixture<ServicePrayerReminder>('reminder-snoozed').body;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(snoozed));

    await expect(snoozePrayerReminder(opportunity.key)).resolves.toEqual(snoozed);
    expect(fetchMock.mock.calls[0][0])
      .toBe(`https://prayer.test/api/prayer/v1/reminders/${encodeURIComponent(opportunity.key)}/snooze`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': `prayer-reminder:snooze:${opportunity.key}` },
    });
  });

  it('reports the service refusing a second snooze in its own words', async () => {
    const used = fixture<{ code: string; message: string }>('reminder-snooze-used');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(used.body, { status: used.status }));

    const refusal = await snoozePrayerReminder(opportunity.key).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ServiceError);
    expect(refusal).toMatchObject({ status: 409, code: 'snooze_used', message: used.body.message });
  });

  it('saves the momentum reminder preferences as one write', async () => {
    const saved = fixture<{ pillars: ServiceMomentumReminderPillar[] }>('momentum-reminders-saved').body;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(saved));

    await expect(saveMomentumReminders(saved.pillars)).resolves.toEqual(saved.pillars);
    expect(fetchMock.mock.calls[0][0]).toBe('https://prayer.test/api/prayer/v1/reminders/momentum');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', headers: { 'Idempotency-Key': expect.any(String) } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ pillars: saved.pillars });
  });
});

describe('live reminder events', () => {
  it('reads a prayer.notice as reminder JSON, and a prayer.reminder in either shape', () => {
    expect(prayerNoticeDataSchema.parse(momentum)).toEqual(momentum);
    expect(prayerReminderEventDataSchema.parse(opportunity)).toEqual(opportunity);
    const deadline = {
      date: '2026-09-27', prayer: 'Dhuhr', deadlineAt: '2026-09-27T15:20:00Z', deadline: 'Asr',
      timeZone: 'Europe/London', reminderMinutes: 15,
    } as const;
    const parsed = prayerReminderEventDataSchema.parse(deadline);
    expect('key' in parsed).toBe(false);
    expect(reminderFromDeadlineEvent(deadline, '2026-09-27T15:05:00Z')).toMatchObject({
      key: 'deadline:2026-09-27:Dhuhr', kind: 'deadline', expiresAt: deadline.deadlineAt, snoozeCount: 0,
    });
  });

  it('keeps the used snooze when a snoozed reminder is sent again', () => {
    const snoozed = { ...opportunity, snoozeCount: 1, snoozedUntil: '2026-09-27T11:59:00Z' };
    expect(mergeReminder(snoozed, { ...opportunity, snoozeCount: 0, snoozedUntil: null }))
      .toMatchObject({ snoozeCount: 1, snoozedUntil: '2026-09-27T11:59:00Z' });
  });
});

describe('which reminders show', () => {
  it('shows a prayer opportunity before a Learn/Move prompt, worded for the banner', () => {
    const active = selectActiveReminders(reminders.active, whileActive, { tracking, momentum: makeMomentumState() });

    expect(active.deadline).toBeNull();
    expect(active.notice).toMatchObject({
      key: opportunity.key, title: 'Dhuhr prayer opportunity', body: 'The Dhuhr prayer opportunity has begun.',
      canSnooze: true,
    });
  });

  it('hides a reminder once its prayer is recorded, its pillar completed, it expired or it is snoozed', () => {
    const recorded = setPrayerOutcome(tracking, {
      date: opportunity.date, prayerName: 'Dhuhr', status: 'on_time', recordedAt: whileActive, source: 'dashboard',
    });
    expect(selectActiveReminders(reminders.active, whileActive, { tracking: recorded, momentum: makeMomentumState() })
      .notice).toMatchObject({ kind: 'momentum', title: 'Learn — Level 1' });
    expect(selectActiveReminders(reminders.active, whileActive, {
      tracking: recorded, momentum: learnCompletedOn(momentum.date),
    }).notice).toBeNull();

    const afterExpiry = new Date(Date.parse(momentum.expiresAt));
    expect(selectActiveReminders(reminders.active, afterExpiry, { tracking, momentum: null }).notice).toBeNull();

    const snoozed = { ...opportunity, snoozedUntil: new Date(whileActive.getTime() + 60_000).toISOString() };
    expect(selectActiveReminders([snoozed], whileActive, { tracking, momentum: null }).notice).toBeNull();
    expect(selectActiveReminders([snoozed], new Date(whileActive.getTime() + 60_000), { tracking, momentum: null })
      .notice?.key).toBe(opportunity.key);
  });

  it('offers one snooze, and none that would outlast the reminder', () => {
    expect(canSnoozeReminder(opportunity, whileActive)).toBe(true);
    expect(canSnoozeReminder({ ...opportunity, snoozeCount: 1 }, whileActive)).toBe(false);
    expect(canSnoozeReminder(opportunity, new Date(Date.parse(opportunity.expiresAt) - 5 * 60_000))).toBe(false);
  });
});

describe('momentum reminder preferences for the prayer service', () => {
  it('sends each pillar preference with the latest date its Level 1 was complete', () => {
    const state = {
      ...learnCompletedOn('2026-09-26'),
      reminderPreferences: {
        learn: { enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'] },
        move: { enabled: false, afterPrayers: ['Asr'] },
      },
    } as DailyMomentumState;

    expect(latestCompletedDate(state, 'learn')).toBe('2026-09-26');
    expect(latestCompletedDate(state, 'move')).toBeNull();
    expect(buildMomentumReminderPillars(state)).toEqual([
      { pillar: 'learn', enabled: true, afterPrayers: ['Dhuhr', 'Maghrib', 'Isha'], completedOn: '2026-09-26' },
      { pillar: 'move', enabled: false, afterPrayers: ['Asr'], completedOn: null },
    ]);
  });

  it('compares preferences whatever the pillar order', () => {
    const [learn, move] = reminders.momentum;
    expect(sameMomentumReminderPillars([learn, move], [move, learn])).toBe(true);
    expect(sameMomentumReminderPillars([learn, move], [{ ...learn, completedOn: '2026-09-27' }, move])).toBe(false);
  });
});

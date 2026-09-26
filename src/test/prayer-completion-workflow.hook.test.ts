import { act, renderHook } from '@testing-library/react';
import { useCallback, useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamificationProfile, PrayerTrackingRecord, Task } from '../types/domain';
import type { TaskContextValue } from '../store/contexts/TaskContext';
import type { GamificationContextValue } from '../store/contexts/GamificationContext';
import { PrayerCompletionRejectedError } from '../services/prayerCompletionRules';
import { getPrayerRecordKey } from '../services/prayerTracking';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerCompletionWorkflow } from '../store/contexts/prayer/usePrayerCompletionWorkflow';
import { usePrayerRewardRecovery } from '../store/contexts/prayer/usePrayerRewardRecovery';
import { usePrayerCompletionPrompt } from '../store/contexts/prayer/usePrayerCompletionPrompt';
import { makeGamification, makeTask } from './fixtures';
import { makePrayerTimesData, PRAYER_TEST_DATE, PRAYER_TEST_ZONE } from './prayerFixtures';

const DHUHR_KEY = getPrayerRecordKey(PRAYER_TEST_DATE, 'Dhuhr');
const timetable = makePrayerTimesData();
const dhuhrTask = makeTask({ id: 'task-dhuhr', title: 'Dhuhr Prayer', category: 'prayer', prayerName: 'Dhuhr' });

const spies = {
  updateTask: vi.fn(),
  cancelReminderForPrayer: vi.fn(),
  showNotice: vi.fn(),
};

/** Real tracking, task and gamification state, wired the way PrayerProvider wires the workflow. */
function useCompletionHarness({ loaded, initialRecords }: {
  loaded: boolean;
  initialRecords?: Record<string, PrayerTrackingRecord>;
}) {
  const [tasks, setTasks] = useState<Task[]>([dhuhrTask]);
  const [gamification, setGamification] = useState<GamificationProfile>(makeGamification);
  const store = usePrayerTracking();
  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialRecords) {
    setSeeded(true);
    store.commitTracking(current => ({ ...current, records: initialRecords }));
  }

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    spies.updateTask(id, updates);
    setTasks(current => current.map(task => (task.id === id ? { ...task, ...updates } : task)));
  }, []);
  const taskOwner = useMemo<TaskContextValue>(() => ({
    tasks, loaded: true, addTask: vi.fn(), updateTask, removeTask: vi.fn(), setTasks,
  }), [tasks, updateTask]);
  const gamificationOwner = useMemo<GamificationContextValue>(() => ({
    gamification, loaded: true, updateGamification: setGamification, backfillPrayerLog: vi.fn(),
  }), [gamification]);

  const workflow = usePrayerCompletionWorkflow({
    taskOwner,
    gamificationOwner,
    knowledgeCounts: {
      knowledgeEntries: 0, knowledgeTopics: 0, lifestyleHaramMastered: 0, lifestyleHalalConsistent: 0, lifestyleTotal: 0,
    },
    goalTags: [],
    timetable,
    scheduleTimeZone: PRAYER_TEST_ZONE,
    today: PRAYER_TEST_DATE,
    getToday: () => PRAYER_TEST_DATE,
    getTracking: store.getTracking,
    commitTracking: store.commitTracking,
    cancelReminderForPrayer: spies.cancelReminderForPrayer,
  });
  usePrayerRewardRecovery({
    loaded,
    records: store.tracking.records,
    getGamification: workflow.getGamification,
    completePrayer: workflow.completePrayer,
  });
  const prompt = usePrayerCompletionPrompt({
    today: PRAYER_TEST_DATE,
    timetable,
    completePrayer: workflow.completePrayer,
    showNotice: spies.showNotice,
  });
  return { tracking: store.tracking, tasks, gamification, workflow, prompt };
}

function renderCompletion(props: Parameters<typeof useCompletionHarness>[0] = { loaded: true }) {
  return renderHook(current => useCompletionHarness(current), { initialProps: props });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Dhuhr runs from 11:55Z until Asr at 15:20Z.
  vi.setSystemTime(new Date('2026-09-26T12:30:00Z'));
  Object.values(spies).forEach(spy => spy.mockClear());
});

describe('prayer completion workflow', () => {
  it('records the outcome, grants XP once, ticks the prayer task and cancels its reminder', () => {
    const { result } = renderCompletion();

    let completion!: ReturnType<typeof result.current.workflow.completePrayer>;
    act(() => { completion = result.current.workflow.completePrayer('Dhuhr', 'on_time', { source: 'dashboard' }); });

    expect(completion).toMatchObject({ prayerName: 'Dhuhr', prayerDate: PRAYER_TEST_DATE, status: 'on_time' });
    expect(completion.xpEarned).toBeGreaterThan(0);
    expect(result.current.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'on_time', source: 'dashboard' });
    expect(result.current.gamification.totalXp).toBe(completion.xpEarned);
    expect(result.current.gamification.prayerCompletionLedger?.[DHUHR_KEY]?.rewarded).toBe(true);
    expect(result.current.tasks[0].completed).toBe(true);
    expect(spies.cancelReminderForPrayer).toHaveBeenCalledWith(PRAYER_TEST_DATE, 'Dhuhr');

    let repeat!: ReturnType<typeof result.current.workflow.completePrayer>;
    act(() => { repeat = result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    expect(repeat.xpEarned).toBe(0);
    expect(result.current.gamification.totalXp).toBe(completion.xpEarned);
  });

  it('refuses a prayer that has not started and changes nothing', () => {
    vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));
    const { result } = renderCompletion();

    expect(() => result.current.workflow.completePrayer('Dhuhr', 'on_time'))
      .toThrow(PrayerCompletionRejectedError);
    expect(result.current.tracking.records).toEqual({});
    expect(result.current.gamification.totalXp).toBe(0);
    expect(spies.updateTask).not.toHaveBeenCalled();
    expect(spies.cancelReminderForPrayer).not.toHaveBeenCalled();
  });

  it('undoes a completion across tracking and gamification', () => {
    const { result } = renderCompletion();
    let completion!: ReturnType<typeof result.current.workflow.completePrayer>;
    act(() => { completion = result.current.workflow.completePrayer('Dhuhr', 'on_time'); });

    act(() => result.current.workflow.undoPrayerCompletion(completion.undo));

    expect(result.current.tracking.records[DHUHR_KEY]).toBeUndefined();
    expect(result.current.gamification.totalXp).toBe(0);
  });

  it('corrects an outcome without granting XP and unticks today\'s task', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    const xpAfterCompletion = result.current.gamification.totalXp;

    act(() => result.current.workflow.correctPrayerOutcome(PRAYER_TEST_DATE, 'Dhuhr', 'missed'));

    expect(result.current.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'missed' });
    expect(result.current.gamification.totalXp).toBeLessThanOrEqual(xpAfterCompletion);
    expect(result.current.tasks[0].completed).toBe(false);
  });

  it('gives back the reward of a completion the prayer service refused outright', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    const refused = result.current.tracking.records[DHUHR_KEY];

    act(() => result.current.workflow.revertRefusedOutcome({
      key: DHUHR_KEY, record: refused, confirmed: undefined, message: 'Dhuhr has not started yet.',
    }));

    expect(result.current.tracking.records[DHUHR_KEY]).toBeUndefined();
    expect(result.current.gamification.prayerCompletionLedger?.[DHUHR_KEY]).toBeUndefined();
    expect(result.current.gamification.totalXp).toBe(0);
    expect(result.current.tasks[0].completed).toBe(false);
  });

  it('keeps the reward when the service refused only a change to a confirmed outcome', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    const confirmed = result.current.tracking.records[DHUHR_KEY];
    const xp = result.current.gamification.totalXp;

    act(() => result.current.workflow.revertRefusedOutcome({
      key: DHUHR_KEY, record: { ...confirmed, status: 'late' }, confirmed, message: 'Dhuhr is still on time.',
    }));

    expect(result.current.tracking.records[DHUHR_KEY]).toBe(confirmed);
    expect(result.current.gamification.totalXp).toBe(xp);
  });
});

describe('prayer reward recovery', () => {
  const rewardedDhuhr: PrayerTrackingRecord = {
    date: PRAYER_TEST_DATE,
    prayerName: 'Dhuhr',
    status: 'on_time',
    recordedAt: '2026-09-26T12:10:00.000Z',
    source: 'dashboard',
    rewarded: true,
  };

  it('re-applies a rewarded outcome whose ledger receipt is missing, once', () => {
    const { result, rerender } = renderCompletion({ loaded: false, initialRecords: { [DHUHR_KEY]: rewardedDhuhr } });
    expect(result.current.gamification.totalXp).toBe(0);

    rerender({ loaded: true, initialRecords: { [DHUHR_KEY]: rewardedDhuhr } });

    expect(result.current.gamification.prayerCompletionLedger?.[DHUHR_KEY]?.rewarded).toBe(true);
    const recoveredXp = result.current.gamification.totalXp;
    expect(recoveredXp).toBeGreaterThan(0);

    rerender({ loaded: true, initialRecords: { [DHUHR_KEY]: rewardedDhuhr } });
    expect(result.current.gamification.totalXp).toBe(recoveredXp);
  });

  it('recovers a reward even before the prayer would be completable now', () => {
    vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));
    const { result } = renderCompletion({ loaded: true, initialRecords: { [DHUHR_KEY]: rewardedDhuhr } });
    expect(result.current.gamification.prayerCompletionLedger?.[DHUHR_KEY]?.rewarded).toBe(true);
  });
});

describe('prayer completion prompt', () => {
  it('refuses to open for a prayer that has not started and says why', () => {
    vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));
    const { result } = renderCompletion();

    act(() => result.current.prompt.requestPrayerCompletion('Dhuhr', { source: 'dashboard' }));

    expect(result.current.prompt.pendingCompletion).toBeNull();
    expect(spies.showNotice).toHaveBeenCalledWith('Dhuhr has not started yet.');
  });

  it('suggests the status from the deadline and completes on confirm', () => {
    const { result } = renderCompletion();
    const onCompleted = vi.fn();

    act(() => result.current.prompt.requestPrayerCompletion('Dhuhr', { source: 'dashboard', onCompleted }));
    expect(spies.showNotice).toHaveBeenCalledWith(null);
    expect(result.current.prompt.pendingCompletion).toMatchObject({
      prayerName: 'Dhuhr', prayerDate: PRAYER_TEST_DATE, suggestedStatus: 'on_time',
    });

    let confirmed: unknown;
    act(() => { confirmed = result.current.prompt.confirmPrayerCompletion('late'); });

    expect(confirmed).toMatchObject({ prayerName: 'Dhuhr', status: 'late' });
    expect(onCompleted).toHaveBeenCalledWith(confirmed);
    expect(result.current.prompt.pendingCompletion).toBeNull();
    expect(result.current.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'late' });
  });

  it('closes and explains a confirmation the prayer-time rule refuses', () => {
    const { result } = renderCompletion();
    act(() => result.current.prompt.requestPrayerCompletion('Dhuhr', { source: 'dashboard' }));
    vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));

    let confirmed: unknown;
    act(() => { confirmed = result.current.prompt.confirmPrayerCompletion('on_time'); });

    expect(confirmed).toBeNull();
    expect(result.current.prompt.pendingCompletion).toBeNull();
    expect(spies.showNotice).toHaveBeenLastCalledWith('Dhuhr has not started yet.');
  });
});

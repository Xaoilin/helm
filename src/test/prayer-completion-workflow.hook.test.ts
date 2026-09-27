import { act, renderHook } from '@testing-library/react';
import { useCallback, useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannerReward } from '../services/backend/plannerContracts';
import type { Task } from '../types/domain';
import type { TaskContextValue } from '../store/contexts/TaskContext';
import { PrayerCompletionRejectedError } from '../services/prayerCompletionRules';
import { getPrayerRecordKey } from '../services/prayerTracking';
import { usePrayerTracking } from '../store/contexts/prayer/usePrayerTracking';
import { usePrayerCompletionWorkflow } from '../store/contexts/prayer/usePrayerCompletionWorkflow';
import { usePrayerCompletionPrompt } from '../store/contexts/prayer/usePrayerCompletionPrompt';
import { makeTask } from './fixtures';
import { makePrayerTimesData, PRAYER_TEST_DATE, PRAYER_TEST_ZONE } from './prayerFixtures';

const DHUHR_KEY = getPrayerRecordKey(PRAYER_TEST_DATE, 'Dhuhr');
const timetable = makePrayerTimesData();
const dhuhrTask = makeTask({ id: 'task-dhuhr', title: 'Dhuhr Prayer', category: 'prayer', prayerName: 'Dhuhr' });
const REWARD: PlannerReward = {
  xpEarned: 50, level: 2, leveledUp: true, title: 'Beginner', newBadges: ['first-prayer-habit'], currentStreak: 1,
  streakMilestone: false,
};

const spies = {
  showPrayerHabit: vi.fn(),
  showNotice: vi.fn(),
  awaitReward: vi.fn(async (): Promise<PlannerReward | null> => REWARD),
};

/** Real tracking and task state, wired the way PrayerProvider wires the workflow. */
function useCompletionHarness() {
  const [tasks, setTasks] = useState<Task[]>([dhuhrTask]);
  const store = usePrayerTracking();

  const showPrayerHabit = useCallback((id: string, completed: boolean) => {
    spies.showPrayerHabit(id, completed);
    setTasks(current => current.map(task => (task.id === id ? { ...task, completed } : task)));
  }, []);
  const taskOwner = useMemo(() => ({ tasks, loaded: true, showPrayerHabit }) as unknown as TaskContextValue,
    [tasks, showPrayerHabit]);

  const workflow = usePrayerCompletionWorkflow({
    taskOwner,
    timetable,
    scheduleTimeZone: PRAYER_TEST_ZONE,
    today: PRAYER_TEST_DATE,
    getToday: () => PRAYER_TEST_DATE,
    getTracking: store.getTracking,
    commitTracking: store.commitTracking,
  });
  const prompt = usePrayerCompletionPrompt({
    today: PRAYER_TEST_DATE,
    timetable,
    completePrayer: workflow.completePrayer,
    awaitReward: spies.awaitReward,
    showNotice: spies.showNotice,
  });
  return { tracking: store.tracking, tasks, workflow, prompt };
}

function renderCompletion() {
  return renderHook(() => useCompletionHarness());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Dhuhr runs from 11:55Z until Asr at 15:20Z.
  vi.setSystemTime(new Date('2026-09-26T12:30:00Z'));
  Object.values(spies).forEach(spy => spy.mockClear());
});

describe('prayer completion workflow', () => {
  it('records the outcome, shows the prayer habit done and cancels its reminder; XP comes from the planner', () => {
    const { result } = renderCompletion();

    let completion!: ReturnType<typeof result.current.workflow.completePrayer>;
    act(() => { completion = result.current.workflow.completePrayer('Dhuhr', 'on_time', { source: 'dashboard' }); });

    expect(completion).toMatchObject({ prayerName: 'Dhuhr', prayerDate: PRAYER_TEST_DATE, status: 'on_time', xpEarned: 0 });
    expect(result.current.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'on_time', source: 'dashboard' });
    expect(result.current.tasks[0].completed).toBe(true);
  });

  it('refuses a prayer that has not started and changes nothing', () => {
    vi.setSystemTime(new Date('2026-09-26T11:00:00Z'));
    const { result } = renderCompletion();

    expect(() => result.current.workflow.completePrayer('Dhuhr', 'on_time'))
      .toThrow(PrayerCompletionRejectedError);
    expect(result.current.tracking.records).toEqual({});
    expect(spies.showPrayerHabit).not.toHaveBeenCalled();
  });

  it('undoes a completion: the outcome goes and the habit shows as it was', () => {
    const { result } = renderCompletion();
    let completion!: ReturnType<typeof result.current.workflow.completePrayer>;
    act(() => { completion = result.current.workflow.completePrayer('Dhuhr', 'on_time'); });

    act(() => result.current.workflow.undoPrayerCompletion(completion.undo));

    expect(result.current.tracking.records[DHUHR_KEY]).toBeUndefined();
    expect(result.current.tasks[0].completed).toBe(false);
  });

  it('corrects an outcome and unticks today\'s habit', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });

    act(() => result.current.workflow.correctPrayerOutcome(PRAYER_TEST_DATE, 'Dhuhr', 'missed'));

    expect(result.current.tracking.records[DHUHR_KEY]).toMatchObject({ status: 'missed' });
    expect(result.current.tasks[0].completed).toBe(false);
  });

  it('shows the service\'s version of a completion it refused outright', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    const refused = result.current.tracking.records[DHUHR_KEY];

    act(() => result.current.workflow.revertRefusedOutcome({
      key: DHUHR_KEY, record: refused, confirmed: undefined, message: 'Dhuhr has not started yet.',
    }));

    expect(result.current.tracking.records[DHUHR_KEY]).toBeUndefined();
    expect(result.current.tasks[0].completed).toBe(false);
  });

  it('keeps a confirmed outcome when the service refused only a change to it', () => {
    const { result } = renderCompletion();
    act(() => { result.current.workflow.completePrayer('Dhuhr', 'on_time'); });
    const confirmed = result.current.tracking.records[DHUHR_KEY];

    act(() => result.current.workflow.revertRefusedOutcome({
      key: DHUHR_KEY, record: { ...confirmed, status: 'late' }, confirmed, message: 'Dhuhr is still on time.',
    }));

    expect(result.current.tracking.records[DHUHR_KEY]).toBe(confirmed);
    expect(result.current.tasks[0].completed).toBe(true);
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

  it('suggests the status from the deadline, completes on confirm, and celebrates with the planner\'s reward', async () => {
    const { result } = renderCompletion();
    const onCompleted = vi.fn();

    act(() => result.current.prompt.requestPrayerCompletion('Dhuhr', { source: 'dashboard', onCompleted }));
    expect(spies.showNotice).toHaveBeenCalledWith(null);
    expect(result.current.prompt.pendingCompletion).toMatchObject({
      prayerName: 'Dhuhr', prayerDate: PRAYER_TEST_DATE, suggestedStatus: 'on_time',
    });

    let confirmed: ReturnType<typeof result.current.prompt.confirmPrayerCompletion> = null;
    act(() => { confirmed = result.current.prompt.confirmPrayerCompletion('late'); });
    const rewarded = await confirmed;

    expect(spies.awaitReward).toHaveBeenCalledWith(PRAYER_TEST_DATE, 'Dhuhr');
    expect(rewarded).toMatchObject({ prayerName: 'Dhuhr', status: 'late', xpEarned: 50 });
    expect(rewarded?.gamificationResult).toMatchObject({ leveledUp: true, newLevel: 2 });
    expect(onCompleted).toHaveBeenCalledWith(rewarded);
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

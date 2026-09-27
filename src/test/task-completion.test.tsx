import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskProvider, useTaskContext } from '../store/contexts/TaskContext';
import type { Task } from '../types/domain';
import { makeGamification } from './fixtures';

const planner = vi.hoisted(() => ({
  isPlannerServiceEnabled: () => true,
  getTasks: vi.fn(),
  saveTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  unlinkProjectTasks: vi.fn(),
  taskDetails: (task: Partial<Task>) => ({ title: task.title, category: task.category, priority: task.priority }),
}));
const applyProfile = vi.hoisted(() => vi.fn());

vi.mock('../services/backend/plannerServiceApi', () => planner);
vi.mock('../store/contexts/GamificationContext', () => ({ useGamificationContext: () => ({ applyProfile }) }));
vi.mock('../store/contexts/SettingsContext', () => ({
  useSettingsContext: () => ({ appTimeZone: { effectiveTimeZone: 'Europe/London' } }),
}));

const SAVED: Task = {
  id: 'late', title: 'Late task', description: '', completed: false, priority: 'medium', category: 'task',
  createdAt: '2026-06-03T22:00:00.000Z', updatedAt: '2026-06-03T22:00:00.000Z',
};

/** Completion is the planner service's write: it stamps the date in the app's zone and rewards it. */
describe('task completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planner.getTasks.mockResolvedValue([SAVED]);
    planner.completeTask.mockResolvedValue({
      task: { ...SAVED, completed: true, completedAt: '2026-06-03T23:30:00.000Z', completedLocalDate: '2026-06-04',
        completionTimeZone: 'Europe/London' },
      reward: { xpEarned: 10, level: 1, leveledUp: false, title: 'Beginner', newBadges: [], currentStreak: 1,
        streakMilestone: false },
      profile: { ...makeGamification(), totalXp: 10 },
    });
    planner.reopenTask.mockResolvedValue(SAVED);
  });

  async function render() {
    const view = renderHook(() => useTaskContext(), {
      wrapper: ({ children }) => <TaskProvider>{children}</TaskProvider>,
    });
    await waitFor(() => expect(view.result.current.tasks).toHaveLength(1));
    return view;
  }

  it('shows the date the service stamped in the app zone across the BST midnight boundary, and what it earned', async () => {
    const { result } = await render();

    let reward: Awaited<ReturnType<typeof result.current.completeTask>> = null;
    await act(async () => { reward = await result.current.completeTask('late'); });

    expect(planner.completeTask).toHaveBeenCalledExactlyOnceWith('late', 'Europe/London');
    expect(result.current.tasks[0]).toMatchObject({ completedLocalDate: '2026-06-04', completionTimeZone: 'Europe/London' });
    expect(reward).toMatchObject({ xpEarned: 10 });
    expect(applyProfile).toHaveBeenCalledWith({ ...makeGamification(), totalXp: 10 });
  });

  it('completes and reopens through the service when a completed flag is saved', async () => {
    const { result } = await render();

    await act(async () => { result.current.updateTask('late', { completed: true }); });
    await waitFor(() => expect(planner.completeTask).toHaveBeenCalledOnce());
    await act(async () => { result.current.updateTask('late', { completed: false }); });

    await waitFor(() => expect(planner.reopenTask).toHaveBeenCalledExactlyOnceWith('late'));
    expect(planner.saveTask).not.toHaveBeenCalled();
  });

  it('never completes a prayer habit itself: the prayer service records the prayer', async () => {
    planner.getTasks.mockResolvedValue([{ ...SAVED, id: 'fajr', category: 'prayer', prayerName: 'Fajr' }]);
    const { result } = await render();

    act(() => result.current.updateTask('fajr', { completed: true }));
    act(() => result.current.showPrayerHabit('fajr', true));

    expect(planner.completeTask).not.toHaveBeenCalled();
    expect(result.current.tasks[0].completed).toBe(true);
  });
});

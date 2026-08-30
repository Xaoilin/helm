import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskProvider, useTaskContext } from '../store/contexts/TaskContext';

const persistenceMocks = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStore: vi.fn(),
}));

vi.mock('../store/persistence', () => persistenceMocks);
vi.mock('../store/contexts/useRemoteStoreRefresh', () => ({
  useRemoteStoreRefresh: vi.fn(),
}));
vi.mock('../store/contexts/SettingsContext', () => ({
  useSettingsContext: () => ({
    appTimeZone: { effectiveTimeZone: 'Europe/London' },
  }),
}));

describe('task completion dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.loadStore.mockResolvedValue([]);
    persistenceMocks.saveStore.mockResolvedValue(undefined);
  });

  it('persists the true source-local date across the BST midnight boundary', async () => {
    const { result } = renderHook(() => useTaskContext(), {
      wrapper: ({ children }) => <TaskProvider>{children}</TaskProvider>,
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let taskId = '';
    act(() => {
      taskId = result.current.addTask({
        title: 'Late task',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
      });
    });
    act(() => {
      result.current.updateTask(taskId, {
        completed: true,
        completedAt: '2026-06-03T23:30:00.000Z',
      });
    });

    expect(result.current.tasks[0]).toMatchObject({
      completedAt: '2026-06-03T23:30:00.000Z',
      completedLocalDate: '2026-06-04',
      completionTimeZone: 'Europe/London',
    });

    act(() => result.current.updateTask(taskId, { completed: false }));
    expect(result.current.tasks[0].completedLocalDate).toBeUndefined();
    expect(result.current.tasks[0].completionTimeZone).toBeUndefined();
  });
});

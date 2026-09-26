import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskCtx, useTaskContext, type TaskContextValue } from '../store/contexts/TaskContext';
import { SettingsCtx, useSettingsContext, type SettingsContextValue } from '../store/contexts/SettingsContext';
import { provide, renderHookWithContexts, renderWithContexts } from './renderWithContexts';
import { makeTask } from './fixtures';

function fakeTasks(overrides: Partial<TaskContextValue> = {}): TaskContextValue {
  return {
    tasks: [],
    loaded: true,
    addTask: () => 'task-id',
    updateTask: () => undefined,
    removeTask: () => undefined,
    setTasks: () => undefined,
    ...overrides,
  };
}

function TaskCount() {
  const { tasks } = useTaskContext();
  return <p>{tasks.length} tasks</p>;
}

describe('renderWithContexts', () => {
  it('supplies a typed fake context value without mounting the real provider', () => {
    renderWithContexts(<TaskCount />, [provide(TaskCtx, fakeTasks({ tasks: [makeTask(), makeTask({ id: 'task-second' })] }))]);

    expect(screen.getByText('2 tasks')).toBeInTheDocument();
  });

  it('stacks several contexts for a hook', () => {
    const settings = { appTimeZone: { effectiveTimeZone: 'Europe/London' } } as SettingsContextValue;
    const { result } = renderHookWithContexts(
      () => ({ tasks: useTaskContext().tasks, zone: useSettingsContext().appTimeZone.effectiveTimeZone }),
      [provide(SettingsCtx, settings), provide(TaskCtx, fakeTasks())],
    );

    expect(result.current).toEqual({ tasks: [], zone: 'Europe/London' });
  });

  it('still fails loudly when a component reads a context nobody provided', () => {
    expect(() => renderWithContexts(<TaskCount />, [])).toThrow();
  });
});

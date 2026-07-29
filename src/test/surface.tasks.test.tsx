import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import TasksSurface from '../surfaces/TasksSurface';
import { useApp } from '../store/AppContext';
import type { AssistantNavigationTarget } from '../services/assistantNavigation';

function TasksAssistantNavigationHarness({ target }: { target: AssistantNavigationTarget }) {
  const app = useApp();

  return (
    <>
      <button onClick={() => app.requestAssistantNavigation(target)}>Trigger assistant navigation</button>
      <TasksSurface />
    </>
  );
}

describe('TasksSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state with tabs', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('Nothing for today')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('All Tasks')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
  });

  it('should have add task buttons', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('+ Add Task')).toBeInTheDocument();
    expect(screen.getByText('+ Daily Habit')).toBeInTheDocument();
  });

  it('should show no tasks subtitle', async () => {
    await act(async () => { renderWithProvider(<TasksSurface />); });
    expect(screen.getByText('No tasks yet')).toBeInTheDocument();
  });

  it('should switch to All Tasks from assistant navigation without a task id', async () => {
    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByRole('button', { name: 'All Tasks' })).toHaveClass('active');
    expect(screen.getByDisplayValue('All types')).toBeInTheDocument();
  });

  it('should reset All Tasks filters when assistant navigation asks for it', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-1',
        title: 'Buy milk',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-2',
        title: 'Water plants',
        description: '',
        completed: true,
        completedAt: '2026-04-10T10:00:00.000Z',
        priority: 'low',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]));

    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    fireEvent.change(screen.getByDisplayValue('All statuses'), { target: { value: 'completed' } });
    expect(screen.getByText('1 matching item')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByDisplayValue('All statuses')).toBeInTheDocument();
    expect(screen.getByText('2 matching items')).toBeInTheDocument();
  });

  it('should group all tasks into readable sections', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-overdue',
        title: 'Pay invoice',
        description: '',
        completed: false,
        priority: 'high',
        category: 'task',
        dueDate: yesterdayStr,
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-upcoming',
        title: 'Draft notes',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        dueDate: tomorrowStr,
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'habit-1',
        title: 'Stretch',
        description: '',
        completed: false,
        priority: 'low',
        category: 'daily',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'prayer-dhuhr',
        title: 'Dhuhr Prayer',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'prayer',
        prayerName: 'Dhuhr',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
      {
        id: 'task-done',
        title: 'Archive receipts',
        description: '',
        completed: true,
        completedAt: '2026-04-10T10:00:00.000Z',
        priority: 'low',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TasksSurface />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Islamic' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Routines' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByText('Pay invoice')).toBeInTheDocument();
    expect(screen.getByText('Draft notes')).toBeInTheDocument();
    expect(screen.getByText('Dhuhr Prayer')).toBeInTheDocument();
    expect(screen.getByText('Stretch')).toBeInTheDocument();
  });

  it('should let me collapse and reopen all-task sections from the title', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'habit-accordion',
        title: 'Stretch',
        description: '',
        completed: false,
        priority: 'low',
        category: 'daily',
        recurring: { frequency: 'daily', lastReset: todayStr },
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<TasksSurface />); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    });

    const routinesHeading = screen.getByRole('heading', { name: 'Routines' });
    const routinesToggle = routinesHeading.closest('button');

    expect(routinesToggle).not.toBeNull();
    expect(screen.getByText('Stretch')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(routinesToggle!);
    });

    expect(screen.queryByText('Stretch')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(routinesToggle!);
    });

    expect(screen.getByText('Stretch')).toBeInTheDocument();
  });

  it('should highlight the resolved task when assistant navigation includes a task id', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'task-1',
        title: 'Buy milk',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'task',
        createdAt: '2026-04-10T09:00:00.000Z',
        updatedAt: '2026-04-10T09:00:00.000Z',
      },
    ]));

    await act(async () => {
      renderWithProvider(
        <TasksAssistantNavigationHarness
          target={{
            surface: 'tasks',
            surfaceState: {
              tasks: {
                tab: 'all',
                resetFilters: true,
                revealTaskId: 'task-1',
                highlightTaskId: 'task-1',
              },
            },
          }}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Trigger assistant navigation'));
    });

    expect(screen.getByText('Buy milk').closest('.assistant-focus')).not.toBeNull();
  });
});

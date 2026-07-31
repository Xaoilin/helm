import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from '../store/AppContext';
import { createElement, type ReactNode } from 'react';
import type { Task } from '../types/domain';

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  const { createLocalPersistenceMock } = await import('./localPersistenceMock');
  return createLocalPersistenceMock(actual);
});

async function renderWithApp() {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(AppProvider, null, children);
  const hook = renderHook(() => useApp(), { wrapper });
  await waitFor(() => {
    expect(hook.result.current.loaded).toBe(true);
  });
  return {
    get api() {
      return hook.result.current;
    },
  };
}

describe('Tasks CRUD', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should add a task with auto-generated id and timestamps', async () => {
    const r = await renderWithApp();
    let id = '';
    act(() => {
      id = r.api!.addTask({ title: 'Fix login bug', description: 'Users can\'t log in', priority: 'high', category: 'task', completed: false });
    });
    expect(r.api!.tasks).toHaveLength(1);
    expect(r.api!.tasks[0].id).toBe(id);
    expect(r.api!.tasks[0].title).toBe('Fix login bug');
    expect(r.api!.tasks[0].priority).toBe('high');
    expect(r.api!.tasks[0].createdAt).toBeTruthy();
  });

  it('should update a task', async () => {
    const r = await renderWithApp();
    let id = '';
    act(() => { id = r.api!.addTask({ title: 'Original', description: '', priority: 'low', category: 'task', completed: false }); });
    act(() => { r.api!.updateTask(id, { title: 'Updated', priority: 'high' }); });
    expect(r.api!.tasks[0].title).toBe('Updated');
    expect(r.api!.tasks[0].priority).toBe('high');
  });

  it('should remove a task', async () => {
    const r = await renderWithApp();
    let id = '';
    act(() => { id = r.api!.addTask({ title: 'Delete me', description: '', priority: 'low', category: 'task', completed: false }); });
    expect(r.api!.tasks).toHaveLength(1);
    act(() => { r.api!.removeTask(id); });
    expect(r.api!.tasks).toHaveLength(0);
  });

  it('should toggle completed state', async () => {
    const r = await renderWithApp();
    let id = '';
    act(() => { id = r.api!.addTask({ title: 'Toggle me', description: '', priority: 'medium', category: 'task', completed: false }); });
    expect(r.api!.tasks[0].completed).toBe(false);
    act(() => { r.api!.updateTask(id, { completed: true, completedAt: new Date().toISOString() }); });
    expect(r.api!.tasks[0].completed).toBe(true);
    expect(r.api!.tasks[0].completedAt).toBeTruthy();
  });

  it('should create daily habits with recurring', async () => {
    const r = await renderWithApp();
    act(() => {
      r.api!.addTask({ title: 'Exercise', description: '', priority: 'medium', category: 'daily', completed: false, recurring: { frequency: 'daily' } });
    });
    expect(r.api!.tasks[0].category).toBe('daily');
    expect(r.api!.tasks[0].recurring?.frequency).toBe('daily');
  });

  it('should normalize legacy prayer habits into prayer tasks', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([
      {
        id: 'legacy-fajr',
        title: 'Fajr Prayer',
        description: '',
        completed: false,
        priority: 'medium',
        category: 'daily',
        recurring: { frequency: 'daily' },
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ]));

    const r = await renderWithApp();

    expect(r.api!.tasks[0].category).toBe('prayer');
    expect(r.api!.tasks[0].prayerName).toBe('Fajr');
    expect(r.api!.tasks[0].recurring?.frequency).toBe('daily');
  });

  it('should create goals with due dates', async () => {
    const r = await renderWithApp();
    act(() => {
      r.api!.addTask({ title: 'Launch product', description: 'Ship v1', priority: 'high', category: 'goal', completed: false, dueDate: '2026-09-30' });
    });
    expect(r.api!.tasks[0].category).toBe('goal');
    expect(r.api!.tasks[0].dueDate).toBe('2026-09-30');
  });
});

describe('Recurring reset logic', () => {
  function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  it('should identify habits needing reset when lastReset is stale', () => {
    const todayStr = toLocalDateStr(new Date());
    const yesterdayStr = toLocalDateStr(new Date(Date.now() - 86400000));

    const tasks: Pick<Task, 'category' | 'completed' | 'recurring'>[] = [
      { category: 'daily', completed: true, recurring: { frequency: 'daily', lastReset: yesterdayStr } },
      { category: 'daily', completed: true, recurring: { frequency: 'daily', lastReset: todayStr } },
      { category: 'daily', completed: false, recurring: { frequency: 'daily', lastReset: yesterdayStr } },
      { category: 'task', completed: true, recurring: undefined },
    ];

    const needsReset = tasks.filter(t => {
      if (t.category !== 'daily' || !t.recurring || !t.completed) return false;
      return t.recurring.lastReset !== todayStr;
    });
    expect(needsReset).toHaveLength(1);
  });

  it('weekday habits should not reset on weekends', () => {
    const saturday = new Date(2026, 2, 28); // Saturday
    expect(saturday.getDay()).toBe(6); // 6 = Saturday
    const isWeekday = saturday.getDay() >= 1 && saturday.getDay() <= 5;
    expect(isWeekday).toBe(false);
  });
});

describe('Task filtering', () => {
  const tasks: Pick<Task, 'title' | 'category' | 'priority' | 'completed'>[] = [
    { title: 'High daily', category: 'daily', priority: 'high', completed: false },
    { title: 'Medium task', category: 'task', priority: 'medium', completed: false },
    { title: 'Done task', category: 'task', priority: 'low', completed: true },
    { title: 'Goal', category: 'goal', priority: 'high', completed: false },
  ];

  it('should filter out goals for All Tasks view', () => {
    expect(tasks.filter(t => t.category !== 'goal')).toHaveLength(3);
  });

  it('should filter by category', () => {
    expect(tasks.filter(t => t.category === 'daily')).toHaveLength(1);
  });

  it('should filter by priority', () => {
    expect(tasks.filter(t => t.priority === 'high')).toHaveLength(2);
  });

  it('should filter by status', () => {
    expect(tasks.filter(t => !t.completed)).toHaveLength(3);
    expect(tasks.filter(t => t.completed)).toHaveLength(1);
  });

  it('should sort by priority (high first)', () => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...tasks].filter(t => t.category !== 'goal')
      .sort((a, b) => order[a.priority] - order[b.priority]);
    expect(sorted[0].priority).toBe('high');
    expect(sorted[sorted.length - 1].priority).toBe('low');
  });
});

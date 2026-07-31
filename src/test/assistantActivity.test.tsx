import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import type { ActionPlan } from '../assistant/plannerSchema';
import type { AssistantActionHandlers, AssistantCommandContext } from '../assistant/shared';
import { AppProvider, useApp } from '../store/AppContext';
import { DEFAULT_PROFILE } from '../services/gamification';
import { toLocalDateStr } from '../services/financeHelpers';
import { setPrayerReminderReceipt } from '../services/prayerTracking';
import { usePrayerContext } from '../store/contexts/PrayerContext';

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  const { createLocalPersistenceMock } = await import('./localPersistenceMock');
  return createLocalPersistenceMock(actual);
});

function makeContext(): AssistantCommandContext {
  return {
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    tasks: [],
    financeAccounts: [],
    transactions: [],
    knowledgeEntries: [],
    knowledgeTopics: [],
    lifestyleItems: [],
    projects: [],
    gamification: DEFAULT_PROFILE,
    goalTags: [],
    currentSurface: 'chat',
    timezone: 'Europe/London',
    now: new Date('2026-04-24T09:00:00.000Z'),
  };
}

function ActivityUndoHarness() {
  const app = useApp();
  const [result, setResult] = useState('');

  return (
    <div>
      <div data-testid="task-count">{app.tasks.length}</div>
      <div data-testid="activity-count">{app.assistantActivityLog.length}</div>
      <div data-testid="activity-status">{app.assistantActivityLog[0]?.status || 'none'}</div>
      <div data-testid="undo-result">{result}</div>
      <button
        type="button"
        onClick={() => {
          const taskId = app.addTask({
            title: 'Audit task',
            description: '',
            completed: false,
            priority: 'medium',
            category: 'task',
          });
          app.recordAssistantActivity({
            actor: 'voice',
            domain: 'tasks',
            action: 'created',
            summary: 'Created task "Audit task".',
            details: ['Created the task "Audit task".'],
            entityRefs: [{ kind: 'task', id: taskId, label: 'Audit task', surface: 'tasks' }],
            sourceSurface: 'dashboard',
            sourceTranscript: 'add audit task',
            undoOperation: { type: 'task.delete', id: taskId },
          });
        }}
      >
        Record Task
      </button>
      <button
        type="button"
        onClick={() => {
          const entry = app.assistantActivityLog[0];
          if (!entry) return;
          setResult(app.undoAssistantActivity(entry.id).message);
        }}
      >
        Undo Latest
      </button>
    </div>
  );
}

function seedPrayerUndoTasks() {
  const now = new Date().toISOString();
  localStorage.setItem('helm:settings', JSON.stringify({
    prayerEnabled: false,
    theme: 'dark',
    dataRetentionDays: 90,
    telemetry: false,
    assistantProvider: 'ollama',
  }));
  localStorage.setItem('helm:tasks', JSON.stringify([
    {
      id: 'prayer-fajr',
      title: 'Fajr Prayer',
      description: '',
      completed: false,
      priority: 'medium',
      category: 'prayer',
      prayerName: 'Fajr',
      recurring: { frequency: 'daily' },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prayer-dhuhr',
      title: 'Dhuhr Prayer',
      description: '',
      completed: false,
      priority: 'medium',
      category: 'prayer',
      prayerName: 'Dhuhr',
      recurring: { frequency: 'daily' },
      createdAt: now,
      updatedAt: now,
    },
  ]));
}

function PrayerUndoHarness() {
  const app = useApp();
  const prayer = usePrayerContext();
  const [activityId, setActivityId] = useState('');
  const today = toLocalDateStr(new Date());
  const fajrOutcome = prayer.getOutcome(today, 'Fajr');
  const dhuhrOutcome = prayer.getOutcome(today, 'Dhuhr');

  return (
    <div>
      <div data-testid="fajr-outcome">{fajrOutcome?.status || 'none'}</div>
      <div data-testid="dhuhr-outcome">{dhuhrOutcome?.status || 'none'}</div>
      <div data-testid="reminder-receipts">
        {Object.keys(prayer.tracking.reminderReceipts).length}
      </div>
      <div data-testid="prayer-xp">{app.gamification.totalXp}</div>
      <div data-testid="prayer-completed-total">{app.gamification.totalTasksCompleted}</div>
      <div data-testid="prayer-daily-log">
        {(app.gamification.dailyLog?.[today] || []).join(',')}
      </div>
      <div data-testid="fajr-task">
        {String(app.tasks.find(task => task.id === 'prayer-fajr')?.completed)}
      </div>
      <div data-testid="fajr-description">
        {app.tasks.find(task => task.id === 'prayer-fajr')?.description}
      </div>
      <div data-testid="fajr-priority">
        {app.tasks.find(task => task.id === 'prayer-fajr')?.priority}
      </div>
      <div data-testid="dhuhr-task">
        {String(app.tasks.find(task => task.id === 'prayer-dhuhr')?.completed)}
      </div>
      <button
        type="button"
        onClick={() => {
          const result = app.completePrayer('Fajr', 'on_time', 'prayer-fajr', 'chat');
          setActivityId(app.recordAssistantActivity({
            actor: 'chat',
            domain: 'tasks',
            action: 'completed',
            summary: 'Completed Fajr.',
            details: ['Completed Fajr on time.'],
            entityRefs: [{
              kind: 'task',
              id: 'prayer-fajr',
              label: 'Fajr Prayer',
              surface: 'tasks',
            }],
            undoOperation: {
              type: 'prayer.complete',
              inverse: result.undo,
            },
          }));
        }}
      >
        Complete Fajr
      </button>
      <button
        type="button"
        onClick={() => app.completePrayer('Dhuhr', 'on_time', 'prayer-dhuhr', 'tasks')}
      >
        Complete Dhuhr
      </button>
      <button
        type="button"
        onClick={() => app.updateTask('prayer-fajr', {
          description: 'Edited after completion',
          priority: 'high',
        })}
      >
        Edit Fajr
      </button>
      <button
        type="button"
        onClick={() => {
          const deadline = new Date();
          deadline.setHours(23, 59, 0, 0);
          prayer.replacePrayerTracking(setPrayerReminderReceipt(prayer.tracking, {
            date: today,
            prayerName: 'Dhuhr',
            deadlineAt: deadline,
            notifiedAt: new Date(),
          }));
        }}
      >
        Add Dhuhr Receipt
      </button>
      <button
        type="button"
        onClick={() => {
          if (activityId) app.undoAssistantActivity(activityId);
        }}
      >
        Undo Fajr
      </button>
    </div>
  );
}

describe('assistant activity log', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('records assistant task creation with source metadata and an undo operation', () => {
    const recordAssistantActivity = vi.fn();
    const handlers = {
      addTask: vi.fn(() => 'task-activity-1'),
      updateTask: vi.fn(),
      recordAssistantActivity,
    } satisfies AssistantActionHandlers;
    const plan: ActionPlan = {
      mode: 'act',
      response: 'Adding that task.',
      confidence: 1,
      steps: [{
        capability: 'tasks.create_task',
        args: {
          title: 'Buy milk',
          priority: 'medium',
          category: 'task',
        },
      }],
    };

    const execution = executeActionPlan(
      plan,
      makeContext(),
      handlers,
      'en',
      undefined,
      undefined,
      {
        actor: 'voice',
        surface: 'dashboard',
        sourceTranscript: 'add buy milk',
      },
    );

    expect(execution.kind).toBe('executed');
    expect(recordAssistantActivity).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'voice',
      domain: 'tasks',
      action: 'created',
      sourceSurface: 'dashboard',
      sourceTranscript: 'add buy milk',
      undoOperation: { type: 'task.delete', id: 'task-activity-1' },
    }));
  });

  it('undoes a recorded assistant task creation through the app provider', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <ActivityUndoHarness />
        </AppProvider>,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record Task' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-count')).toHaveTextContent('1');
      expect(screen.getByTestId('activity-count')).toHaveTextContent('1');
      expect(screen.getByTestId('activity-status')).toHaveTextContent('applied');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo Latest' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-count')).toHaveTextContent('0');
      expect(screen.getByTestId('activity-status')).toHaveTextContent('undone');
      expect(screen.getByTestId('undo-result')).toHaveTextContent('Undid: Created task "Audit task".');
    });
  });

  it('undoes prayer A without deleting interleaved prayer B outcome, receipt, or XP', async () => {
    seedPrayerUndoTasks();

    render(
      <AppProvider>
        <PrayerUndoHarness />
      </AppProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('fajr-task')).toHaveTextContent('false');
      expect(screen.getByTestId('dhuhr-task')).toHaveTextContent('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr' }));
    await waitFor(() => expect(screen.getByTestId('fajr-outcome')).toHaveTextContent('on_time'));
    const xpAfterFajr = Number(screen.getByTestId('prayer-xp').textContent);
    expect(xpAfterFajr).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Dhuhr' }));
    await waitFor(() => expect(screen.getByTestId('dhuhr-outcome')).toHaveTextContent('on_time'));
    const xpAfterDhuhr = Number(screen.getByTestId('prayer-xp').textContent);
    expect(xpAfterDhuhr).toBeGreaterThan(xpAfterFajr);

    fireEvent.click(screen.getByRole('button', { name: 'Add Dhuhr Receipt' }));
    await waitFor(() => expect(screen.getByTestId('reminder-receipts')).toHaveTextContent('1'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Fajr' }));

    await waitFor(() => {
      expect(screen.getByTestId('fajr-outcome')).toHaveTextContent('none');
      expect(screen.getByTestId('dhuhr-outcome')).toHaveTextContent('on_time');
      expect(screen.getByTestId('reminder-receipts')).toHaveTextContent('1');
      expect(screen.getByTestId('prayer-xp')).toHaveTextContent(String(xpAfterDhuhr - xpAfterFajr));
      expect(screen.getByTestId('prayer-completed-total')).toHaveTextContent('1');
      expect(screen.getByTestId('prayer-daily-log')).not.toHaveTextContent('prayer-fajr');
      expect(screen.getByTestId('prayer-daily-log')).toHaveTextContent('prayer-dhuhr');
      expect(screen.getByTestId('fajr-task')).toHaveTextContent('false');
      expect(screen.getByTestId('dhuhr-task')).toHaveTextContent('true');
    });
  });

  it('preserves unrelated edits to the same prayer task when undoing completion', async () => {
    seedPrayerUndoTasks();

    render(
      <AppProvider>
        <PrayerUndoHarness />
      </AppProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('fajr-task')).toHaveTextContent('false'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr' }));
    await waitFor(() => {
      expect(screen.getByTestId('fajr-outcome')).toHaveTextContent('on_time');
      expect(screen.getByTestId('fajr-task')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Fajr' }));
    await waitFor(() => {
      expect(screen.getByTestId('fajr-description')).toHaveTextContent('Edited after completion');
      expect(screen.getByTestId('fajr-priority')).toHaveTextContent('high');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo Fajr' }));

    await waitFor(() => {
      expect(screen.getByTestId('fajr-outcome')).toHaveTextContent('none');
      expect(screen.getByTestId('fajr-task')).toHaveTextContent('false');
      expect(screen.getByTestId('fajr-description')).toHaveTextContent('Edited after completion');
      expect(screen.getByTestId('fajr-priority')).toHaveTextContent('high');
      expect(screen.getByTestId('prayer-xp')).toHaveTextContent('0');
      expect(screen.getByTestId('prayer-daily-log')).not.toHaveTextContent('prayer-fajr');
    });
  });
});

import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import type { ActionPlan } from '../assistant/plannerSchema';
import type { AssistantActionHandlers, AssistantCommandContext } from '../assistant/shared';
import { AppProvider, useApp } from '../store/AppContext';
import { DEFAULT_PROFILE } from '../services/gamification';

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
});

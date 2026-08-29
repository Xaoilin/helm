import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { logError } from '../../services/logger';
import type { AssistantActivityEntry, AssistantUndoResult } from '../../types/domain';
import { useAssistantActivityContext } from './AssistantActivityContext';
import { useCalendar } from './CalendarContext';
import { useFinanceContext } from './FinanceContext';
import { useGamificationContext } from './GamificationContext';
import { useKnowledgeContext } from './KnowledgeContext';
import { usePrayerContext } from './PrayerContext';
import { useTaskContext } from './TaskContext';

export interface AssistantUndoDependencies {
  activity: Pick<ReturnType<typeof useAssistantActivityContext>, 'markAssistantActivityUndone' | 'markAssistantActivityUndoFailed'>;
  calendar: Pick<ReturnType<typeof useCalendar>, 'calendarEvents' | 'removeCalendarEvent' | 'updateCalendarEvent'>;
  finance: Pick<ReturnType<typeof useFinanceContext>, 'transactions' | 'removeTransaction'>;
  gamification: Pick<ReturnType<typeof useGamificationContext>, 'updateGamification'>;
  knowledge: Pick<ReturnType<typeof useKnowledgeContext>, 'removeKnowledgeEntry'>;
  prayer: Pick<ReturnType<typeof usePrayerContext>, 'undoPrayerCompletion'>;
  tasks: Pick<ReturnType<typeof useTaskContext>, 'tasks' | 'removeTask' | 'setTasks'>;
}

interface AssistantUndoContextValue {
  undoAssistantActivity: (id: string) => AssistantUndoResult;
}

const AssistantUndoContext = createContext<AssistantUndoContextValue | null>(null);

export function useAssistantUndo(): AssistantUndoContextValue {
  const context = useContext(AssistantUndoContext);
  if (!context) throw new Error('useAssistantUndo must be used within AssistantUndoProvider');
  return context;
}

export function executeAssistantActivityUndo(
  entry: AssistantActivityEntry | undefined,
  dependencies: AssistantUndoDependencies,
): AssistantUndoResult {
  if (!entry) {
    return { ok: false, message: 'That Lina activity entry was not found.' };
  }
  if (entry.status === 'undone') {
    return { ok: false, message: 'That Lina action has already been undone.' };
  }
  if (!entry.undoOperation) {
    return { ok: false, message: 'This Lina action does not have an undo operation.' };
  }

  try {
    const operation = entry.undoOperation;
    switch (operation.type) {
      case 'task.delete':
        dependencies.tasks.removeTask(operation.id);
        break;
      case 'task.restore':
        dependencies.tasks.setTasks(current => {
          const existingIds = new Set(current.map(task => task.id));
          const restored = operation.tasks.filter(task => !existingIds.has(task.id));
          return restored.length > 0 ? [...current, ...restored] : current;
        });
        break;
      case 'task.replace':
        if (operation.task.category === 'prayer' && operation.gamification) {
          throw new Error('This legacy prayer undo cannot be applied safely after later activity.');
        }
        dependencies.tasks.setTasks(current => {
          const exists = current.some(task => task.id === operation.task.id);
          return exists
            ? current.map(task => task.id === operation.task.id ? operation.task : task)
            : [...current, operation.task];
        });
        if (operation.gamification) {
          dependencies.gamification.updateGamification(operation.gamification);
        }
        break;
      case 'prayer.complete': {
        const taskCompletion = operation.inverse.taskCompletion;
        if (taskCompletion) {
          const currentTask = dependencies.tasks.tasks.find(task => task.id === taskCompletion.taskId);
          if (!currentTask) throw new Error('The completed prayer task no longer exists.');
          const completionFieldsChanged = currentTask.completed !== taskCompletion.after.completed
            || currentTask.completedAt !== taskCompletion.after.completedAt
            || (
              taskCompletion.after.recurringLastReset !== undefined
              && currentTask.recurring?.lastReset !== taskCompletion.after.recurringLastReset
            );
          if (completionFieldsChanged) {
            throw new Error('The prayer task completion changed after this action and was not undone.');
          }
        }

        dependencies.prayer.undoPrayerCompletion(operation.inverse);
        if (taskCompletion) {
          dependencies.tasks.setTasks(current => current.map(task => {
            if (task.id !== taskCompletion.taskId) return task;
            let recurring = task.recurring;
            if (taskCompletion.after.recurringLastReset !== undefined && recurring) {
              recurring = { ...recurring };
              if (taskCompletion.before.recurringLastReset !== undefined) {
                recurring.lastReset = taskCompletion.before.recurringLastReset;
              } else {
                delete recurring.lastReset;
              }
            }
            return {
              ...task,
              completed: taskCompletion.before.completed,
              completedAt: taskCompletion.before.completedAt,
              ...(recurring ? { recurring } : {}),
            };
          }));
        }
        break;
      }
      case 'calendar.delete':
        dependencies.calendar.removeCalendarEvent(operation.id);
        break;
      case 'calendar.replace':
        if (!dependencies.calendar.calendarEvents.some(event => event.id === operation.event.id)) {
          throw new Error('The calendar event no longer exists.');
        }
        dependencies.calendar.updateCalendarEvent(operation.event.id, operation.event);
        break;
      case 'finance.delete_transaction':
        if (!dependencies.finance.transactions.some(transaction => transaction.id === operation.id)) {
          throw new Error('The transaction was already removed.');
        }
        dependencies.finance.removeTransaction(operation.id);
        break;
      case 'knowledge.delete_entry':
        dependencies.knowledge.removeKnowledgeEntry(operation.id);
        break;
      default:
        throw new Error('This legacy Lina undo operation is no longer supported.');
    }

    dependencies.activity.markAssistantActivityUndone(entry.id);
    return { ok: true, message: `Undid: ${entry.summary}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.activity.markAssistantActivityUndoFailed(entry.id, message);
    logError('AssistantActivityUndo', error);
    return { ok: false, message };
  }
}

export function AssistantUndoProvider({ children }: { children: ReactNode }) {
  const activity = useAssistantActivityContext();
  const calendar = useCalendar();
  const finance = useFinanceContext();
  const gamification = useGamificationContext();
  const knowledge = useKnowledgeContext();
  const prayer = usePrayerContext();
  const tasks = useTaskContext();

  const undoAssistantActivity = useCallback((id: string) => (
    executeAssistantActivityUndo(
      activity.assistantActivityLog.find(entry => entry.id === id),
      { activity, calendar, finance, gamification, knowledge, prayer, tasks },
    )
  ), [activity, calendar, finance, gamification, knowledge, prayer, tasks]);

  const value = useMemo(() => ({ undoAssistantActivity }), [undoAssistantActivity]);
  return <AssistantUndoContext.Provider value={value}>{children}</AssistantUndoContext.Provider>;
}

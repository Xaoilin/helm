import { requestAssistantNavigation } from '../services/assistantNavigation';
import {
  buildCompletionContext,
  processTaskCompletion,
  recordHabitCompletion,
} from '../services/gamification';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, formatGBP, parseToPence, toLocalDateStr } from '../services/financeHelpers';
import type {
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  KnowledgeTopic,
  Surface,
  Task,
  Transaction,
} from '../types/domain';
import { getCapabilityDefinition } from './capabilities';
import {
  SURFACE_LABELS,
  makeEntityReference,
  resolveCalendarEventReference,
  resolveCalendarSourceReference,
  resolveFinanceAccountReference,
  resolveKnowledgeTopicReference,
  resolveTaskReference,
} from './entityResolver';
import type { ActionPlan } from './plannerSchema';
import type {
  AssistantActionHandlers,
  AssistantCommandContext,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantExecutionResult,
  AssistantExecutionStep,
  AssistantLang,
} from './shared';
import { extractTemporalReference } from './temporalResolver';

interface ClarifyOutcome {
  kind: 'clarify';
  message: string;
}

interface ExecutedStepOutcome {
  stepResult: AssistantExecutionStep;
  message: string;
  refs: AssistantEntityReference[];
  undoToken?: string;
}

interface ExecuteOutcome {
  kind: 'executed';
  message: string;
  execution: AssistantExecutionResult;
  referencedEntities: AssistantEntityReference[];
}

type ExecutionOutcome = ClarifyOutcome | ExecuteOutcome;

function getNow(context: AssistantCommandContext): Date {
  return context.now ? new Date(context.now) : new Date();
}

function cloneContext(context: AssistantCommandContext): AssistantCommandContext {
  return {
    ...context,
    calendarAccounts: [...context.calendarAccounts],
    calendarSources: [...context.calendarSources],
    calendarEvents: [...context.calendarEvents],
    tasks: [...context.tasks],
    financeAccounts: [...context.financeAccounts],
    transactions: [...context.transactions],
    knowledgeEntries: [...context.knowledgeEntries],
    knowledgeTopics: [...context.knowledgeTopics],
    lifestyleItems: [...context.lifestyleItems],
    workspaces: [...context.workspaces],
    gamification: {
      ...context.gamification,
      badges: [...context.gamification.badges],
      habitTallies: { ...(context.gamification.habitTallies || {}) },
      dailyLog: { ...(context.gamification.dailyLog || {}) },
    },
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asTaskCategory(value: unknown): Task['category'] | 'any' {
  return value === 'daily' || value === 'task' || value === 'goal' ? value : 'any';
}

function asMatchScope(value: unknown): 'one' | 'all' {
  return value === 'all' ? 'all' : 'one';
}

function pickCalendarSource(
  context: AssistantCommandContext,
  calendarQuery: string,
): { source: CalendarSource | null; clarify?: string } {
  if (calendarQuery) {
    const resolution = resolveCalendarSourceReference(calendarQuery, context);
    if (!resolution.best) {
      return { source: null, clarify: `I couldn't find a calendar matching "${calendarQuery}".` };
    }
    if (resolution.ambiguous) {
      const names = resolution.matches.slice(0, 3).map(match => match.data.name).join(', ');
      return { source: null, clarify: `Which calendar did you mean: ${names}?` };
    }
    return { source: resolution.best.data };
  }

  if (context.calendarSources.length === 0) {
    return { source: null, clarify: 'Add a calendar first and then I can schedule the event.' };
  }

  const primaryAccount = context.calendarAccounts.find(account => account.isPrimary);
  if (primaryAccount) {
    const primarySource = context.calendarSources.find(source => source.accountId === primaryAccount.id);
    if (primarySource) return { source: primarySource };
  }

  return { source: context.calendarSources[0] };
}

function findOrClarifyTask(
  query: string,
  context: AssistantCommandContext,
  dialogState: AssistantDialogState | undefined,
  opts: { category?: Task['category'] | 'any'; allowCompleted?: boolean } = {},
): { task: Task | null; clarify?: string } {
  const resolution = resolveTaskReference(query, context, dialogState, {
    category: opts.category,
    allowCompleted: opts.allowCompleted,
  });
  if (!resolution.best) {
    return {
      task: null,
      clarify: opts.allowCompleted
        ? `I couldn't find a task matching "${query}".`
        : `I couldn't find an incomplete task matching "${query}".`,
    };
  }
  if (resolution.ambiguous) {
    const names = resolution.matches.slice(0, 3).map(match => match.data.title).join(', ');
    return { task: null, clarify: `Which task did you mean: ${names}?` };
  }
  return { task: resolution.best.data };
}

function findTasksForDeletion(
  query: string,
  context: AssistantCommandContext,
  dialogState: AssistantDialogState | undefined,
  opts: { category?: Task['category'] | 'any'; scope?: 'one' | 'all' } = {},
): { tasks: Task[]; clarify?: string } {
  const scope = opts.scope || 'one';
  if (scope === 'one') {
    const resolution = findOrClarifyTask(query, context, dialogState, {
      category: opts.category,
      allowCompleted: true,
    });
    return resolution.task
      ? { tasks: [resolution.task] }
      : { tasks: [], clarify: resolution.clarify || `I couldn't find a task matching "${query}".` };
  }

  const resolution = resolveTaskReference(query, context, dialogState, {
    category: opts.category,
    allowCompleted: true,
  });

  if (resolution.matches.length === 0) {
    return { tasks: [], clarify: `I couldn't find any tasks matching "${query}".` };
  }

  return { tasks: resolution.matches.map(match => match.data) };
}

function findOrClarifyEvent(
  query: string,
  context: AssistantCommandContext,
): { event: CalendarEvent | null; clarify?: string } {
  const resolution = resolveCalendarEventReference(query, context);
  if (!resolution.best) {
    return { event: null, clarify: `I couldn't find an event matching "${query}".` };
  }
  if (resolution.ambiguous) {
    const names = resolution.matches.slice(0, 3).map(match => match.data.title).join(', ');
    return { event: null, clarify: `Which event did you mean: ${names}?` };
  }
  return { event: resolution.best.data };
}

function pickFinanceAccount(
  context: AssistantCommandContext,
  accountQuery: string,
): { account: FinanceAccount | null; clarify?: string } {
  if (accountQuery) {
    const resolution = resolveFinanceAccountReference(accountQuery, context);
    if (!resolution.best) {
      return { account: null, clarify: `I couldn't find an account matching "${accountQuery}".` };
    }
    if (resolution.ambiguous) {
      const names = resolution.matches.slice(0, 3).map(match => match.data.name).join(', ');
      return { account: null, clarify: `Which account did you mean: ${names}?` };
    }
    return { account: resolution.best.data };
  }

  if (context.financeAccounts.length === 1) {
    return { account: context.financeAccounts[0] };
  }

  const defaultAccount = context.financeAccounts.find(account => account.type === 'current')
    || context.financeAccounts.find(account => account.includeInNetWorth)
    || context.financeAccounts[0];

  if (!defaultAccount) {
    return { account: null, clarify: 'Add a finance account first and then I can record the transaction.' };
  }

  return { account: defaultAccount };
}

function pickKnowledgeTopic(
  context: AssistantCommandContext,
  topicQuery: string,
): { topic: KnowledgeTopic | null; clarify?: string } {
  if (topicQuery) {
    const resolution = resolveKnowledgeTopicReference(topicQuery, context);
    if (!resolution.best) {
      return { topic: null, clarify: `I couldn't find a knowledge topic matching "${topicQuery}".` };
    }
    if (resolution.ambiguous) {
      const names = resolution.matches.slice(0, 3).map(match => match.data.name).join(', ');
      return { topic: null, clarify: `Which topic did you mean: ${names}?` };
    }
    return { topic: resolution.best.data };
  }

  if (context.knowledgeTopics.length === 1) {
    return { topic: context.knowledgeTopics[0] };
  }

  return { topic: null, clarify: 'Which knowledge topic should I save that under?' };
}

function guessExpenseCategory(description: string): Transaction['category'] {
  const lower = description.toLowerCase();
  const keywords: Array<[Transaction['category'], string[]]> = [
    ['groceries', ['grocery', 'groceries', 'supermarket']],
    ['transport', ['train', 'bus', 'tube', 'uber', 'taxi', 'fuel', 'petrol']],
    ['bills-utilities', ['bill', 'electric', 'water', 'gas', 'utility']],
    ['eating-out', ['coffee', 'lunch', 'dinner', 'restaurant', 'cafe', 'meal']],
    ['subscriptions', ['subscription', 'netflix', 'spotify', 'membership']],
    ['charity', ['charity', 'donation', 'zakat', 'sadaqah']],
  ];

  for (const [category, words] of keywords) {
    if (words.some(word => lower.includes(word))) return category;
  }

  return EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1].value as Transaction['category'];
}

function guessIncomeCategory(description: string): Transaction['category'] {
  const lower = description.toLowerCase();
  if (lower.includes('salary') || lower.includes('payroll')) return 'salary';
  if (lower.includes('freelance') || lower.includes('contract')) return 'freelance';
  if (lower.includes('refund')) return 'refund';
  if (lower.includes('gift')) return 'gift-received';
  return INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1].value as Transaction['category'];
}

function executeSingleStep(
  step: ActionPlan['steps'][number],
  context: AssistantCommandContext,
  handlers: AssistantActionHandlers,
  lang: AssistantLang,
  dialogState?: AssistantDialogState,
): ClarifyOutcome | ExecutedStepOutcome {
  switch (step.capability) {
    case 'navigation.go_to_surface': {
      const surfaceValue = step.args.surface;
      if (typeof surfaceValue !== 'string') {
        return { kind: 'clarify', message: 'Which part of HELM should I open?' };
      }

      const surface = surfaceValue as Surface;
      const navigate = handlers.navigate || requestAssistantNavigation;
      navigate(surface);

      const ref = makeEntityReference('surface', surface, SURFACE_LABELS[surface].en, surface, 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Opened ${SURFACE_LABELS[surface].en}.`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `جاري فتح ${SURFACE_LABELS[surface].ar}.`
          : `Opening ${SURFACE_LABELS[surface].en} for you.`,
        refs: [ref],
      };
    }

    case 'tasks.create_task': {
      const title = asString(step.args.title);
      if (!title) {
        return { kind: 'clarify', message: 'What should I call the task?' };
      }

      const priority = step.args.priority === 'high' || step.args.priority === 'low' ? step.args.priority : 'medium';
      const category = step.args.category === 'daily' || step.args.category === 'goal' ? step.args.category : 'task';
      const dueDate = asString(step.args.dueDate);
      const id = handlers.addTask({
        title,
        description: '',
        completed: false,
        priority,
        category,
        dueDate: dueDate || undefined,
        recurring: category === 'daily' ? { frequency: 'daily' } : undefined,
      });
      const now = getNow(context).toISOString();
      context.tasks = [...context.tasks, {
        id,
        title,
        description: '',
        completed: false,
        priority,
        category,
        dueDate: dueDate || undefined,
        recurring: category === 'daily' ? { frequency: 'daily' } : undefined,
        createdAt: now,
        updatedAt: now,
      }];

      const ref = makeEntityReference('task', id, title, 'tasks', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Created task "${title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar' ? `أضفت "${title}" إلى مهامك.` : `Added "${title}" to your tasks.`,
        refs: [ref],
        undoToken: JSON.stringify({ type: 'task.delete', id }),
      };
    }

    case 'tasks.complete_matching': {
      const taskQuery = asString(step.args.taskQuery);
      const category = asTaskCategory(step.args.category);
      const resolution = findOrClarifyTask(taskQuery, context, dialogState, {
        category,
        allowCompleted: false,
      });
      if (!resolution.task) {
        return { kind: 'clarify', message: resolution.clarify || 'Which task should I complete?' };
      }

      const task = resolution.task;
      const now = getNow(context);
      const today = toLocalDateStr(now);
      const completedAt = now.toISOString();
      handlers.updateTask(task.id, {
        completed: true,
        completedAt,
        ...(task.recurring ? { recurring: { ...task.recurring, lastReset: today } } : {}),
      });
      context.tasks = context.tasks.map(item =>
        item.id === task.id ? { ...item, completed: true, completedAt, recurring: task.recurring ? { ...task.recurring, lastReset: today } : undefined } : item
      );

      if (handlers.updateGamification) {
        const todayLog = context.gamification.dailyLog?.[today] || [];
        const alreadyRewarded = task.category === 'daily' && todayLog.includes(task.id);
        if (!alreadyRewarded) {
          const completionsToday = context.tasks.filter(item => item.completed && item.completedAt?.startsWith(today)).length;
          const extCtx = buildCompletionContext(context.tasks, context.goalTags, today, context.gamification, {
            knowledgeEntries: context.knowledgeEntries.length,
            knowledgeTopics: context.knowledgeTopics.length,
            lifestyleHaramMastered: context.lifestyleItems.filter(item => item.type === 'haram' && item.status === 'mastered').length,
            lifestyleHalalConsistent: context.lifestyleItems.filter(item => item.type === 'halal' && item.status === 'consistent').length,
            lifestyleTotal: context.lifestyleItems.length,
          });
          let profile = processTaskCompletion(context.gamification, task, completionsToday, now, extCtx).updatedProfile;
          if (task.category === 'daily') {
            profile = recordHabitCompletion(profile, task.id, today);
          }
          handlers.updateGamification(profile);
          context.gamification = profile;
        }
      }

      const ref = makeEntityReference('task', task.id, task.title, 'tasks', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Completed "${task.title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `تم تعليم "${task.title}" كمكتملة.`
          : task.category === 'daily'
            ? `Marked the habit "${task.title}" as complete.`
            : `Marked "${task.title}" as complete.`,
        refs: [ref],
        undoToken: JSON.stringify({ type: 'task.reopen', id: task.id }),
      };
    }

    case 'tasks.delete_matching': {
      if (!handlers.removeTask) {
        return {
          kind: 'clarify',
          message: 'Task deletion is not available in this surface.',
        };
      }

      const taskQuery = asString(step.args.taskQuery);
      const category = asTaskCategory(step.args.category);
      const matchScope = asMatchScope(step.args.matchScope);
      const resolution = findTasksForDeletion(taskQuery, context, dialogState, {
        category,
        scope: matchScope,
      });

      if (resolution.tasks.length === 0) {
        return { kind: 'clarify', message: resolution.clarify || 'Which task should I delete?' };
      }

      const tasksToDelete = resolution.tasks;
      for (const task of tasksToDelete) {
        handlers.removeTask(task.id);
      }
      const deletedIds = new Set(tasksToDelete.map(task => task.id));
      context.tasks = context.tasks.filter(task => !deletedIds.has(task.id));

      const refs = tasksToDelete.map(task => makeEntityReference('task', task.id, task.title, 'tasks', 1));
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: tasksToDelete.length === 1
            ? `Deleted "${tasksToDelete[0].title}".`
            : `Deleted ${tasksToDelete.length} tasks matching "${taskQuery}".`,
          entityRefs: refs,
        },
        message: lang === 'ar'
          ? tasksToDelete.length === 1
            ? `تم حذف "${tasksToDelete[0].title}".`
            : `تم حذف ${tasksToDelete.length} مهام تطابق "${taskQuery}".`
          : tasksToDelete.length === 1
            ? `Deleted "${tasksToDelete[0].title}".`
            : `Deleted ${tasksToDelete.length} tasks matching "${taskQuery}".`,
        refs,
      };
    }

    case 'tasks.reveal_task': {
      const taskQuery = asString(step.args.taskQuery);
      const resolution = findOrClarifyTask(taskQuery || 'that task', context, dialogState, {
        category: 'any',
        allowCompleted: true,
      });
      if (!resolution.task) {
        return { kind: 'clarify', message: resolution.clarify || 'Which task should I show you?' };
      }

      const task = resolution.task;
      const navigate = handlers.navigate || requestAssistantNavigation;
      navigate({
        surface: 'tasks',
        taskReveal: {
          taskId: task.id,
          tab: task.category === 'goal' ? 'goals' : 'all',
          resetFilters: true,
          highlight: true,
        },
      });

      const ref = makeEntityReference('task', task.id, task.title, 'tasks', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Revealed task "${task.title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `سأعرض "${task.title}" في المهام.`
          : `Opening "${task.title}" in your tasks.`,
        refs: [ref],
      };
    }

    case 'calendar.create_event': {
      if (!handlers.addCalendarEvent) {
        return { kind: 'clarify', message: 'Calendar event creation is not available in this surface.' };
      }

      const title = asString(step.args.title);
      if (!title) {
        return { kind: 'clarify', message: 'What should I call the event?' };
      }

      const calendarChoice = pickCalendarSource(context, asString(step.args.calendarQuery));
      if (!calendarChoice.source) {
        return { kind: 'clarify', message: calendarChoice.clarify || 'Which calendar should I use?' };
      }

      const extracted = extractTemporalReference(asString(step.args.timePhrase), context);
      const start = asString(step.args.start) || extracted.resolution?.start;
      const end = asString(step.args.end) || extracted.resolution?.end;
      if (!start || !end) {
        return { kind: 'clarify', message: 'When should I schedule it?' };
      }

      const id = handlers.addCalendarEvent({
        sourceId: calendarChoice.source.id,
        title,
        description: asString(step.args.description),
        start,
        end,
        allDay: false,
        location: asString(step.args.location) || undefined,
      });
      context.calendarEvents = [...context.calendarEvents, {
        id,
        sourceId: calendarChoice.source.id,
        title,
        description: asString(step.args.description),
        start,
        end,
        allDay: false,
        location: asString(step.args.location) || undefined,
      }];

      const ref = makeEntityReference('calendar_event', id, title, 'calendar', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Created event "${title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `أضفت "${title}" إلى تقويمك.`
          : `Scheduled "${title}" on ${calendarChoice.source.name}.`,
        refs: [ref],
        undoToken: JSON.stringify({ type: 'calendar.delete', id }),
      };
    }

    case 'calendar.reschedule_event': {
      if (!handlers.updateCalendarEvent) {
        return { kind: 'clarify', message: 'Calendar rescheduling is not available in this surface.' };
      }

      const eventResolution = findOrClarifyEvent(asString(step.args.eventQuery), context);
      if (!eventResolution.event) {
        return { kind: 'clarify', message: eventResolution.clarify || 'Which event should I move?' };
      }

      const extracted = extractTemporalReference(asString(step.args.timePhrase), context);
      const start = asString(step.args.start) || extracted.resolution?.start;
      const end = asString(step.args.end) || extracted.resolution?.end;
      if (!start || !end) {
        return { kind: 'clarify', message: 'What time should I move it to?' };
      }

      const event = eventResolution.event;
      handlers.updateCalendarEvent(event.id, { start, end, allDay: false });
      context.calendarEvents = context.calendarEvents.map(item =>
        item.id === event.id ? { ...item, start, end, allDay: false } : item
      );

      const ref = makeEntityReference('calendar_event', event.id, event.title, 'calendar', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Moved "${event.title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `تم نقل "${event.title}".`
          : `Moved "${event.title}" to the new time.`,
        refs: [ref],
        undoToken: JSON.stringify({ type: 'calendar.reschedule', id: event.id, start: event.start, end: event.end }),
      };
    }

    case 'finance.record_transaction': {
      if (!handlers.addTransaction) {
        return { kind: 'clarify', message: 'Finance logging is not available in this surface.' };
      }

      const type = step.args.type === 'income' ? 'income' : 'expense';
      const amountRaw = asString(step.args.amount);
      const amount = parseToPence(amountRaw.replace(/[£$,]/g, ''));
      if (amount <= 0) {
        return { kind: 'clarify', message: 'What amount should I record?' };
      }

      const accountChoice = pickFinanceAccount(context, asString(step.args.accountQuery));
      if (!accountChoice.account) {
        return { kind: 'clarify', message: accountChoice.clarify || 'Which account should I use?' };
      }

      const description = asString(step.args.description) || (type === 'income' ? 'Income' : 'Expense');
      const category = type === 'income' ? guessIncomeCategory(description) : guessExpenseCategory(description);
      const date = asString(step.args.date) || toLocalDateStr(getNow(context));
      const id = handlers.addTransaction({
        type,
        amount,
        category,
        accountId: accountChoice.account.id,
        description,
        date,
      });
      const now = getNow(context).toISOString();
      context.transactions = [{
        id,
        type,
        amount,
        category,
        accountId: accountChoice.account.id,
        description,
        date,
        createdAt: now,
        updatedAt: now,
      }, ...context.transactions];

      const ref = makeEntityReference('finance_account', accountChoice.account.id, accountChoice.account.name, 'finance', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Recorded ${type} of ${formatGBP(amount)}.`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `تم تسجيل ${formatGBP(amount)} في ${accountChoice.account.name}.`
          : `Recorded ${type} of ${formatGBP(amount)} in ${accountChoice.account.name}.`,
        refs: [ref],
      };
    }

    case 'knowledge.create_entry': {
      if (!handlers.addKnowledgeEntry) {
        return { kind: 'clarify', message: 'Knowledge capture is not available in this surface.' };
      }

      const topicChoice = pickKnowledgeTopic(context, asString(step.args.topicQuery));
      if (!topicChoice.topic) {
        return { kind: 'clarify', message: topicChoice.clarify || 'Which topic should I use?' };
      }

      const title = asString(step.args.title) || 'Quick note';
      const content = asString(step.args.content);
      if (!content) {
        return { kind: 'clarify', message: 'What note should I save?' };
      }

      const id = handlers.addKnowledgeEntry({
        topicId: topicChoice.topic.id,
        title,
        content,
        sources: [],
        tags: [],
      });
      const now = getNow(context).toISOString();
      context.knowledgeEntries = [...context.knowledgeEntries, {
        id,
        topicId: topicChoice.topic.id,
        title,
        content,
        sources: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      }];

      const ref = makeEntityReference('knowledge_entry', id, title, 'knowledge', 1);
      return {
        stepResult: {
          capability: step.capability,
          status: 'completed',
          summary: `Saved note "${title}".`,
          entityRefs: [ref],
        },
        message: lang === 'ar'
          ? `تم حفظ الملاحظة "${title}" تحت ${topicChoice.topic.name}.`
          : `Saved "${title}" under ${topicChoice.topic.name}.`,
        refs: [ref],
      };
    }
  }
}

export function executeActionPlan(
  plan: ActionPlan,
  context: AssistantCommandContext,
  handlers: AssistantActionHandlers,
  lang: AssistantLang,
  dialogState?: AssistantDialogState,
): ExecutionOutcome {
  const workingContext = cloneContext(context);
  const steps: AssistantExecutionStep[] = [];
  const refs: AssistantEntityReference[] = [];
  let lastMessage = plan.response;
  const undoTokens: string[] = [];

  for (const step of plan.steps) {
    const capability = getCapabilityDefinition(step.capability);
    const result = executeSingleStep(step, workingContext, handlers, lang, dialogState);
    if ('kind' in result) {
      return result;
    }

    steps.push(result.stepResult);
    refs.push(...result.refs);
    lastMessage = result.message || lastMessage;
    if (result.undoToken && capability.confirmationRule !== 'never') {
      undoTokens.push(result.undoToken);
    }
  }

  return {
    kind: 'executed',
    message: lastMessage,
    referencedEntities: refs,
    execution: {
      status: steps.length > 0 ? 'executed' : 'skipped',
      steps,
      undoToken: undoTokens.length > 0 ? undoTokens.join('|') : undefined,
    },
  };
}

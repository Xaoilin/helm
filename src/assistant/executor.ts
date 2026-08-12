import {
  normalizeAssistantNavigationRequest,
  requestAssistantNavigation,
  type AssistantNavigationRequest,
  type AssistantTaskTab,
} from '../services/assistantNavigation';
import {
  buildCompletionContext,
  processTaskCompletion,
  recordHabitCompletion,
} from '../services/gamification';
import { getPrayerTaskName, isHabitTask } from '../services/prayerTasks';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, formatGBP, parseToPence, toLocalDateStr } from '../services/financeHelpers';
import type {
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  GamificationProfile,
  KnowledgeTopic,
  PrayerCompletionStatus,
  PrayerName,
  Surface,
  Task,
  Transaction,
  AssistantActivityDomain,
  AssistantActivityEntityReference,
  AssistantUndoOperation,
} from '../types/domain';
import {
  normalizeInventoryDimensions,
  normalizeInventoryItemDraft,
  normalizeInventoryNeedDraft,
  normalizeInventoryQuantity,
} from '../inventory/inventoryModel';
import { getCapabilityDefinition } from './capabilities';
import { canApplyLocalCalendarMutation } from '../services/calendarProviderSync';
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
  AssistantActivitySource,
  AssistantCommandContext,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantExecutionResult,
  AssistantExecutionStep,
  AssistantLang,
  AssistantToolCall,
  AssistantToolResult,
} from './shared';
import { extractTemporalReference } from './temporalResolver';
import { buildPrayerStatusQuestion } from './prayerCompletion';

interface PendingPrayerCompletionDraft {
  prayerName: PrayerName;
  taskId: string;
  toolCall: AssistantToolCall;
}

interface ClarifyOutcome {
  kind: 'clarify';
  reason: string;
  pendingPrayerCompletion?: PendingPrayerCompletionDraft;
}

interface ExecutedStepOutcome {
  stepResult: AssistantExecutionStep;
  toolResult: AssistantToolResult;
  refs: AssistantEntityReference[];
  undoToken?: string;
  navigationRequest?: AssistantNavigationRequest;
}

interface ExecuteOutcome {
  kind: 'executed';
  execution: AssistantExecutionResult;
  referencedEntities: AssistantEntityReference[];
}

type ExecutionOutcome = ClarifyOutcome | ExecuteOutcome;

function getNow(context: AssistantCommandContext): Date {
  return context.now ? new Date(context.now) : new Date();
}

function parseAssistantInventoryDimensions(value: unknown) {
  const text = asString(value).trim();
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Dimensions must be valid JSON.');
  }
  return normalizeInventoryDimensions(parsed);
}

function parseAssistantInventorySpecifications(value: unknown): Record<string, string> {
  const text = asString(value).trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, string>;
    } catch {
      throw new Error('Specifications JSON must be an object.');
    }
  }
  const entries = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const separator = line.indexOf(':');
    if (separator <= 0 || !line.slice(separator + 1).trim()) {
      throw new Error('Specification line ' + (index + 1) + ' must use “name: value”.');
    }
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

function cloneContext(context: AssistantCommandContext): AssistantCommandContext {
  return {
    ...context,
    calendarAccounts: [...context.calendarAccounts],
    calendarSources: [...context.calendarSources],
    calendarEvents: [...context.calendarEvents],
    inventoryItems: [...(context.inventoryItems || [])],
    inventoryNeeds: [...(context.inventoryNeeds || [])],
    tasks: [...context.tasks],
    financeAccounts: [...context.financeAccounts],
    transactions: [...context.transactions],
    knowledgeEntries: [...context.knowledgeEntries],
    knowledgeTopics: [...context.knowledgeTopics],
    lifestyleItems: [...context.lifestyleItems],
    projects: [...context.projects],
    gamification: {
      ...context.gamification,
      badges: [...context.gamification.badges],
      habitTallies: { ...(context.gamification.habitTallies || {}) },
      dailyLog: { ...(context.gamification.dailyLog || {}) },
    },
  };
}

function cloneGamification(profile: GamificationProfile): GamificationProfile {
  return {
    ...profile,
    badges: [...profile.badges],
    habitTallies: { ...(profile.habitTallies || {}) },
    dailyLog: Object.fromEntries(
      Object.entries(profile.dailyLog || {}).map(([date, ids]) => [date, [...ids]]),
    ),
  };
}

function toActivityEntityRefs(refs: AssistantEntityReference[]): AssistantActivityEntityReference[] {
  return refs.map(ref => ({
    kind: ref.kind,
    id: ref.id,
    label: ref.label,
    surface: ref.surface,
  }));
}

function recordAssistantActivity(
  handlers: AssistantActionHandlers,
  activity: AssistantActivitySource | undefined,
  entry: {
    domain: AssistantActivityDomain;
    action: 'completed' | 'created' | 'deleted' | 'recorded' | 'saved' | 'updated';
    summary: string;
    details: string[];
    refs: AssistantEntityReference[];
    undoOperation?: AssistantUndoOperation;
  },
): void {
  if (!activity || !handlers.recordAssistantActivity) return;

  handlers.recordAssistantActivity({
    actor: activity.actor,
    domain: entry.domain,
    action: entry.action,
    summary: entry.summary,
    details: entry.details,
    entityRefs: toActivityEntityRefs(entry.refs),
    sourceSurface: activity.surface,
    sourceTranscript: activity.sourceTranscript,
    conversationId: activity.conversationId,
    undoOperation: entry.undoOperation,
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asPrayerCompletionStatus(value: unknown): PrayerCompletionStatus | undefined {
  return value === 'on_time' || value === 'late' ? value : undefined;
}

function asFiniteNumber(value: unknown, label: string, allowNegative = false): number {
  const result = Number(asString(value));
  if (!Number.isFinite(result) || (!allowNegative && result < 0)) {
    throw new Error(`${label} must be a finite ${allowNegative ? '' : 'non-negative '}number.`);
  }
  return result;
}

function asTaskCategory(value: unknown): Task['category'] | 'any' {
  return value === 'daily' || value === 'prayer' || value === 'task' || value === 'goal' ? value : 'any';
}

function asTaskTab(value: unknown): AssistantTaskTab | undefined {
  return value === 'today' || value === 'all' || value === 'goals' ? value : undefined;
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
  callId: string,
  context: AssistantCommandContext,
  handlers: AssistantActionHandlers,
  _lang: AssistantLang,
  dialogState?: AssistantDialogState,
  activity?: AssistantActivitySource,
): ClarifyOutcome | ExecutedStepOutcome {
  switch (step.capability) {
    case 'inventory.lookup': {
      const query = asString(step.args.query).toLocaleLowerCase();
      if (!query) return { kind: 'clarify', reason: 'What should I check in Inventory?' };
      const matches = (context.inventoryItems || []).filter(item => !item.archivedAt && [
        item.name, item.brand, item.model, item.location, item.category, item.subcategory,
        JSON.stringify(item.dimensions || ''), ...item.tags,
        ...Object.keys(item.specifications), ...Object.values(item.specifications),
      ].some(value => (value || '').toLocaleLowerCase().includes(query)));
      const needs = (context.inventoryNeeds || []).filter(need => (
        need.status === 'needed' || need.status === 'ordered'
      ) && [
        need.name,
        JSON.stringify(need.dimensions || ''),
        ...Object.keys(need.specifications),
        ...Object.values(need.specifications),
      ].some(value => (value || '').toLocaleLowerCase().includes(query)));
      const refs = matches.slice(0, 5).map(item => (
        makeEntityReference('inventory_item', item.id, item.name, 'inventory', 1)
      ));
      const facts = matches.length > 0
        ? matches.slice(0, 8).map(item => `${item.name}: ${item.quantity} ${item.unit}${item.location ? ` at ${item.location}` : ''}.`)
        : [`No owned Inventory items matched “${asString(step.args.query)}”.`];
      if (needs.length > 0) facts.push(`${needs.length} matching open need${needs.length === 1 ? '' : 's'}.`);
      const summary = matches.length > 0
        ? `Found ${matches.length} owned Inventory match${matches.length === 1 ? '' : 'es'}.`
        : 'No owned Inventory match found.';
      return {
        stepResult: { callId, capability: step.capability, status: 'completed', summary, entityRefs: refs },
        toolResult: { callId, capability: step.capability, status: 'completed', summary, facts, entityRefs: refs },
        refs,
      };
    }

    case 'inventory.add_item': {
      if (!handlers.addInventoryItem) return { kind: 'clarify', reason: 'Inventory editing is unavailable in this surface.' };
      const now = getNow(context).toISOString();
      const draft = normalizeInventoryItemDraft({
        name: asString(step.args.name),
        quantity: asFiniteNumber(step.args.quantity, 'Quantity'),
        unit: asString(step.args.unit),
        category: asString(step.args.category) as never,
        trackingMode: asString(step.args.trackingMode) as never,
        condition: (asString(step.args.condition) || 'unknown') as never,
        subcategory: (asString(step.args.subcategory) || undefined) as never,
        brand: asString(step.args.brand) || undefined,
        model: asString(step.args.model) || undefined,
        location: asString(step.args.location) || undefined,
        imageUrl: asString(step.args.imageUrl) || undefined,
        projectCatalogKeys: Array.isArray(step.args.projectCatalogKeys) ? step.args.projectCatalogKeys : [],
        dimensions: parseAssistantInventoryDimensions(step.args.dimensions),
        specifications: parseAssistantInventorySpecifications(step.args.specifications),
        tags: [],
        notes: '',
        lastVerifiedAt: now,
      }, now);
      const id = handlers.addInventoryItem(draft);
      context.inventoryItems = [...(context.inventoryItems || []), { ...draft, id, createdAt: now, updatedAt: now }];
      const ref = makeEntityReference('inventory_item', id, draft.name, 'inventory', 1);
      const summary = `Added ${draft.name} to Inventory.`;
      const facts = [`Owned: ${draft.quantity} ${draft.unit}.`, `Category: ${draft.category}.`];
      recordAssistantActivity(handlers, activity, { domain: 'inventory', action: 'created', summary, details: facts, refs: [ref] });
      return {
        stepResult: { callId, capability: step.capability, status: 'completed', summary, entityRefs: [ref] },
        toolResult: { callId, capability: step.capability, status: 'completed', summary, facts, entityRefs: [ref] },
        refs: [ref],
      };
    }

    case 'inventory.adjust_quantity': {
      if (!handlers.adjustInventoryQuantity) return { kind: 'clarify', reason: 'Inventory editing is unavailable in this surface.' };
      const itemId = asString(step.args.itemId);
      const item = (context.inventoryItems || []).find(entry => entry.id === itemId && !entry.archivedAt);
      if (!item) return { kind: 'clarify', reason: 'Which Inventory item should I adjust?' };
      const delta = asFiniteNumber(step.args.delta, 'Quantity adjustment', true);
      const nextQuantity = normalizeInventoryQuantity(item.quantity + delta);
      handlers.adjustInventoryQuantity(item.id, delta);
      item.quantity = nextQuantity;
      item.lastVerifiedAt = getNow(context).toISOString();
      const ref = makeEntityReference('inventory_item', item.id, item.name, 'inventory', 1);
      const summary = `Updated ${item.name} to ${nextQuantity} ${item.unit}.`;
      recordAssistantActivity(handlers, activity, { domain: 'inventory', action: 'updated', summary, details: [`Adjustment: ${delta}.`], refs: [ref] });
      return {
        stepResult: { callId, capability: step.capability, status: 'completed', summary, entityRefs: [ref] },
        toolResult: { callId, capability: step.capability, status: 'completed', summary, facts: [`New quantity: ${nextQuantity} ${item.unit}.`], entityRefs: [ref] },
        refs: [ref],
      };
    }

    case 'inventory.add_need': {
      if (!handlers.addInventoryNeed) return { kind: 'clarify', reason: 'Inventory editing is unavailable in this surface.' };
      const draft = normalizeInventoryNeedDraft({
        name: asString(step.args.name),
        requiredQuantity: asFiniteNumber(step.args.requiredQuantity, 'Required quantity'),
        unit: asString(step.args.unit),
        category: (asString(step.args.category) || undefined) as never,
        subcategory: (asString(step.args.subcategory) || undefined) as never,
        imageUrl: asString(step.args.imageUrl) || undefined,
        linkedItemId: asString(step.args.linkedItemId) || undefined,
        projectCatalogKey: asString(step.args.projectCatalogKey) || undefined,
        priority: (asString(step.args.priority) || 'normal') as never,
        status: 'needed',
        dimensions: parseAssistantInventoryDimensions(step.args.dimensions),
        specifications: parseAssistantInventorySpecifications(step.args.specifications),
        notes: asString(step.args.notes),
      });
      const id = handlers.addInventoryNeed(draft);
      const now = getNow(context).toISOString();
      context.inventoryNeeds = [...(context.inventoryNeeds || []), { ...draft, id, createdAt: now, updatedAt: now }];
      const ref = makeEntityReference('inventory_need', id, draft.name, 'inventory', 1);
      const summary = `Added a need for ${draft.name}.`;
      const facts = [`Needed: ${draft.requiredQuantity} ${draft.unit}.`, `Priority: ${draft.priority}.`];
      recordAssistantActivity(handlers, activity, { domain: 'inventory', action: 'created', summary, details: facts, refs: [ref] });
      return {
        stepResult: { callId, capability: step.capability, status: 'completed', summary, entityRefs: [ref] },
        toolResult: { callId, capability: step.capability, status: 'completed', summary, facts, entityRefs: [ref] },
        refs: [ref],
      };
    }

    case 'inventory.complete_need': {
      if (!handlers.completeInventoryNeed) return { kind: 'clarify', reason: 'Inventory editing is unavailable in this surface.' };
      const needId = asString(step.args.needId);
      const need = (context.inventoryNeeds || []).find(entry => entry.id === needId);
      if (!need || need.status === 'dismissed') return { kind: 'clarify', reason: 'Which open Inventory need was acquired?' };
      handlers.completeInventoryNeed(need.id);
      need.status = 'acquired';
      need.acquiredAt = getNow(context).toISOString();
      const ref = makeEntityReference('inventory_need', need.id, need.name, 'inventory', 1);
      const summary = `Marked ${need.name} acquired.`;
      const facts = [`Added ${need.requiredQuantity} ${need.unit} to owned stock and closed the need.`];
      recordAssistantActivity(handlers, activity, { domain: 'inventory', action: 'completed', summary, details: facts, refs: [ref] });
      return {
        stepResult: { callId, capability: step.capability, status: 'completed', summary, entityRefs: [ref] },
        toolResult: { callId, capability: step.capability, status: 'completed', summary, facts, entityRefs: [ref] },
        refs: [ref],
      };
    }

    case 'navigation.go_to_surface': {
      const surfaceValue = step.args.surface;
      if (typeof surfaceValue !== 'string') {
        return { kind: 'clarify', reason: 'Which part of Sabah One should I open?' };
      }

      const surface = surfaceValue as Surface;
      const navigate = handlers.navigate || requestAssistantNavigation;
      const projectId = asString(step.args.projectId);
      const navigationRequest = normalizeAssistantNavigationRequest(
        surface === 'projects' && projectId
          ? {
            surface,
            surfaceState: {
              projects: {
                revealProjectId: projectId,
              },
            },
          }
          : surface,
      );
      navigate(navigationRequest);

      const ref = surface === 'projects' && projectId
        ? (() => {
          const project = context.projects.find(item => item.id === projectId);
          return project
            ? makeEntityReference('project', project.id, project.name, 'projects', 1)
            : makeEntityReference('surface', surface, SURFACE_LABELS[surface].en, surface, 1);
        })()
        : makeEntityReference('surface', surface, SURFACE_LABELS[surface].en, surface, 1);
      const summary = surface === 'projects' && projectId && ref.kind === 'project'
        ? `Opened project "${ref.label}".`
        : `Opened ${SURFACE_LABELS[surface].en}.`;
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts: [
            surface === 'projects' && projectId && ref.kind === 'project'
              ? `Navigated to the Projects surface and selected "${ref.label}".`
              : `Navigated to the ${SURFACE_LABELS[surface].en} surface.`,
          ],
          entityRefs: [ref],
          navigationRequest,
        },
        refs: [ref],
        navigationRequest,
      };
    }

    case 'tasks.open_view': {
      const tab = asTaskTab(step.args.tab);
      if (!tab) {
        return { kind: 'clarify', reason: 'Which Tasks view should I open?' };
      }

      const navigate = handlers.navigate || requestAssistantNavigation;
      const navigationRequest = normalizeAssistantNavigationRequest({
        surface: 'tasks',
        surfaceState: {
          tasks: {
            tab,
            resetFilters: asBoolean(step.args.resetFilters) ?? false,
          },
        },
      });
      navigate(navigationRequest);

      const ref = makeEntityReference('surface', 'tasks', SURFACE_LABELS.tasks.en, 'tasks', 1);
      const tabLabel = tab === 'all' ? 'All Tasks' : tab === 'goals' ? 'Goals' : 'Today';
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary: `Opened the ${tabLabel} task view.`,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary: `Opened the ${tabLabel} task view.`,
          facts: [
            `Opened the Tasks surface on the ${tabLabel} tab.`,
          ],
          entityRefs: [ref],
          navigationRequest,
        },
        refs: [ref],
        navigationRequest,
      };
    }

    case 'tasks.create_task': {
      const title = asString(step.args.title);
      if (!title) {
        return { kind: 'clarify', reason: 'What should I call the task?' };
      }

      const priority = step.args.priority === 'high' || step.args.priority === 'low' ? step.args.priority : 'medium';
      const category = step.args.category === 'daily' || step.args.category === 'prayer' || step.args.category === 'goal' ? step.args.category : 'task';
      const dueDate = asString(step.args.dueDate);
      const id = handlers.addTask({
        title,
        description: '',
        completed: false,
        priority,
        category,
        dueDate: dueDate || undefined,
        recurring: category === 'daily' || category === 'prayer' ? { frequency: 'daily' } : undefined,
      });
      const now = getNow(context).toISOString();
      const createdTask: Task = {
        id,
        title,
        description: '',
        completed: false,
        priority,
        category,
        dueDate: dueDate || undefined,
        recurring: category === 'daily' || category === 'prayer' ? { frequency: 'daily' } : undefined,
        createdAt: now,
        updatedAt: now,
      };
      context.tasks = [...context.tasks, createdTask];

      const ref = makeEntityReference('task', id, title, 'tasks', 1);
      const summary = `Created task "${title}".`;
      const facts = [
        `Created the task "${title}".`,
        `Priority: ${priority}.`,
        `Category: ${category}.`,
        ...(dueDate ? [`Due date: ${dueDate}.`] : []),
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'tasks',
        action: 'created',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: { type: 'task.delete', id },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
        undoToken: JSON.stringify({ type: 'task.delete', id }),
      };
    }

    case 'tasks.complete_matching': {
      const taskId = asString(step.args.taskId);
      const task = taskId
        ? context.tasks.find(item => item.id === taskId && !item.completed) || null
        : null;
      const legacyTaskQuery = asString(step.args.taskQuery);
      const legacyResolution = !task && legacyTaskQuery
        ? findOrClarifyTask(legacyTaskQuery, context, dialogState, {
            category: asTaskCategory(step.args.category),
            allowCompleted: false,
          })
        : { task: null as Task | null, clarify: undefined as string | undefined };
      if (!task && !legacyResolution.task) {
        return { kind: 'clarify', reason: legacyResolution.clarify || 'Which task should I complete?' };
      }

      const resolvedTask = task || legacyResolution.task;
      if (!resolvedTask) {
        return { kind: 'clarify', reason: 'Which task should I complete?' };
      }
      const prayerName = getPrayerTaskName(resolvedTask);
      if (prayerName) {
        const prayerStatus = asPrayerCompletionStatus(step.args.prayerStatus);
        if (!prayerStatus) {
          return {
            kind: 'clarify',
            reason: buildPrayerStatusQuestion(prayerName, _lang),
            pendingPrayerCompletion: {
              prayerName,
              taskId: resolvedTask.id,
              toolCall: {
                callId,
                capability: step.capability,
                args: { ...step.args, taskId: resolvedTask.id },
                unresolved: step.unresolved,
                requiresConfirmation: step.requiresConfirmation,
              },
            },
          };
        }
        if (!handlers.completePrayer) {
          return {
            kind: 'clarify',
            reason: 'Prayer completion tracking is not available in this surface.',
          };
        }

        const completion = handlers.completePrayer(prayerName, prayerStatus, resolvedTask.id);
        const now = getNow(context);
        const today = toLocalDateStr(now);
        const completedAt = now.toISOString();
        context.tasks = context.tasks.map(item =>
          item.id === resolvedTask.id
            ? {
                ...item,
                completed: true,
                completedAt,
                recurring: resolvedTask.recurring
                  ? { ...resolvedTask.recurring, lastReset: today }
                  : undefined,
              }
            : item
        );

        const ref = makeEntityReference('task', resolvedTask.id, resolvedTask.title, 'tasks', 1);
        const statusLabel = prayerStatus === 'on_time' ? 'on time' : 'late';
        const summary = `Completed "${resolvedTask.title}" as ${statusLabel}.`;
        const facts = [
          `Marked ${prayerName} as prayed ${statusLabel}.`,
          completion.xpEarned > 0
            ? `Awarded ${completion.xpEarned} XP.`
            : 'No additional XP was awarded.',
        ];
        recordAssistantActivity(handlers, activity, {
          domain: 'tasks',
          action: 'completed',
          summary,
          details: facts,
          refs: [ref],
          undoOperation: {
            type: 'prayer.complete',
            inverse: completion.undo,
          },
        });
        return {
          stepResult: {
            callId,
            capability: step.capability,
            status: 'completed',
            summary,
            entityRefs: [ref],
          },
          toolResult: {
            callId,
            capability: step.capability,
            status: 'completed',
            summary,
            facts,
            entityRefs: [ref],
          },
          refs: [ref],
          undoToken: JSON.stringify({
            type: 'task.reopen',
            id: resolvedTask.id,
            prayerStatus,
          }),
        };
      }

      const taskBefore: Task = {
        ...resolvedTask,
        recurring: resolvedTask.recurring ? { ...resolvedTask.recurring } : undefined,
      };
      const gamificationBefore = handlers.updateGamification ? cloneGamification(context.gamification) : undefined;
      const now = getNow(context);
      const today = toLocalDateStr(now);
      const completedAt = now.toISOString();
      handlers.updateTask(resolvedTask.id, {
        completed: true,
        completedAt,
        ...(resolvedTask.recurring ? { recurring: { ...resolvedTask.recurring, lastReset: today } } : {}),
      });
      context.tasks = context.tasks.map(item =>
        item.id === resolvedTask.id ? { ...item, completed: true, completedAt, recurring: resolvedTask.recurring ? { ...resolvedTask.recurring, lastReset: today } : undefined } : item
      );

      if (handlers.updateGamification) {
        const todayLog = context.gamification.dailyLog?.[today] || [];
        const alreadyRewarded = isHabitTask(resolvedTask) && todayLog.includes(resolvedTask.id);
        if (!alreadyRewarded) {
          const completionsToday = context.tasks.filter(item => item.completed && item.completedAt?.startsWith(today)).length;
          const extCtx = buildCompletionContext(context.tasks, context.goalTags, today, context.gamification, {
            knowledgeEntries: context.knowledgeEntries.length,
            knowledgeTopics: context.knowledgeTopics.length,
            lifestyleHaramMastered: context.lifestyleItems.filter(item => item.type === 'haram' && item.status === 'mastered').length,
            lifestyleHalalConsistent: context.lifestyleItems.filter(item => item.type === 'halal' && item.status === 'consistent').length,
            lifestyleTotal: context.lifestyleItems.length,
          });
          let profile = processTaskCompletion(context.gamification, resolvedTask, completionsToday, now, extCtx).updatedProfile;
          if (isHabitTask(resolvedTask)) {
            profile = recordHabitCompletion(profile, resolvedTask.id, today);
          }
          handlers.updateGamification(profile);
          context.gamification = profile;
        }
      }

      const ref = makeEntityReference('task', resolvedTask.id, resolvedTask.title, 'tasks', 1);
      const summary = `Completed "${resolvedTask.title}".`;
      const facts = [
        `${isHabitTask(resolvedTask) ? 'Marked the habit' : 'Marked the task'} "${resolvedTask.title}" as complete.`,
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'tasks',
        action: 'completed',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: {
          type: 'task.replace',
          task: taskBefore,
          ...(gamificationBefore ? { gamification: gamificationBefore } : {}),
        },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
        undoToken: JSON.stringify({ type: 'task.reopen', id: resolvedTask.id }),
      };
    }

    case 'tasks.delete_matching': {
      if (!handlers.removeTask) {
        return {
          kind: 'clarify',
          reason: 'Task deletion is not available in this surface.',
        };
      }

      const taskIds = Array.isArray(step.args.taskIds)
        ? step.args.taskIds.filter((item): item is string => typeof item === 'string')
        : [];
      const tasksToDelete = taskIds.length > 0
        ? context.tasks.filter(task => taskIds.includes(task.id))
        : (() => {
            const taskQuery = asString(step.args.taskQuery);
            const category = asTaskCategory(step.args.category);
            const resolution = findTasksForDeletion(taskQuery, context, dialogState, {
              category,
              scope: step.args.matchScope === 'all' ? 'all' : 'one',
            });

            if (resolution.tasks.length === 0) {
              return [];
            }

            return resolution.tasks;
          })();
      if (tasksToDelete.length === 0) {
        return { kind: 'clarify', reason: 'Which task should I delete?' };
      }

      const deletedTaskSnapshots = tasksToDelete.map(task => ({
        ...task,
        recurring: task.recurring ? { ...task.recurring } : undefined,
      }));
      for (const task of tasksToDelete) {
        handlers.removeTask(task.id);
      }
      const deletedIds = new Set(tasksToDelete.map(task => task.id));
      context.tasks = context.tasks.filter(task => !deletedIds.has(task.id));

      const refs = tasksToDelete.map(task => makeEntityReference('task', task.id, task.title, 'tasks', 1));
      const summary = tasksToDelete.length === 1
        ? `Deleted "${tasksToDelete[0].title}".`
        : `Deleted ${tasksToDelete.length} tasks.`;
      const facts = tasksToDelete.length === 1
        ? [`Deleted the task "${tasksToDelete[0].title}".`]
        : [
            `Deleted ${tasksToDelete.length} tasks.`,
            `Deleted titles: ${tasksToDelete.map(task => `"${task.title}"`).join(', ')}.`,
          ];
      recordAssistantActivity(handlers, activity, {
        domain: 'tasks',
        action: 'deleted',
        summary,
        details: facts,
        refs,
        undoOperation: { type: 'task.restore', tasks: deletedTaskSnapshots },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: refs,
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: refs,
        },
        refs,
      };
    }

    case 'tasks.reveal_task': {
      const taskId = asString(step.args.taskId);
      const task = taskId
        ? context.tasks.find(item => item.id === taskId) || null
        : null;
      const legacyTaskQuery = asString(step.args.taskQuery);
      const resolution = !task
        ? findOrClarifyTask(legacyTaskQuery || 'that task', context, dialogState, {
            category: 'any',
            allowCompleted: true,
          })
        : { task, clarify: undefined as string | undefined };
      if (!resolution.task) {
        return { kind: 'clarify', reason: resolution.clarify || 'Which task should I show you?' };
      }

      const resolvedTask = resolution.task;
      const navigate = handlers.navigate || requestAssistantNavigation;
      const navigationRequest = normalizeAssistantNavigationRequest({
        surface: 'tasks',
        surfaceState: {
          tasks: {
            tab: resolvedTask.category === 'goal' ? 'goals' : 'all',
            resetFilters: true,
            revealTaskId: resolvedTask.id,
            highlightTaskId: resolvedTask.id,
          },
        },
      });
      navigate(navigationRequest);

      const ref = makeEntityReference('task', resolvedTask.id, resolvedTask.title, 'tasks', 1);
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary: `Revealed task "${resolvedTask.title}".`,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary: `Revealed task "${resolvedTask.title}".`,
          facts: [
            `Opened the Tasks surface and highlighted "${resolvedTask.title}".`,
          ],
          entityRefs: [ref],
          navigationRequest,
        },
        refs: [ref],
        navigationRequest,
      };
    }

    case 'calendar.create_event': {
      if (!handlers.addCalendarEvent) {
        return { kind: 'clarify', reason: 'Calendar event creation is not available in this surface.' };
      }

      const title = asString(step.args.title);
      if (!title) {
        return { kind: 'clarify', reason: 'What should I call the event?' };
      }

      const calendarSourceId = asString(step.args.calendarSourceId);
      const calendarChoice = calendarSourceId
        ? {
            source: context.calendarSources.find(item => item.id === calendarSourceId) || null,
            clarify: undefined as string | undefined,
          }
        : pickCalendarSource(context, asString(step.args.calendarQuery));
      if (!calendarChoice.source) {
        return { kind: 'clarify', reason: calendarChoice.clarify || 'Which calendar should I use?' };
      }
      if (!canApplyLocalCalendarMutation(calendarChoice.source, context.calendarAccounts)) {
        return {
          kind: 'clarify',
          reason: 'Google Calendar is synced live, so I will not create an offline calendar copy from chat. Open Calendar to add it directly to Google.',
        };
      }

      const extracted = extractTemporalReference(asString(step.args.timePhrase), context);
      const start = asString(step.args.start) || extracted.resolution?.start;
      const end = asString(step.args.end) || extracted.resolution?.end;
      if (!start || !end) {
        return { kind: 'clarify', reason: 'When should I schedule it?' };
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
      const createdEvent: CalendarEvent = {
        id,
        sourceId: calendarChoice.source.id,
        title,
        description: asString(step.args.description),
        start,
        end,
        allDay: false,
        location: asString(step.args.location) || undefined,
      };
      context.calendarEvents = [...context.calendarEvents, createdEvent];

      const ref = makeEntityReference('calendar_event', id, title, 'calendar', 1);
      const summary = `Created event "${title}".`;
      const facts = [
        `Created the calendar event "${title}".`,
        `Calendar: ${calendarChoice.source.name}.`,
        `Start: ${start}.`,
        `End: ${end}.`,
        ...(asString(step.args.location) ? [`Location: ${asString(step.args.location)}.`] : []),
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'calendar',
        action: 'created',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: { type: 'calendar.delete', id },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
        undoToken: JSON.stringify({ type: 'calendar.delete', id }),
      };
    }

    case 'calendar.reschedule_event': {
      if (!handlers.updateCalendarEvent) {
        return { kind: 'clarify', reason: 'Calendar rescheduling is not available in this surface.' };
      }

      const eventId = asString(step.args.eventId);
      const selectedEvent = eventId
        ? context.calendarEvents.find(item => item.id === eventId) || null
        : null;
      const eventResolution = !selectedEvent
        ? findOrClarifyEvent(asString(step.args.eventQuery), context)
        : {
            event: selectedEvent,
            clarify: undefined as string | undefined,
          };
      if (!eventResolution.event) {
        return { kind: 'clarify', reason: eventResolution.clarify || 'Which event should I move?' };
      }
      const eventSource = context.calendarSources.find(source => source.id === eventResolution.event?.sourceId) || null;
      if (!canApplyLocalCalendarMutation(eventSource, context.calendarAccounts)) {
        return {
          kind: 'clarify',
          reason: 'Google Calendar is synced live, so I will not move an offline calendar copy from chat. Open Calendar to change it directly in Google.',
        };
      }

      const extracted = extractTemporalReference(asString(step.args.timePhrase), context);
      const start = asString(step.args.start) || extracted.resolution?.start;
      const end = asString(step.args.end) || extracted.resolution?.end;
      if (!start || !end) {
        return { kind: 'clarify', reason: 'What time should I move it to?' };
      }

      const resolvedEvent = eventResolution.event;
      const eventBefore: CalendarEvent = { ...resolvedEvent };
      handlers.updateCalendarEvent(resolvedEvent.id, { start, end, allDay: false });
      context.calendarEvents = context.calendarEvents.map(item =>
        item.id === resolvedEvent.id ? { ...item, start, end, allDay: false } : item
      );

      const ref = makeEntityReference('calendar_event', resolvedEvent.id, resolvedEvent.title, 'calendar', 1);
      const summary = `Moved "${resolvedEvent.title}".`;
      const facts = [
        `Moved the event "${resolvedEvent.title}".`,
        `Previous start: ${resolvedEvent.start}.`,
        `Previous end: ${resolvedEvent.end}.`,
        `New start: ${start}.`,
        `New end: ${end}.`,
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'calendar',
        action: 'updated',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: { type: 'calendar.replace', event: eventBefore },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
        undoToken: JSON.stringify({
          type: 'calendar.reschedule',
          id: resolvedEvent.id,
          start: resolvedEvent.start,
          end: resolvedEvent.end,
        }),
      };
    }

    case 'finance.record_transaction': {
      if (!handlers.addTransaction) {
        return { kind: 'clarify', reason: 'Finance logging is not available in this surface.' };
      }

      const type = step.args.type === 'income' ? 'income' : 'expense';
      const amountRaw = asString(step.args.amount);
      const amount = parseToPence(amountRaw.replace(/[£$,]/g, ''));
      if (amount <= 0) {
        return { kind: 'clarify', reason: 'What amount should I record?' };
      }

      const accountId = asString(step.args.accountId);
      const accountChoice = accountId
        ? {
            account: context.financeAccounts.find(item => item.id === accountId) || null,
            clarify: undefined as string | undefined,
          }
        : pickFinanceAccount(context, asString(step.args.accountQuery));
      if (!accountChoice.account) {
        return { kind: 'clarify', reason: accountChoice.clarify || 'Which account should I use?' };
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
      const transaction: Transaction = {
        id,
        type,
        amount,
        category,
        accountId: accountChoice.account.id,
        description,
        date,
        createdAt: now,
        updatedAt: now,
      };
      context.transactions = [transaction, ...context.transactions];

      const ref = makeEntityReference('finance_account', accountChoice.account.id, accountChoice.account.name, 'finance', 1);
      const summary = `Recorded ${type} of ${formatGBP(amount)}.`;
      const facts = [
        `Recorded a ${type} transaction.`,
        `Amount: ${formatGBP(amount)}.`,
        `Account: ${accountChoice.account.name}.`,
        `Description: ${description}.`,
        `Date: ${date}.`,
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'finance',
        action: 'recorded',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: { type: 'finance.delete_transaction', id },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
      };
    }

    case 'knowledge.create_entry': {
      if (!handlers.addKnowledgeEntry) {
        return { kind: 'clarify', reason: 'Knowledge capture is not available in this surface.' };
      }

      const topicId = asString(step.args.topicId);
      const topicChoice = topicId
        ? {
            topic: context.knowledgeTopics.find(item => item.id === topicId) || null,
            clarify: undefined as string | undefined,
          }
        : pickKnowledgeTopic(context, asString(step.args.topicQuery));
      if (!topicChoice.topic) {
        return { kind: 'clarify', reason: topicChoice.clarify || 'Which topic should I use?' };
      }

      const title = asString(step.args.title) || 'Quick note';
      const content = asString(step.args.content);
      if (!content) {
        return { kind: 'clarify', reason: 'What note should I save?' };
      }

      const id = handlers.addKnowledgeEntry({
        topicId: topicChoice.topic.id,
        title,
        content,
        sources: [],
        tags: [],
      });
      const now = getNow(context).toISOString();
      const entry = {
        id,
        topicId: topicChoice.topic.id,
        title,
        content,
        sources: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      context.knowledgeEntries = [...context.knowledgeEntries, entry];

      const ref = makeEntityReference('knowledge_entry', id, title, 'knowledge', 1);
      const summary = `Saved note "${title}".`;
      const facts = [
        `Saved the note "${title}".`,
        `Topic: ${topicChoice.topic.name}.`,
      ];
      recordAssistantActivity(handlers, activity, {
        domain: 'knowledge',
        action: 'saved',
        summary,
        details: facts,
        refs: [ref],
        undoOperation: { type: 'knowledge.delete_entry', id },
      });
      return {
        stepResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          entityRefs: [ref],
        },
        toolResult: {
          callId,
          capability: step.capability,
          status: 'completed',
          summary,
          facts,
          entityRefs: [ref],
        },
        refs: [ref],
      };
    }
  }
}

export function executeActionPlan(
  plan: ActionPlan,
  context: AssistantCommandContext,
  handlers: AssistantActionHandlers,
  _lang: AssistantLang,
  dialogState?: AssistantDialogState,
  toolCalls?: Array<{ callId: string }>,
  activity?: AssistantActivitySource,
): ExecutionOutcome {
  for (const [index, step] of plan.steps.entries()) {
    if (step.capability !== 'tasks.complete_matching' || asPrayerCompletionStatus(step.args.prayerStatus)) {
      continue;
    }

    const taskId = asString(step.args.taskId);
    const task = taskId
      ? context.tasks.find(item => item.id === taskId && !item.completed) || null
      : null;
    const legacyTaskQuery = asString(step.args.taskQuery);
    const legacyResolution = !task && legacyTaskQuery
      ? findOrClarifyTask(legacyTaskQuery, context, dialogState, {
          category: asTaskCategory(step.args.category),
          allowCompleted: false,
        })
      : { task: null as Task | null };
    const resolvedTask = task || legacyResolution.task;
    const prayerName = resolvedTask ? getPrayerTaskName(resolvedTask) : null;
    if (!resolvedTask || !prayerName) continue;

    const callId = toolCalls?.[index]?.callId || `call_${index + 1}`;
    return {
      kind: 'clarify',
      reason: buildPrayerStatusQuestion(prayerName, _lang),
      pendingPrayerCompletion: {
        prayerName,
        taskId: resolvedTask.id,
        toolCall: {
          callId,
          capability: step.capability,
          args: { ...step.args, taskId: resolvedTask.id },
          unresolved: step.unresolved,
          requiresConfirmation: step.requiresConfirmation,
        },
      },
    };
  }

  const workingContext = cloneContext(context);
  const steps: AssistantExecutionStep[] = [];
  const toolResults: AssistantToolResult[] = [];
  const refs: AssistantEntityReference[] = [];
  const undoTokens: string[] = [];
  const navigationRequests: AssistantNavigationRequest[] = [];

  for (const [index, step] of plan.steps.entries()) {
    const capability = getCapabilityDefinition(step.capability);
    const callId = toolCalls?.[index]?.callId || `call_${index + 1}`;
    const result = executeSingleStep(step, callId, workingContext, handlers, _lang, dialogState, activity);
    if ('kind' in result) {
      return result;
    }

    steps.push(result.stepResult);
    toolResults.push(result.toolResult);
    refs.push(...result.refs);
    if (result.undoToken && capability.confirmationRule !== 'never') {
      undoTokens.push(result.undoToken);
    }
    if (result.navigationRequest) {
      navigationRequests.push(result.navigationRequest);
    }
  }

  return {
    kind: 'executed',
    referencedEntities: refs,
    execution: {
      status: steps.length > 0 ? 'executed' : 'skipped',
      toolResults,
      steps,
      undoToken: undoTokens.length > 0 ? undoTokens.join('|') : undefined,
      navigationRequests: navigationRequests.length > 0 ? navigationRequests : undefined,
    },
  };
}

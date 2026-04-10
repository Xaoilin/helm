import type {
  AssistantCorrection,
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  GamificationProfile,
  KnowledgeEntry,
  KnowledgeTopic,
  LifestyleItem,
  Settings,
  AssistantProvider,
  Surface,
  Task,
  Transaction,
  Workspace,
} from '../types/domain';
import type { AssistantNavigationHandler, AssistantNavigationRequest } from '../services/assistantNavigation';
import type { ActionPlan } from './plannerSchema';

export type AssistantLang = 'en' | 'ar';

export interface AssistantConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PrayerTimeSnapshot {
  name: string;
  time: string;
}

export type AssistantEntityKind =
  | 'task'
  | 'calendar_event'
  | 'calendar_source'
  | 'calendar_account'
  | 'finance_account'
  | 'knowledge_entry'
  | 'knowledge_topic'
  | 'workspace'
  | 'surface';

export interface AssistantEntityReference {
  kind: AssistantEntityKind;
  id: string;
  label: string;
  surface?: Surface;
  score?: number;
  lastUsedAt: string;
}

export interface AssistantDialogPlanReference {
  mode: ActionPlan['mode'];
  capabilityIds: string[];
  response: string;
  createdAt: string;
}

export interface AssistantDialogState {
  currentSurface?: Surface;
  recentEntities: AssistantEntityReference[];
  recentPlans: AssistantDialogPlanReference[];
  pendingConfirmation?: ActionPlan;
}

export interface AssistantCommandContext {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  knowledgeEntries: KnowledgeEntry[];
  knowledgeTopics: KnowledgeTopic[];
  lifestyleItems: LifestyleItem[];
  workspaces: Workspace[];
  gamification: GamificationProfile;
  prayerTimes?: PrayerTimeSnapshot[];
  goalTags?: Settings['goalTags'];
  currentSurface?: Surface;
  now?: Date;
  timezone?: string;
}

export interface AssistantActionHandlers {
  navigate?: AssistantNavigationHandler;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask?: (id: string) => void;
  upsertAssistantCorrection?: (correction: {
    sourceText: string;
    targetText: string;
    lang: AssistantLang;
    scope: AssistantCorrection['scope'];
  }) => string | null;
  noteAssistantCorrectionApplied?: (id: string) => void;
  addCalendarEvent?: (event: Omit<CalendarEvent, 'id'>) => string;
  updateCalendarEvent?: (id: string, updates: Partial<CalendarEvent>) => void;
  addTransaction?: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => string;
  addKnowledgeEntry?: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateGamification?: (profile: GamificationProfile) => void;
}

export interface AssistantCommandOptions {
  lang?: AssistantLang;
  conversationHistory?: AssistantConversationMessage[];
  corrections?: AssistantCorrection[];
  provider?: AssistantProvider;
  endpoint?: string;
  model?: string;
  dialogState?: AssistantDialogState;
  handlers?: AssistantActionHandlers;
}

export interface AssistantExecutionStep {
  capability: string;
  status: 'completed' | 'skipped';
  summary: string;
  entityRefs?: AssistantEntityReference[];
}

export interface AssistantExecutionResult {
  status: 'executed' | 'skipped';
  steps: AssistantExecutionStep[];
  undoToken?: string;
  navigationRequests?: AssistantNavigationRequest[];
}

export interface AssistantCommandResult {
  message: string;
  plan: ActionPlan;
  dialogState: AssistantDialogState;
  execution?: AssistantExecutionResult;
  referencedEntities?: AssistantEntityReference[];
  degradedReason?:
    | 'ollama_offline'
    | 'ollama_error'
    | 'hosted_sign_in_required'
    | 'hosted_not_configured'
    | 'hosted_error'
    | 'unsupported_without_ai';
  source: 'local' | 'ollama' | 'openai' | 'degraded';
}

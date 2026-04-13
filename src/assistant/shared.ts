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
import type { CapabilityId } from './capabilities';
import type { ActionPlan, ActionPlanStepArgs } from './plannerSchema';

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

export type AssistantConversationMode = 'reply' | 'clarify' | 'confirm' | 'tool_calls';

export interface AssistantToolCallDraft {
  capability: CapabilityId;
  args: ActionPlanStepArgs;
  unresolved?: string[];
  requiresConfirmation?: boolean;
}

export interface AssistantToolCall extends AssistantToolCallDraft {
  callId: string;
}

export interface AssistantPendingConfirmation {
  assistantMessage: string;
  toolCalls: AssistantToolCall[];
  referencedEntities: AssistantEntityReference[];
  createdAt: string;
  source: AssistantPlanningSource;
  planningModel?: string;
}

export interface AssistantModelTurn {
  mode: AssistantConversationMode;
  assistantMessage: string;
  toolCalls: AssistantToolCall[];
}

export interface AssistantPlanningCapabilityCandidate {
  id: string;
  title: string;
  domain: string;
  description: string;
  confirmationRule: string;
  score: number;
  examples: string[];
  aliases: string[];
}

export interface AssistantPlanningEntityCandidate {
  kind: AssistantEntityKind;
  id: string;
  label: string;
  surface?: Surface;
  score: number;
  detail?: string;
}

export interface AssistantPlanningExample {
  id: string;
  transcript: string;
  expectedMode: ActionPlan['mode'];
  expectedCapabilities: string[];
}

export interface AssistantTemporalCandidate {
  phrase: string;
  start: string;
  end: string;
}

export interface AssistantPlanningBundle {
  transcript: string;
  normalizedTranscript: string;
  currentSurface?: Surface;
  nowIso: string;
  timezone: string;
  recentEntities: AssistantEntityReference[];
  recentPlans: AssistantDialogPlanReference[];
  capabilities: AssistantPlanningCapabilityCandidate[];
  entityCandidates: {
    surfaces: AssistantPlanningEntityCandidate[];
    tasks: AssistantPlanningEntityCandidate[];
    calendarEvents: AssistantPlanningEntityCandidate[];
    calendarSources: AssistantPlanningEntityCandidate[];
    financeAccounts: AssistantPlanningEntityCandidate[];
    knowledgeTopics: AssistantPlanningEntityCandidate[];
  };
  temporalCandidate?: AssistantTemporalCandidate;
  benchmarkExamples: AssistantPlanningExample[];
}

export type AssistantPlanningSource = 'openai' | 'ollama' | 'local' | 'none';
export type AssistantPlanningStatus =
  | 'planned'
  | 'blocked_provider_unavailable'
  | 'model_response_invalid'
  | 'validator_rejected'
  | 'local_confirmation'
  | 'local_correction';

export interface AssistantPlannerValidation {
  status: 'accepted' | 'rejected' | 'skipped';
  reason?: string;
}

export interface AssistantDialogState {
  currentSurface?: Surface;
  recentEntities: AssistantEntityReference[];
  recentPlans: AssistantDialogPlanReference[];
  pendingConfirmation?: AssistantPendingConfirmation;
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
  callId: string;
  capability: string;
  status: 'completed' | 'skipped';
  summary: string;
  entityRefs?: AssistantEntityReference[];
}

export interface AssistantToolResult {
  callId: string;
  capability: string;
  status: 'completed' | 'skipped' | 'failed';
  summary: string;
  facts: string[];
  entityRefs?: AssistantEntityReference[];
  navigationRequest?: AssistantNavigationRequest;
}

export interface AssistantExecutionResult {
  status: 'executed' | 'skipped';
  toolResults: AssistantToolResult[];
  steps: AssistantExecutionStep[];
  undoToken?: string;
  navigationRequests?: AssistantNavigationRequest[];
}

export interface AssistantCommandResult {
  assistantMessage: string;
  message: string;
  plan: ActionPlan;
  modelTurn?: AssistantModelTurn | null;
  toolCalls?: AssistantToolCall[];
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
  planningSource: AssistantPlanningSource;
  planningStatus: AssistantPlanningStatus;
  planningModel?: string;
  planningBundle?: AssistantPlanningBundle;
  rawPlannerResponse?: string;
  rawNarrationResponse?: string;
  parsedPlan?: ActionPlan | null;
  validatedPlan?: ActionPlan | null;
  plannerValidation?: AssistantPlannerValidation;
}

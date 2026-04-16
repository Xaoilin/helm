// ── Chat ──
export type AssistantReplyProvider = 'openai' | 'ollama' | 'local' | 'degraded';
export type AssistantBillingEstimateStatus = 'estimated_from_openai_usage';

export interface AssistantTokenUsageTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface OpenAIAssistantRequestBilling extends AssistantTokenUsageTotals {
  kind: 'planner' | 'narration';
  responseId?: string;
  model: string;
  serviceTier?: string;
  estimatedUsd: number;
}

export interface AssistantMessageBilling {
  provider: AssistantReplyProvider;
  model?: string;
  requestCount: number;
  requests: OpenAIAssistantRequestBilling[];
  totals?: AssistantTokenUsageTotals;
  estimatedUsd?: number;
  estimateStatus?: AssistantBillingEstimateStatus;
  estimateLabel?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  assistantBilling?: AssistantMessageBilling;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ── Calendar ──
export type CalendarAuthProvider = 'profile-google' | 'calendar-oauth';
export type CalendarAuthStatus = 'connected' | 'needs_reconnect' | 'revoked' | 'error';

export interface CalendarAccount {
  id: string;
  name: string;
  email: string;
  provider: 'google' | 'outlook' | 'caldav' | 'local';
  isPrimary: boolean;
  connected: boolean;
  mocked: boolean;
  lastSyncTime?: string;
  syncError?: string;
  paletteIndex?: number;
  authProvider?: CalendarAuthProvider;
  authStatus?: CalendarAuthStatus;
  authEmail?: string;
  authExpiresAt?: string;
  lastAuthError?: string;
  lastAuthCheckAt?: string;
}

export interface CalendarSource {
  id: string;
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
  googleCalendarId?: string;
  accessRole?: string;
}

export interface CalendarEvent {
  id: string;
  sourceId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  googleEventId?: string;
  googleCalendarId?: string;
  pendingSync?: 'create' | 'update' | 'delete';
}

// ── Projects ──
export type ProjectStatus = 'planning' | 'active' | 'blocked' | 'completed' | 'archived';
export type ProjectWorkflowState = 'backlog' | 'next_up' | 'in_progress' | 'blocked';

export interface Project {
  id: string;
  name: string;
  localPath?: string;
  summary: string;
  status: ProjectStatus;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPage {
  id: string;
  projectId: string;
  title: string;
  content: string;
  isOverview: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Integrations ──
export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'mocked';

export interface Integration {
  id: string;
  name: string;
  provider: string;
  description: string;
  status: IntegrationStatus;
  icon: string;
  configuredAt?: string;
  lastError?: string;
}

// ── Tasks ──
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskCategory = 'daily' | 'task' | 'goal';

export interface TaskRecurrence {
  frequency: 'daily' | 'weekdays' | 'weekly';
  lastReset?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  completedAt?: string;
  priority: TaskPriority;
  category: TaskCategory;
  dueDate?: string;
  recurring?: TaskRecurrence;
  goalTag?: string;
  emoji?: string;
  projectId?: string;
  workflowState?: ProjectWorkflowState;
  blockedReason?: string;
  boardOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export type FocusCandidateKind = 'task' | 'habit' | 'meeting_prep' | 'break' | 'clear';
export type FocusFeedbackAction = 'dismissed' | 'snoozed' | 'opened' | 'completed' | 'refreshed';

export interface DashboardFocusStats {
  overdueCount: number;
  dueTodayCount: number;
  routinesLeft: number;
  activeTaskCount: number;
}

export interface FocusCandidate {
  id: string;
  kind: FocusCandidateKind;
  title: string;
  subtitle: string;
  score: number;
  localWhy: string;
  reasoningTags: string[];
  estimatedMinutes?: number;
  taskId?: string;
  eventId?: string;
  projectId?: string;
  dueDate?: string;
  isUrgent?: boolean;
}

export interface FocusRecommendation {
  selectedCandidateId: string;
  why: string;
  confidence: number;
  reasoningTags: string[];
  estimatedMinutes?: number;
  alternativeIds: string[];
  refreshAfterMinutes: number;
  source: 'local' | 'openai';
  model?: string;
  generatedAt: string;
  expiresAt: string;
  inputHash: string;
  fallbackReason?: string;
}

export interface FocusFeedback {
  id: string;
  candidateId: string;
  action: FocusFeedbackAction;
  createdAt: string;
  snoozedUntil?: string;
}

export interface DashboardFocusState {
  loaded: boolean;
  status: 'idle' | 'refreshing' | 'ready';
  recommendation: FocusRecommendation | null;
  candidates: FocusCandidate[];
  queueCandidateIds: string[];
  stats: DashboardFocusStats;
  lastError?: string;
}

// ── Lifestyle Tracker (Haram/Halal) ──
export type LifestyleType = 'haram' | 'major-sin' | 'wajib-both' | 'wajib-women' | 'wajib-men' | 'halal';
export type LifestyleStatus = 'struggling' | 'working-on-it' | 'avoiding' | 'mastered'    // haram statuses
                            | 'want-to-start' | 'sometimes' | 'practicing' | 'consistent'; // halal statuses

export interface LifestyleItem {
  id: string;
  type: LifestyleType;
  title: string;
  notes: string;
  status: LifestyleStatus;
  sources?: string[]; // optional Quran/Hadith references
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Knowledge Base ──
export interface KnowledgeSource {
  type: 'quran' | 'hadith' | 'scholarly' | 'other';
  surah?: number;
  ayahStart?: number;
  ayahEnd?: number;
  collection?: string;
  hadithNumber?: string;
  author?: string;
  title?: string;
  url?: string;
}

export interface KnowledgeEntry {
  id: string;
  topicId: string;
  title: string;
  content: string;
  sources: KnowledgeSource[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeTopic {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Finance ──
export type TransactionType = 'income' | 'expense' | 'transfer';

export type ExpenseCategory =
  | 'rent-mortgage' | 'groceries' | 'transport' | 'bills-utilities'
  | 'eating-out' | 'subscriptions' | 'entertainment' | 'clothing'
  | 'health' | 'education' | 'gifts' | 'personal-care'
  | 'home' | 'insurance' | 'charity' | 'other-expense';

export type IncomeCategory =
  | 'salary' | 'freelance' | 'dividends' | 'interest'
  | 'refund' | 'gift-received' | 'other-income';

export type TransactionCategory = ExpenseCategory | IncomeCategory | 'transfer';

export type FinanceAccountType =
  | 'current' | 'savings' | 'credit-card' | 'isa' | 'pension' | 'loan-mortgage';

export interface FinanceAccount {
  id: string;
  name: string;
  type: FinanceAccountType;
  balance: number; // pence (integer)
  currency: string;
  color: string;
  icon: string;
  includeInNetWorth: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number; // pence (always positive)
  category: TransactionCategory;
  accountId: string;
  toAccountId?: string;
  description: string;
  date: string; // YYYY-MM-DD
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FinanceBudget {
  id: string;
  category: ExpenseCategory;
  monthlyLimit: number; // pence
  createdAt: string;
  updatedAt: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number; // pence
  currentAmount: number; // pence
  linkedAccountId?: string;
  icon: string;
  deadline?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Gamification ──
export interface GamificationProfile {
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate?: string;
  totalTasksCompleted: number;
  badges: string[];
  /** Tally of completions per habit (keyed by task ID). */
  habitTallies?: Record<string, number>;
  /** Daily completion log: "YYYY-MM-DD" → list of completed habit task IDs. */
  dailyLog?: Record<string, string[]>;
}

// ── Assistant Memory ──
export type AssistantCorrectionScope = 'utterance' | 'phrase';

export interface AssistantCorrection {
  id: string;
  sourceText: string;
  targetText: string;
  lang: 'en' | 'ar';
  scope: AssistantCorrectionScope;
  appliedCount?: number;
  lastAppliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Settings ──
export type AssistantProvider = 'auto' | 'ollama' | 'hosted';

export interface Settings {
  theme: 'dark' | 'light';
  dataRetentionDays: number;
  telemetry: boolean;
  googleOAuthClientId?: string;
  defaultCalendarTab?: 'month' | 'week' | 'agenda' | 'accounts';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  goalTags?: string[];
  prayerEnabled?: boolean;
  prayerCity?: string;
  prayerCountry?: string;
  assistantEnabled?: boolean;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  microphoneDeviceId?: string;
  wakeWordEnabled?: boolean;
  deepgramApiKey?: string;
  assistantLanguage?: 'en' | 'ar';
  assistantProvider?: AssistantProvider;
  hostedModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

// ── Clock ──
export type ClockTimerStatus = 'idle' | 'running' | 'completed';
export type ClockTimerSound = 'chime' | 'bell' | 'pulse' | 'dawn';

export interface ClockStopwatchState {
  id: string;
  label: string;
  accumulatedMs: number;
  startedAt: number | null;
  laps: number[];
}

export interface ClockTimerState {
  id: string;
  label: string;
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
  status: ClockTimerStatus;
  sound: ClockTimerSound;
  alerting: boolean;
  completedAt?: string;
}

export interface ClockState {
  stopwatches: ClockStopwatchState[];
  timers: ClockTimerState[];
  nextStopwatchNumber: number;
  nextTimerNumber: number;
}

// ── Navigation ──
export type Surface =
  | 'dashboard'
  | 'chat'
  | 'calendar'
  | 'clock'
  | 'projects'
  | 'tasks'
  | 'finance'
  | 'knowledge'
  | 'profile'
  | 'integrations'
  | 'settings'
  | 'debug';

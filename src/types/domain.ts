// ── Chat ──
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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

// ── Credentials ──
export type CredentialSource = '1password' | 'local-vault';

export interface Credential {
  id: string;
  name: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  source: CredentialSource;
  createdAt: string;
  updatedAt: string;
}

// ── Workspaces ──
export interface Workspace {
  id: string;
  name: string;
  path: string;
  description: string;
  isPrimary: boolean;
  createdAt: string;
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
  createdAt: string;
  updatedAt: string;
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
  credentialSource: 'onepassword-first' | 'local-only';
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
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

// ── Clock ──
export type ClockTimerStatus = 'idle' | 'running' | 'completed';

export interface ClockStopwatchState {
  accumulatedMs: number;
  startedAt: number | null;
  laps: number[];
}

export interface ClockTimerState {
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
  status: ClockTimerStatus;
  completedAt?: string;
}

export interface ClockState {
  stopwatch: ClockStopwatchState;
  timer: ClockTimerState;
}

// ── Navigation ──
export type Surface =
  | 'dashboard'
  | 'chat'
  | 'calendar'
  | 'clock'
  | 'credentials'
  | 'workspaces'
  | 'tasks'
  | 'finance'
  | 'knowledge'
  | 'profile'
  | 'integrations'
  | 'settings'
  | 'debug';

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
export type ProjectKind =
  | 'web_app'
  | 'desktop_app'
  | 'mobile_app'
  | 'cli'
  | 'service'
  | 'library'
  | 'automation'
  | 'hardware'
  | 'research'
  | 'other';
export type ProjectLinkKind = 'repository' | 'deployment' | 'documentation' | 'demo' | 'other';

export interface ProjectLink {
  id: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
}

/**
 * Setup guidance is intentionally display-only. It must never be passed to a
 * shell or treated as approval to run the displayed code.
 */
export interface ProjectSetupStep {
  id: string;
  title: string;
  description: string;
  displayCode?: string;
}

/**
 * A shared run recipe is a portable reference. Device roots and approvals live
 * in ProjectDeviceBinding instead of the synced Project record.
 */
export interface ProjectRunRecipe {
  id: string;
  label: string;
  displayCommand: string;
  executable: string;
  args: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  localUrl?: string;
  prerequisites?: string[];
  mode?: 'service' | 'one_shot';
}

export interface ProjectPreviewStyle {
  icon: string;
  accentColor: string;
  backgroundColor: string;
  coverImageUrl?: string;
}

export interface Project {
  id: string;
  /** Stable catalogue identity. Normalized legacy projects use custom:<id>. */
  catalogKey?: string;
  name: string;
  kind?: ProjectKind;
  links?: ProjectLink[];
  setupSteps?: ProjectSetupStep[];
  runRecipes?: ProjectRunRecipe[];
  preview?: ProjectPreviewStyle;
  verifiedAt?: string;
  /**
   * @deprecated Migration input only. Normalized Project records never retain
   * or sync an absolute local path.
   */
  localPath?: string;
  summary: string;
  status: ProjectStatus;
  tags: string[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProjectDeviceBindingSource = 'legacy' | 'user';

/**
 * Opaque, device-approved execution material. This data must remain in the
 * device-only project binding store and must never enter Supabase or exports.
 */
export interface ProjectRunProfile {
  profileId: string;
  projectId: string;
  recipeId: string;
  projectRoot: string;
  workingDirectory: string;
  executable: string;
  args: string[];
  environment: Record<string, string>;
  fingerprint: string;
  approvedAt: string;
}

export interface ProjectDeviceBinding {
  catalogKey: string;
  projectRoot: string;
  source: ProjectDeviceBindingSource;
  adoptedAt: string;
  updatedAt: string;
  runProfiles: ProjectRunProfile[];
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

// ── Trips ──
export type TripStatus = 'planning' | 'booked' | 'in_trip' | 'completed' | 'archived';
export type TripBookingKind = 'transport' | 'stay';
export type TripTransportMode = 'flight' | 'train' | 'bus' | 'ferry' | 'car' | 'other';
export type TripBudgetCategory = 'transport' | 'food' | 'events' | 'rent' | 'shopping' | 'fees' | 'other';
export type TripBudgetEntryStatus = 'planned' | 'paid';

export interface Trip {
  id: string;
  name: string;
  summary: string;
  notes: string;
  status: TripStatus;
  startDate: string;
  endDate: string;
  budgetCurrency?: string;
  budgetTotal?: number; // minor units, e.g. pence
  createdAt: string;
  updatedAt: string;
}

export interface TripLeg {
  id: string;
  tripId: string;
  country: string;
  city: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TripItineraryItem {
  id: string;
  tripId: string;
  legId: string;
  date: string;
  title: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface TripBookingBase {
  id: string;
  tripId: string;
  legId?: string;
  kind: TripBookingKind;
  budgetAmount?: number; // minor units, e.g. pence
  budgetStatus?: TripBudgetEntryStatus;
  budgetDate?: string; // YYYY-MM-DD
  provider?: string;
  confirmationCode?: string;
  link?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripTransportBooking extends TripBookingBase {
  kind: 'transport';
  mode: TripTransportMode;
  title: string;
  fromLabel: string;
  toLabel: string;
  departAt: string;
  arriveAt: string;
}

export interface TripStayBooking extends TripBookingBase {
  kind: 'stay';
  title: string;
  propertyName: string;
  address?: string;
  city: string;
  country: string;
  checkInDate: string;
  checkOutDate: string;
}

export type TripBooking = TripTransportBooking | TripStayBooking;
export type TripBookingInput =
  | Omit<TripTransportBooking, 'id' | 'createdAt' | 'updatedAt'>
  | Omit<TripStayBooking, 'id' | 'createdAt' | 'updatedAt'>;

export interface TripBudgetEntry {
  id: string;
  tripId: string;
  title: string;
  category: TripBudgetCategory;
  amount: number; // minor units, e.g. pence
  status: TripBudgetEntryStatus;
  date: string; // YYYY-MM-DD
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type TripBudgetEntryInput = Omit<TripBudgetEntry, 'id' | 'createdAt' | 'updatedAt'>;

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
export type PrayerName = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';
export type TaskCategory = 'daily' | 'prayer' | 'task' | 'goal';

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
  prayerName?: PrayerName;
  goalTag?: string;
  emoji?: string;
  projectId?: string;
  workflowState?: ProjectWorkflowState;
  blockedReason?: string;
  boardOrder?: number;
  createdAt: string;
  updatedAt: string;
}

// ── Prayer Tracking ──
export type PrayerCompletionStatus = 'on_time' | 'late';
export type PrayerOutcomeStatus = PrayerCompletionStatus | 'missed' | 'unclassified';
export type PrayerCompletionSource =
  | 'dashboard'
  | 'tasks'
  | 'focus'
  | 'reminder'
  | 'chat'
  | 'voice'
  | 'history'
  | 'migration'
  | 'system'
  | (string & {});

export interface PrayerTrackingRecord {
  date: string; // local YYYY-MM-DD
  prayerName: PrayerName;
  status: PrayerOutcomeStatus;
  recordedAt: string;
  /** Persistent one-time reward receipt. Corrections must preserve it. */
  rewarded?: true;
  taskId?: string;
  source?: PrayerCompletionSource;
}

/**
 * Duplicate transaction receipt kept with XP/dailyLog. Prayer tracking and
 * gamification are separate persisted stores, so this ledger repairs either
 * side after an interrupted multi-store write.
 */
export interface PrayerCompletionLedgerEntry {
  date: string;
  prayerName: PrayerName;
  status: PrayerOutcomeStatus;
  recordedAt: string;
  rewarded: boolean;
  taskId?: string;
  source?: PrayerCompletionSource;
}

export interface PrayerReminderReceipt {
  date: string; // local YYYY-MM-DD
  prayerName: PrayerName;
  deadlineAt: string;
  notificationKey: string;
  notifiedAt?: string;
  snoozedUntil?: string;
}

export interface PrayerActivationDayEligibility {
  date: string; // local YYYY-MM-DD captured from actual activation-day schedule
  prayerNames: PrayerName[];
}

export interface PrayerTrackingState {
  schemaVersion: number;
  trackingStartedAt: string;
  activationDayEligibility?: PrayerActivationDayEligibility;
  records: Record<string, PrayerTrackingRecord>;
  reminderReceipts: Record<string, PrayerReminderReceipt>;
}

export interface PrayerCompletionUndoData {
  prayerDate: string;
  prayerName: PrayerName;
  taskCompletion?: {
    taskId: string;
    before: {
      completed: boolean;
      completedAt?: string;
      recurringLastReset?: string;
    };
    after: {
      completed: boolean;
      completedAt?: string;
      recurringLastReset?: string;
    };
  };
  outcomeBefore?: PrayerTrackingRecord;
  outcomeAfter: PrayerTrackingRecord;
  gamificationBefore: GamificationProfile;
  gamificationAfter: GamificationProfile;
}

export type PrayerDeadlineName = 'Sunrise' | 'Sunset' | 'Midnight';

export interface PrayerDeadlineBounds {
  date: string; // local prayer date, not necessarily deadline calendar date
  prayerName: PrayerName;
  deadlineName: PrayerDeadlineName;
  startsAt: Date;
  deadlineAt: Date;
}

export interface PrayerScheduleEntry {
  name: string;
  time: string;
}

export interface PrayerScheduleDay {
  date: string; // local YYYY-MM-DD
  prayers: readonly PrayerScheduleEntry[];
}

export interface PrayerOutcomePercentages {
  onTime: number;
  late: number;
  missed: number;
}

export interface PrayerOutcomeTally {
  onTime: number;
  late: number;
  missed: number;
  inferredMissed: number;
  unclassified: number;
  pending: number;
  classifiedTotal: number;
  opportunities: number;
  percentages: PrayerOutcomePercentages;
}

export interface PrayerOutcomeStats extends PrayerOutcomeTally {
  trackedDays: number;
  perPrayer: Record<PrayerName, PrayerOutcomeTally>;
}

export type FocusCandidateKind = 'task' | 'habit' | 'prayer' | 'meeting_prep' | 'break' | 'clear';
export type FocusFeedbackAction = 'dismissed' | 'snoozed' | 'opened' | 'completed' | 'refreshed';
export type FocusDurationSource = 'task_title' | 'task_description' | 'event_window' | 'system' | 'heuristic' | 'openai';

export interface DashboardFocusStats {
  overdueCount: number;
  dueTodayCount: number;
  routinesLeft: number;
  prayersLeft: number;
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
  estimatedMinutesSource?: FocusDurationSource;
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
  estimatedMinutesSource?: FocusDurationSource;
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

// ── Universal Capture Inbox ──
export type CaptureItemSource = 'chat' | 'voice' | 'shortcut' | 'quick_button' | 'manual';
export type CaptureClassification =
  | 'unknown'
  | 'task'
  | 'project_note'
  | 'calendar_idea'
  | 'trip_item'
  | 'health_log'
  | 'knowledge_entry';
export type CaptureStatus = 'unprocessed' | 'classified' | 'archived';

export interface CaptureItem {
  id: string;
  content: string;
  source: CaptureItemSource;
  classification: CaptureClassification;
  status: CaptureStatus;
  sourceSurface?: Surface;
  conversationId?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Health ──
export type FastFoodExperienceRating = 'good' | 'mixed' | 'bad' | 'awful';
export type FastFoodSymptom =
  | 'fine'
  | 'bloated'
  | 'sluggish'
  | 'nauseous'
  | 'headache'
  | 'thirsty'
  | 'brain-fog'
  | 'cravings';

export interface FastFoodLogEntry {
  id: string;
  venue: string;
  date: string; // YYYY-MM-DD
  order?: string;
  rating: FastFoodExperienceRating;
  symptoms: FastFoodSymptom[];
  notes: string;
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
  /** Durable prayer mutation receipts, keyed by local date + prayer. */
  prayerCompletionLedger?: Record<string, PrayerCompletionLedgerEntry>;
}

// ── Assistant Activity ──
export type AssistantActivityActor = 'chat' | 'voice' | 'system';
export type AssistantActivityDomain = 'assistant' | 'calendar' | 'capture' | 'finance' | 'knowledge' | 'tasks' | 'trips';
export type AssistantActivityAction = 'completed' | 'created' | 'deleted' | 'recorded' | 'saved' | 'updated';
export type AssistantActivityStatus = 'applied' | 'undone' | 'undo_failed';

export interface AssistantActivityEntityReference {
  kind: string;
  id: string;
  label: string;
  surface?: Surface;
}

export type AssistantUndoOperation =
  | { type: 'capture.delete'; id: string }
  | { type: 'task.delete'; id: string }
  | { type: 'task.restore'; tasks: Task[] }
  | { type: 'task.replace'; task: Task; gamification?: GamificationProfile }
  | { type: 'prayer.complete'; inverse: PrayerCompletionUndoData }
  | { type: 'calendar.delete'; id: string }
  | { type: 'calendar.replace'; event: CalendarEvent }
  | { type: 'finance.delete_transaction'; id: string }
  | { type: 'knowledge.delete_entry'; id: string };

export interface AssistantActivityEntry {
  id: string;
  actor: AssistantActivityActor;
  domain: AssistantActivityDomain;
  action: AssistantActivityAction;
  summary: string;
  details: string[];
  entityRefs: AssistantActivityEntityReference[];
  status: AssistantActivityStatus;
  createdAt: string;
  sourceSurface?: Surface;
  sourceTranscript?: string;
  conversationId?: string;
  undoOperation?: AssistantUndoOperation;
  undoneAt?: string;
  undoError?: string;
}

export type AssistantActivityDraft = Omit<AssistantActivityEntry, 'id' | 'createdAt' | 'status' | 'undoneAt' | 'undoError'> & {
  createdAt?: string;
  status?: AssistantActivityStatus;
};

export interface AssistantActivitySource {
  actor: AssistantActivityActor;
  surface?: Surface;
  sourceTranscript?: string;
  conversationId?: string;
}

export interface AssistantUndoResult {
  ok: boolean;
  message: string;
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
  prayerReminderEnabled?: boolean;
  prayerReminderMinutes?: 5 | 10 | 15 | 30;
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
  | 'inbox'
  | 'calendar'
  | 'clock'
  | 'trips'
  | 'projects'
  | 'tasks'
  | 'finance'
  | 'health'
  | 'knowledge'
  | 'profile'
  | 'integrations'
  | 'activity'
  | 'settings'
  | 'debug';

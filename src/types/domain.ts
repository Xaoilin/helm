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

// ── Gamification ──
export interface GamificationProfile {
  totalXp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate?: string;
  totalTasksCompleted: number;
  badges: string[];
}

// ── Settings ──
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
}

// ── Navigation ──
export type Surface =
  | 'dashboard'
  | 'chat'
  | 'calendar'
  | 'credentials'
  | 'workspaces'
  | 'tasks'
  | 'knowledge'
  | 'profile'
  | 'integrations'
  | 'settings';

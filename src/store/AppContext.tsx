import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Surface, ChatConversation, ChatMessage,
  CalendarAccount, CalendarSource, CalendarEvent,
  Credential, Workspace, Integration, Settings,
  Task, GamificationProfile,
  KnowledgeTopic, KnowledgeEntry,
  LifestyleItem,
  FinanceAccount, Transaction, FinanceBudget, SavingsGoal,
} from '../types/domain';
import { loadStore, saveStore } from './persistence';
import { DEFAULT_PROFILE } from '../services/gamification';
import { clearGoogleTokens } from '../services/googleAuth';

// ── Default Settings ──
const defaultSettings: Settings = {
  credentialSource: 'onepassword-first',
  theme: 'dark',
  dataRetentionDays: 90,
  telemetry: false,
};

// ── Default Integrations (all disconnected) ──
const defaultIntegrations: Integration[] = [
  { id: 'int-google', name: 'Google Calendar', provider: 'google', description: 'Sync Google Calendar events', status: 'disconnected', icon: 'calendar' },
  { id: 'int-github', name: 'GitHub', provider: 'github', description: 'Repository and PR notifications', status: 'disconnected', icon: 'code' },
  { id: 'int-1password', name: '1Password', provider: '1password', description: 'Credential management via 1Password CLI', status: 'disconnected', icon: 'key' },
  { id: 'int-slack', name: 'Slack', provider: 'slack', description: 'Team messaging notifications', status: 'disconnected', icon: 'message' },
  { id: 'int-linear', name: 'Linear', provider: 'linear', description: 'Issue tracking and project management', status: 'disconnected', icon: 'list' },
];

// ── State Shape ──
interface AppState {
  surface: Surface;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  credentials: Credential[];
  workspaces: Workspace[];
  tasks: Task[];
  knowledgeTopics: KnowledgeTopic[];
  knowledgeEntries: KnowledgeEntry[];
  lifestyleItems: LifestyleItem[];
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  financeBudgets: FinanceBudget[];
  savingsGoals: SavingsGoal[];
  integrations: Integration[];
  gamification: GamificationProfile;
  settings: Settings;
  loaded: boolean;
}

// ── Context API ──
interface AppContextAPI extends AppState {
  navigate: (s: Surface) => void;

  // Chat
  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, content: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

  // Calendar
  addCalendarAccount: (account: Omit<CalendarAccount, 'id'>) => string;
  updateCalendarAccount: (id: string, updates: Partial<CalendarAccount>) => void;
  removeCalendarAccount: (id: string) => void;
  setPrimaryCalendarAccount: (id: string) => void;
  addCalendarSource: (source: Omit<CalendarSource, 'id'>) => string;
  updateCalendarSource: (id: string, updates: Partial<CalendarSource>) => void;
  removeCalendarSource: (id: string) => void;
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => string;
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  removeCalendarEvent: (id: string) => void;

  // Calendar bulk (for sync)
  bulkUpsertCalendarSources: (sources: Array<Partial<CalendarSource> & { accountId: string; name: string; color: string; visible: boolean }>) => void;
  bulkUpsertCalendarEvents: (events: Array<Partial<CalendarEvent> & { sourceId: string; title: string; description: string; start: string; end: string; allDay: boolean }>) => void;
  bulkRemoveCalendarEvents: (ids: string[]) => void;

  // Credentials
  addCredential: (cred: Omit<Credential, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCredential: (id: string, updates: Partial<Credential>) => void;
  removeCredential: (id: string) => void;

  // Workspaces
  addWorkspace: (ws: Omit<Workspace, 'id' | 'createdAt'>) => string;
  updateWorkspace: (id: string, updates: Partial<Workspace>) => void;
  removeWorkspace: (id: string) => void;
  setPrimaryWorkspace: (id: string) => void;

  // Tasks
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;

  // Knowledge
  addKnowledgeTopic: (topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeTopic: (id: string, updates: Partial<KnowledgeTopic>) => void;
  removeKnowledgeTopic: (id: string) => void;
  addKnowledgeEntry: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeEntry: (id: string, updates: Partial<KnowledgeEntry>) => void;
  removeKnowledgeEntry: (id: string) => void;

  // Lifestyle
  addLifestyleItem: (item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateLifestyleItem: (id: string, updates: Partial<LifestyleItem>) => void;
  removeLifestyleItem: (id: string) => void;
  reorderLifestyleItems: (reorderedIds: string[]) => void;

  // Finance
  addFinanceAccount: (acc: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFinanceAccount: (id: string, updates: Partial<FinanceAccount>) => void;
  removeFinanceAccount: (id: string) => void;
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  addFinanceBudget: (budget: Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFinanceBudget: (id: string, updates: Partial<FinanceBudget>) => void;
  removeFinanceBudget: (id: string) => void;
  addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateSavingsGoal: (id: string, updates: Partial<SavingsGoal>) => void;
  removeSavingsGoal: (id: string) => void;

  // Gamification
  updateGamification: (profile: GamificationProfile) => void;

  // Integrations
  updateIntegration: (id: string, updates: Partial<Integration>) => void;

  // Settings
  updateSettings: (updates: Partial<Settings>) => void;
}

const AppContext = createContext<AppContextAPI | null>(null);

export function useApp(): AppContextAPI {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// ── Provider ──
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    surface: 'dashboard',
    conversations: [],
    activeConversationId: null,
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    credentials: [],
    workspaces: [],
    tasks: [],
    knowledgeTopics: [],
    knowledgeEntries: [],
    lifestyleItems: [],
    financeAccounts: [],
    transactions: [],
    financeBudgets: [],
    savingsGoals: [],
    integrations: defaultIntegrations,
    gamification: DEFAULT_PROFILE,
    settings: defaultSettings,
    loaded: false,
  });

  // Load persisted state on mount
  useEffect(() => {
    (async () => {
      const [conversations, calendarAccounts, calendarSources, calendarEvents, credentials, workspaces, tasks, knowledgeTopics, knowledgeEntries, lifestyleItems, financeAccounts, transactions, financeBudgets, savingsGoals, integrations, gamification, settings] = await Promise.all([
        loadStore<ChatConversation[]>('conversations'),
        loadStore<CalendarAccount[]>('calendarAccounts'),
        loadStore<CalendarSource[]>('calendarSources'),
        loadStore<CalendarEvent[]>('calendarEvents'),
        loadStore<Credential[]>('credentials'),
        loadStore<Workspace[]>('workspaces'),
        loadStore<Task[]>('tasks'),
        loadStore<KnowledgeTopic[]>('knowledgeTopics'),
        loadStore<KnowledgeEntry[]>('knowledgeEntries'),
        loadStore<LifestyleItem[]>('lifestyleItems'),
        loadStore<FinanceAccount[]>('financeAccounts'),
        loadStore<Transaction[]>('transactions'),
        loadStore<FinanceBudget[]>('financeBudgets'),
        loadStore<SavingsGoal[]>('savingsGoals'),
        loadStore<Integration[]>('integrations'),
        loadStore<GamificationProfile>('gamification'),
        loadStore<Settings>('settings'),
      ]);
      setState(s => ({
        ...s,
        conversations: conversations ?? [],
        calendarAccounts: calendarAccounts ?? [],
        calendarSources: calendarSources ?? [],
        calendarEvents: calendarEvents ?? [],
        credentials: credentials ?? [],
        workspaces: workspaces ?? [],
        tasks: tasks ?? [],
        knowledgeTopics: knowledgeTopics ?? [],
        knowledgeEntries: knowledgeEntries ?? [],
        lifestyleItems: lifestyleItems ?? [],
        financeAccounts: financeAccounts ?? [],
        transactions: transactions ?? [],
        financeBudgets: financeBudgets ?? [],
        savingsGoals: savingsGoals ?? [],
        integrations: integrations ?? defaultIntegrations,
        gamification: gamification ?? DEFAULT_PROFILE,
        settings: settings ?? defaultSettings,
        loaded: true,
      }));
    })();
  }, []);

  // Persist on change
  useEffect(() => {
    if (!state.loaded) return;
    saveStore('conversations', state.conversations);
  }, [state.conversations, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('calendarAccounts', state.calendarAccounts); }, [state.calendarAccounts, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('calendarSources', state.calendarSources); }, [state.calendarSources, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('calendarEvents', state.calendarEvents); }, [state.calendarEvents, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('credentials', state.credentials); }, [state.credentials, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('workspaces', state.workspaces); }, [state.workspaces, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('tasks', state.tasks); }, [state.tasks, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('knowledgeTopics', state.knowledgeTopics); }, [state.knowledgeTopics, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('knowledgeEntries', state.knowledgeEntries); }, [state.knowledgeEntries, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('lifestyleItems', state.lifestyleItems); }, [state.lifestyleItems, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('financeAccounts', state.financeAccounts); }, [state.financeAccounts, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('transactions', state.transactions); }, [state.transactions, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('financeBudgets', state.financeBudgets); }, [state.financeBudgets, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('savingsGoals', state.savingsGoals); }, [state.savingsGoals, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('gamification', state.gamification); }, [state.gamification, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('integrations', state.integrations); }, [state.integrations, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('settings', state.settings); }, [state.settings, state.loaded]);

  // ── Navigation ──
  const navigate = useCallback((surface: Surface) => setState(s => ({ ...s, surface })), []);

  // ── Chat ──
  const createConversation = useCallback((): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const conv: ChatConversation = { id, title: 'New conversation', messages: [], createdAt: now, updatedAt: now };
    setState(s => ({ ...s, conversations: [conv, ...s.conversations], activeConversationId: id }));
    return id;
  }, []);

  const setActiveConversation = useCallback((id: string | null) => {
    setState(s => ({ ...s, activeConversationId: id }));
  }, []);

  const sendMessage = useCallback((conversationId: string, content: string) => {
    const now = new Date().toISOString();
    const userMsg: ChatMessage = { id: uuid(), role: 'user', content, timestamp: now };

    // Generate a mock assistant reply
    const assistantMsg: ChatMessage = {
      id: uuid(), role: 'assistant',
      content: generateMockReply(content),
      timestamp: new Date(Date.now() + 500).toISOString(),
    };

    setState(s => {
      const exists = s.conversations.some(c => c.id === conversationId);
      let convs = s.conversations;
      if (!exists) {
        // Auto-create conversation if it doesn't exist yet (handles race with createConversation)
        const newConv: ChatConversation = { id: conversationId, title: content.slice(0, 50), messages: [userMsg, assistantMsg], createdAt: now, updatedAt: now };
        convs = [newConv, ...convs];
      } else {
        convs = convs.map(c =>
          c.id === conversationId
            ? {
                ...c,
                messages: [...c.messages, userMsg, assistantMsg],
                title: c.messages.length === 0 ? content.slice(0, 50) : c.title,
                updatedAt: now,
              }
            : c
        );
      }
      return { ...s, conversations: convs, activeConversationId: conversationId };
    });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setState(s => ({
      ...s,
      conversations: s.conversations.filter(c => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
    }));
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setState(s => ({
      ...s,
      conversations: s.conversations.map(c => c.id === id ? { ...c, title } : c),
    }));
  }, []);

  // ── Calendar ──
  const addCalendarAccount = useCallback((account: Omit<CalendarAccount, 'id'>): string => {
    const id = uuid();
    setState(s => {
      const isPrimary = s.calendarAccounts.length === 0 ? true : account.isPrimary;
      const accounts = isPrimary
        ? s.calendarAccounts.map(a => ({ ...a, isPrimary: false }))
        : s.calendarAccounts;
      return { ...s, calendarAccounts: [...accounts, { ...account, id, isPrimary }] };
    });
    return id;
  }, []);

  const updateCalendarAccount = useCallback((id: string, updates: Partial<CalendarAccount>) => {
    setState(s => ({
      ...s,
      calendarAccounts: s.calendarAccounts.map(a => a.id === id ? { ...a, ...updates } : a),
    }));
  }, []);

  const removeCalendarAccount = useCallback((id: string) => {
    // Clean up Google tokens if this is a Google account
    clearGoogleTokens(id);
    setState(s => {
      const remaining = s.calendarAccounts.filter(a => a.id !== id);
      // If removed was primary, promote first remaining
      if (remaining.length > 0 && !remaining.some(a => a.isPrimary)) {
        remaining[0].isPrimary = true;
      }
      // Remove orphaned sources and events
      const sourceIds = s.calendarSources.filter(src => src.accountId === id).map(src => src.id);
      return {
        ...s,
        calendarAccounts: remaining,
        calendarSources: s.calendarSources.filter(src => src.accountId !== id),
        calendarEvents: s.calendarEvents.filter(e => !sourceIds.includes(e.sourceId)),
      };
    });
  }, []);

  const setPrimaryCalendarAccount = useCallback((id: string) => {
    setState(s => ({
      ...s,
      calendarAccounts: s.calendarAccounts.map(a => ({ ...a, isPrimary: a.id === id })),
    }));
  }, []);

  const addCalendarSource = useCallback((source: Omit<CalendarSource, 'id'>): string => {
    const id = uuid();
    setState(s => ({ ...s, calendarSources: [...s.calendarSources, { ...source, id }] }));
    return id;
  }, []);

  const updateCalendarSource = useCallback((id: string, updates: Partial<CalendarSource>) => {
    setState(s => ({
      ...s,
      calendarSources: s.calendarSources.map(src => src.id === id ? { ...src, ...updates } : src),
    }));
  }, []);

  const removeCalendarSource = useCallback((id: string) => {
    setState(s => ({
      ...s,
      calendarSources: s.calendarSources.filter(src => src.id !== id),
      calendarEvents: s.calendarEvents.filter(e => e.sourceId !== id),
    }));
  }, []);

  const addCalendarEvent = useCallback((event: Omit<CalendarEvent, 'id'>): string => {
    const id = uuid();
    setState(s => ({ ...s, calendarEvents: [...s.calendarEvents, { ...event, id }] }));
    return id;
  }, []);

  const updateCalendarEvent = useCallback((id: string, updates: Partial<CalendarEvent>) => {
    setState(s => ({
      ...s,
      calendarEvents: s.calendarEvents.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  }, []);

  const removeCalendarEvent = useCallback((id: string) => {
    setState(s => ({ ...s, calendarEvents: s.calendarEvents.filter(e => e.id !== id) }));
  }, []);

  // ── Calendar Bulk (for sync) ──
  const bulkUpsertCalendarSources = useCallback((sources: Array<Partial<CalendarSource> & { accountId: string; name: string; color: string; visible: boolean }>) => {
    setState(s => {
      const newSources = [...s.calendarSources];
      for (const src of sources) {
        if (src.id) {
          const idx = newSources.findIndex(x => x.id === src.id);
          if (idx >= 0) {
            newSources[idx] = { ...newSources[idx], ...src } as CalendarSource;
          }
        } else {
          newSources.push({ ...src, id: uuid() } as CalendarSource);
        }
      }
      return { ...s, calendarSources: newSources };
    });
  }, []);

  const bulkUpsertCalendarEvents = useCallback((events: Array<Partial<CalendarEvent> & { sourceId: string; title: string; description: string; start: string; end: string; allDay: boolean }>) => {
    setState(s => {
      const newEvents = [...s.calendarEvents];
      for (const evt of events) {
        if (evt.id) {
          const idx = newEvents.findIndex(x => x.id === evt.id);
          if (idx >= 0) {
            newEvents[idx] = { ...newEvents[idx], ...evt } as CalendarEvent;
          }
        } else {
          newEvents.push({ ...evt, id: uuid() } as CalendarEvent);
        }
      }
      return { ...s, calendarEvents: newEvents };
    });
  }, []);

  const bulkRemoveCalendarEvents = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setState(s => ({ ...s, calendarEvents: s.calendarEvents.filter(e => !idSet.has(e.id)) }));
  }, []);

  // ── Credentials ──
  const addCredential = useCallback((cred: Omit<Credential, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setState(s => ({ ...s, credentials: [...s.credentials, { ...cred, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);

  const updateCredential = useCallback((id: string, updates: Partial<Credential>) => {
    setState(s => ({
      ...s,
      credentials: s.credentials.map(c => c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c),
    }));
  }, []);

  const removeCredential = useCallback((id: string) => {
    setState(s => ({ ...s, credentials: s.credentials.filter(c => c.id !== id) }));
  }, []);

  // ── Workspaces ──
  const addWorkspace = useCallback((ws: Omit<Workspace, 'id' | 'createdAt'>): string => {
    const id = uuid();
    setState(s => {
      const isPrimary = s.workspaces.length === 0 ? true : ws.isPrimary;
      const existing = isPrimary
        ? s.workspaces.map(w => ({ ...w, isPrimary: false }))
        : s.workspaces;
      return { ...s, workspaces: [...existing, { ...ws, id, isPrimary, createdAt: new Date().toISOString() }] };
    });
    return id;
  }, []);

  const updateWorkspace = useCallback((id: string, updates: Partial<Workspace>) => {
    setState(s => ({
      ...s,
      workspaces: s.workspaces.map(w => w.id === id ? { ...w, ...updates } : w),
    }));
  }, []);

  const removeWorkspace = useCallback((id: string) => {
    setState(s => {
      const remaining = s.workspaces.filter(w => w.id !== id);
      if (remaining.length > 0 && !remaining.some(w => w.isPrimary)) {
        remaining[0].isPrimary = true;
      }
      return { ...s, workspaces: remaining };
    });
  }, []);

  const setPrimaryWorkspace = useCallback((id: string) => {
    setState(s => ({
      ...s,
      workspaces: s.workspaces.map(w => ({ ...w, isPrimary: w.id === id })),
    }));
  }, []);

  // ── Tasks ──
  const addTask = useCallback((task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setState(s => ({ ...s, tasks: [...s.tasks, { ...task, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    setState(s => ({
      ...s,
      tasks: s.tasks.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t),
    }));
  }, []);

  const removeTask = useCallback((id: string) => {
    setState(s => ({ ...s, tasks: s.tasks.filter(t => t.id !== id) }));
  }, []);

  // ── Knowledge ──
  const addKnowledgeTopic = useCallback((topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setState(s => ({ ...s, knowledgeTopics: [...s.knowledgeTopics, { ...topic, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);

  const updateKnowledgeTopic = useCallback((id: string, updates: Partial<KnowledgeTopic>) => {
    setState(s => ({
      ...s,
      knowledgeTopics: s.knowledgeTopics.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t),
    }));
  }, []);

  const removeKnowledgeTopic = useCallback((id: string) => {
    setState(s => ({
      ...s,
      knowledgeTopics: s.knowledgeTopics.filter(t => t.id !== id),
      knowledgeEntries: s.knowledgeEntries.filter(e => e.topicId !== id),
    }));
  }, []);

  const addKnowledgeEntry = useCallback((entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setState(s => ({ ...s, knowledgeEntries: [...s.knowledgeEntries, { ...entry, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);

  const updateKnowledgeEntry = useCallback((id: string, updates: Partial<KnowledgeEntry>) => {
    setState(s => ({
      ...s,
      knowledgeEntries: s.knowledgeEntries.map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e),
    }));
  }, []);

  const removeKnowledgeEntry = useCallback((id: string) => {
    setState(s => ({ ...s, knowledgeEntries: s.knowledgeEntries.filter(e => e.id !== id) }));
  }, []);

  // ── Lifestyle ──
  const addLifestyleItem = useCallback((item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setState(s => ({ ...s, lifestyleItems: [...s.lifestyleItems, { ...item, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);

  const updateLifestyleItem = useCallback((id: string, updates: Partial<LifestyleItem>) => {
    setState(s => ({
      ...s,
      lifestyleItems: s.lifestyleItems.map(i => i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i),
    }));
  }, []);

  const removeLifestyleItem = useCallback((id: string) => {
    setState(s => ({ ...s, lifestyleItems: s.lifestyleItems.filter(i => i.id !== id) }));
  }, []);

  const reorderLifestyleItems = useCallback((reorderedIds: string[]) => {
    setState(s => ({
      ...s,
      lifestyleItems: s.lifestyleItems.map(item => {
        const newOrder = reorderedIds.indexOf(item.id);
        return newOrder >= 0 ? { ...item, sortOrder: newOrder } : item;
      }),
    }));
  }, []);

  // ── Finance ──
  const addFinanceAccount = useCallback((acc: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid(); const now = new Date().toISOString();
    setState(s => ({ ...s, financeAccounts: [...s.financeAccounts, { ...acc, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);
  const updateFinanceAccount = useCallback((id: string, updates: Partial<FinanceAccount>) => {
    setState(s => ({ ...s, financeAccounts: s.financeAccounts.map(a => a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a) }));
  }, []);
  const removeFinanceAccount = useCallback((id: string) => {
    setState(s => ({
      ...s,
      financeAccounts: s.financeAccounts.filter(a => a.id !== id),
      transactions: s.transactions.filter(t => t.accountId !== id && t.toAccountId !== id),
    }));
  }, []);

  const addTransaction = useCallback((tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid(); const now = new Date().toISOString();
    setState(s => {
      const newTx = { ...tx, id, createdAt: now, updatedAt: now };
      // Auto-update account balance
      const accounts = s.financeAccounts.map(a => {
        if (a.id === tx.accountId) {
          const delta = tx.type === 'income' ? tx.amount : tx.type === 'expense' ? -tx.amount : -tx.amount;
          return { ...a, balance: a.balance + delta, updatedAt: now };
        }
        if (tx.toAccountId && a.id === tx.toAccountId && tx.type === 'transfer') {
          return { ...a, balance: a.balance + tx.amount, updatedAt: now };
        }
        return a;
      });
      return { ...s, transactions: [newTx, ...s.transactions], financeAccounts: accounts };
    });
    return id;
  }, []);
  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    setState(s => ({ ...s, transactions: s.transactions.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t) }));
  }, []);
  const removeTransaction = useCallback((id: string) => {
    setState(s => {
      const tx = s.transactions.find(t => t.id === id);
      let accounts = s.financeAccounts;
      if (tx) {
        // Reverse the balance effect
        accounts = accounts.map(a => {
          if (a.id === tx.accountId) {
            const delta = tx.type === 'income' ? -tx.amount : tx.type === 'expense' ? tx.amount : tx.amount;
            return { ...a, balance: a.balance + delta, updatedAt: new Date().toISOString() };
          }
          if (tx.toAccountId && a.id === tx.toAccountId && tx.type === 'transfer') {
            return { ...a, balance: a.balance - tx.amount, updatedAt: new Date().toISOString() };
          }
          return a;
        });
      }
      return { ...s, transactions: s.transactions.filter(t => t.id !== id), financeAccounts: accounts };
    });
  }, []);

  const addFinanceBudget = useCallback((budget: Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid(); const now = new Date().toISOString();
    setState(s => ({ ...s, financeBudgets: [...s.financeBudgets, { ...budget, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);
  const updateFinanceBudget = useCallback((id: string, updates: Partial<FinanceBudget>) => {
    setState(s => ({ ...s, financeBudgets: s.financeBudgets.map(b => b.id === id ? { ...b, ...updates, updatedAt: new Date().toISOString() } : b) }));
  }, []);
  const removeFinanceBudget = useCallback((id: string) => {
    setState(s => ({ ...s, financeBudgets: s.financeBudgets.filter(b => b.id !== id) }));
  }, []);

  const addSavingsGoal = useCallback((goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid(); const now = new Date().toISOString();
    setState(s => ({ ...s, savingsGoals: [...s.savingsGoals, { ...goal, id, createdAt: now, updatedAt: now }] }));
    return id;
  }, []);
  const updateSavingsGoal = useCallback((id: string, updates: Partial<SavingsGoal>) => {
    setState(s => ({ ...s, savingsGoals: s.savingsGoals.map(g => g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g) }));
  }, []);
  const removeSavingsGoal = useCallback((id: string) => {
    setState(s => ({ ...s, savingsGoals: s.savingsGoals.filter(g => g.id !== id) }));
  }, []);

  // ── Gamification ──
  const updateGamification = useCallback((profile: GamificationProfile) => {
    setState(s => ({ ...s, gamification: profile }));
  }, []);

  // ── Integrations ──
  const updateIntegration = useCallback((id: string, updates: Partial<Integration>) => {
    setState(s => ({
      ...s,
      integrations: s.integrations.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  }, []);

  // ── Settings ──
  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setState(s => {
      const newSettings = { ...s.settings, ...updates };
      // Re-init Supabase if connection settings changed
      if (updates.supabaseUrl !== undefined || updates.supabaseAnonKey !== undefined) {
        import('./supabase').then(({ initSupabase }) => {
          initSupabase(newSettings.supabaseUrl || '', newSettings.supabaseAnonKey || '');
        });
      }
      return { ...s, settings: newSettings };
    });
  }, []);

  const api: AppContextAPI = {
    ...state,
    navigate,
    createConversation, setActiveConversation, sendMessage, deleteConversation, renameConversation,
    addCalendarAccount, updateCalendarAccount, removeCalendarAccount, setPrimaryCalendarAccount,
    addCalendarSource, updateCalendarSource, removeCalendarSource,
    addCalendarEvent, updateCalendarEvent, removeCalendarEvent,
    bulkUpsertCalendarSources, bulkUpsertCalendarEvents, bulkRemoveCalendarEvents,
    addCredential, updateCredential, removeCredential,
    addWorkspace, updateWorkspace, removeWorkspace, setPrimaryWorkspace,
    addTask, updateTask, removeTask,
    addKnowledgeTopic, updateKnowledgeTopic, removeKnowledgeTopic,
    addKnowledgeEntry, updateKnowledgeEntry, removeKnowledgeEntry,
    addLifestyleItem, updateLifestyleItem, removeLifestyleItem, reorderLifestyleItems,
    addFinanceAccount, updateFinanceAccount, removeFinanceAccount,
    addTransaction, updateTransaction, removeTransaction,
    addFinanceBudget, updateFinanceBudget, removeFinanceBudget,
    addSavingsGoal, updateSavingsGoal, removeSavingsGoal,
    updateGamification,
    updateIntegration,
    updateSettings,
  };

  if (!state.loaded) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8b8fa3' }}>Loading HELM...</div>;
  }

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

// ── Mock assistant reply generator ──
function generateMockReply(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('help') || lower.includes('what can you do')) {
    return "[Mocked] I'm HELM, your local assistant. I can help with engineering tasks, manage your calendar, and organize workspaces. Note: AI responses are currently mocked \u2014 connect a real LLM backend to get intelligent replies.";
  }
  if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('meeting')) {
    return "[Mocked] I'd check your calendar for that. Head to the Calendar tab to manage your events and accounts. Real calendar integration requires connecting a Google or Outlook account in Integrations.";
  }
  if (lower.includes('deploy') || lower.includes('release') || lower.includes('ship')) {
    return "[Mocked] I can help with deployment planning. What would you like to deploy?";
  }
  if (lower.includes('credential') || lower.includes('password') || lower.includes('secret')) {
    return "[Mocked] Credential lookups prefer 1Password when connected. You can manage fallback credentials in the Credentials tab.";
  }
  return `[Mocked] I received your message: "${userMessage.slice(0, 80)}". AI responses are mocked in this version. Connect an LLM backend to enable real assistant capabilities.`;
}

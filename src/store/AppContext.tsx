import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Surface, ChatConversation,
  CalendarAccount, CalendarSource, CalendarEvent,
  Credential, Workspace, Integration, Settings,
  Task, GamificationProfile,
  KnowledgeTopic, KnowledgeEntry,
  LifestyleItem,
  FinanceAccount, Transaction, FinanceBudget, SavingsGoal,
  AssistantCorrection,
  ClockState,
} from '../types/domain';
import { loadStore, saveStore } from './persistence';
import {
  normalizeAssistantNavigationRequest,
  subscribeAssistantNavigation,
  type AssistantNavigationHandler,
  type AssistantNavigationRequest,
} from '../services/assistantNavigation';

// ── Domain Contexts ──
import { CalendarProvider, useCalendar } from './contexts/CalendarContext';
import { TaskProvider, useTaskContext } from './contexts/TaskContext';
import { ChatProvider, useChatContext, type ChatCrossDomainData } from './contexts/ChatContext';
import { KnowledgeProvider, useKnowledgeContext } from './contexts/KnowledgeContext';
import { FinanceProvider, useFinanceContext } from './contexts/FinanceContext';
import { GamificationProvider, useGamificationContext } from './contexts/GamificationContext';
import { SettingsProvider, useSettingsContext } from './contexts/SettingsContext';
import { AssistantProvider, useAssistantContext } from './contexts/AssistantContext';
import { ClockProvider, useClockContext } from './contexts/ClockContext';

// ── Context API (backward-compatible interface) ──
interface AppContextAPI {
  // State
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
  assistantCorrections: AssistantCorrection[];
  gamification: GamificationProfile;
  settings: Settings;
  clock: ClockState;
  loaded: boolean;
  assistantNavigationRequest: AssistantNavigationRequest | null;

  // Navigation
  navigate: (s: Surface) => void;
  requestAssistantNavigation: AssistantNavigationHandler;
  dismissAssistantNavigationRequest: (requestId?: string) => void;

  // Chat
  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
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
  backfillPrayerLog: (taskId: string, dateStr: string, completed: boolean) => void;

  // Clock
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
  recordStopwatchLap: () => void;
  setTimerDuration: (durationMs: number) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;

  // Assistant memory
  upsertAssistantCorrection: (correction: {
    sourceText: string;
    targetText: string;
    lang: 'en' | 'ar';
    scope: AssistantCorrection['scope'];
  }) => string | null;
  noteAssistantCorrectionApplied: (id: string) => void;

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

// ── Cross-cutting state (nav, credentials, workspaces) ──
// These are small and cross-cutting, so they stay in the shell.

interface ShellState {
  surface: Surface;
  assistantNavigationRequest: AssistantNavigationRequest | null;
  credentials: Credential[];
  workspaces: Workspace[];
  loaded: boolean;
}

function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellState>({
    surface: 'dashboard',
    assistantNavigationRequest: null,
    credentials: [],
    workspaces: [],
    loaded: false,
  });

  useEffect(() => {
    (async () => {
      const [credentials, workspaces] = await Promise.all([
        loadStore<Credential[]>('credentials'),
        loadStore<Workspace[]>('workspaces'),
      ]);
      setState(s => ({
        ...s,
        credentials: credentials ?? [],
        workspaces: workspaces ?? [],
        loaded: true,
      }));
    })();
  }, []);

  useEffect(() => { if (state.loaded) saveStore('credentials', state.credentials); }, [state.credentials, state.loaded]);
  useEffect(() => { if (state.loaded) saveStore('workspaces', state.workspaces); }, [state.workspaces, state.loaded]);

  // Navigation
  const navigate = useCallback((surface: Surface) => setState(s => ({
    ...s,
    surface,
    assistantNavigationRequest: null,
  })), []);

  const requestAssistantNavigation = useCallback<AssistantNavigationHandler>((target) => {
    const request = normalizeAssistantNavigationRequest(target);
    setState(s => ({
      ...s,
      surface: request.surface,
      assistantNavigationRequest: request,
    }));
  }, []);

  const dismissAssistantNavigationRequest = useCallback((requestId?: string) => {
    setState(s => {
      if (!s.assistantNavigationRequest) return s;
      if (requestId && s.assistantNavigationRequest.id !== requestId) return s;
      return {
        ...s,
        assistantNavigationRequest: null,
      };
    });
  }, []);

  useEffect(() => subscribeAssistantNavigation(requestAssistantNavigation), [requestAssistantNavigation]);

  // Credentials
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

  // Workspaces
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
        remaining[0] = { ...remaining[0], isPrimary: true };
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

  // Compose with domain contexts
  const calendar = useCalendar();
  const taskCtx = useTaskContext();
  const chat = useChatContext();
  const knowledge = useKnowledgeContext();
  const finance = useFinanceContext();
  const gamificationCtx = useGamificationContext();
  const settingsCtx = useSettingsContext();
  const assistantCtx = useAssistantContext();
  const clockCtx = useClockContext();

  // Determine overall loaded state
  const allLoaded = state.loaded
    && calendar.loaded
    && taskCtx.loaded
    && chat.loaded
    && knowledge.loaded
    && finance.loaded
    && gamificationCtx.loaded
    && settingsCtx.loaded
    && assistantCtx.loaded
    && clockCtx.loaded;

  const api: AppContextAPI = useMemo(() => ({
    // Shell state
    surface: state.surface,
    credentials: state.credentials,
    workspaces: state.workspaces,
    loaded: allLoaded,
    assistantNavigationRequest: state.assistantNavigationRequest,

    // Calendar
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    addCalendarAccount: calendar.addCalendarAccount,
    updateCalendarAccount: calendar.updateCalendarAccount,
    removeCalendarAccount: calendar.removeCalendarAccount,
    setPrimaryCalendarAccount: calendar.setPrimaryCalendarAccount,
    addCalendarSource: calendar.addCalendarSource,
    updateCalendarSource: calendar.updateCalendarSource,
    removeCalendarSource: calendar.removeCalendarSource,
    addCalendarEvent: calendar.addCalendarEvent,
    updateCalendarEvent: calendar.updateCalendarEvent,
    removeCalendarEvent: calendar.removeCalendarEvent,
    bulkUpsertCalendarSources: calendar.bulkUpsertCalendarSources,
    bulkUpsertCalendarEvents: calendar.bulkUpsertCalendarEvents,
    bulkRemoveCalendarEvents: calendar.bulkRemoveCalendarEvents,

    // Tasks
    tasks: taskCtx.tasks,
    addTask: taskCtx.addTask,
    updateTask: taskCtx.updateTask,
    removeTask: taskCtx.removeTask,

    // Chat
    conversations: chat.conversations,
    activeConversationId: chat.activeConversationId,
    createConversation: chat.createConversation,
    setActiveConversation: chat.setActiveConversation,
    sendMessage: chat.sendMessage,
    deleteConversation: chat.deleteConversation,
    renameConversation: chat.renameConversation,

    // Knowledge
    knowledgeTopics: knowledge.knowledgeTopics,
    knowledgeEntries: knowledge.knowledgeEntries,
    lifestyleItems: knowledge.lifestyleItems,
    addKnowledgeTopic: knowledge.addKnowledgeTopic,
    updateKnowledgeTopic: knowledge.updateKnowledgeTopic,
    removeKnowledgeTopic: knowledge.removeKnowledgeTopic,
    addKnowledgeEntry: knowledge.addKnowledgeEntry,
    updateKnowledgeEntry: knowledge.updateKnowledgeEntry,
    removeKnowledgeEntry: knowledge.removeKnowledgeEntry,
    addLifestyleItem: knowledge.addLifestyleItem,
    updateLifestyleItem: knowledge.updateLifestyleItem,
    removeLifestyleItem: knowledge.removeLifestyleItem,
    reorderLifestyleItems: knowledge.reorderLifestyleItems,

    // Finance
    financeAccounts: finance.financeAccounts,
    transactions: finance.transactions,
    financeBudgets: finance.financeBudgets,
    savingsGoals: finance.savingsGoals,
    assistantCorrections: assistantCtx.corrections,
    addFinanceAccount: finance.addFinanceAccount,
    updateFinanceAccount: finance.updateFinanceAccount,
    removeFinanceAccount: finance.removeFinanceAccount,
    addTransaction: finance.addTransaction,
    updateTransaction: finance.updateTransaction,
    removeTransaction: finance.removeTransaction,
    addFinanceBudget: finance.addFinanceBudget,
    updateFinanceBudget: finance.updateFinanceBudget,
    removeFinanceBudget: finance.removeFinanceBudget,
    addSavingsGoal: finance.addSavingsGoal,
    updateSavingsGoal: finance.updateSavingsGoal,
    removeSavingsGoal: finance.removeSavingsGoal,

    // Gamification
    gamification: gamificationCtx.gamification,
    updateGamification: gamificationCtx.updateGamification,
    backfillPrayerLog: gamificationCtx.backfillPrayerLog,
    upsertAssistantCorrection: assistantCtx.upsertCorrection,
    noteAssistantCorrectionApplied: assistantCtx.noteCorrectionApplied,

    // Clock
    clock: clockCtx.clock,
    startStopwatch: clockCtx.startStopwatch,
    pauseStopwatch: clockCtx.pauseStopwatch,
    resetStopwatch: clockCtx.resetStopwatch,
    recordStopwatchLap: clockCtx.recordStopwatchLap,
    setTimerDuration: clockCtx.setTimerDuration,
    startTimer: clockCtx.startTimer,
    pauseTimer: clockCtx.pauseTimer,
    resetTimer: clockCtx.resetTimer,

    // Settings & Integrations
    settings: settingsCtx.settings,
    integrations: settingsCtx.integrations,
    updateSettings: settingsCtx.updateSettings,
    updateIntegration: settingsCtx.updateIntegration,

    // Navigation
    navigate,
    requestAssistantNavigation,
    dismissAssistantNavigationRequest,

    // Credentials
    addCredential,
    updateCredential,
    removeCredential,

    // Workspaces
    addWorkspace,
    updateWorkspace,
    removeWorkspace,
    setPrimaryWorkspace,
  }), [
    state, allLoaded,
    calendar, taskCtx, chat, knowledge, finance, gamificationCtx, settingsCtx, assistantCtx, clockCtx,
    navigate, requestAssistantNavigation, dismissAssistantNavigationRequest, addCredential, updateCredential, removeCredential,
    addWorkspace, updateWorkspace, removeWorkspace, setPrimaryWorkspace,
  ]);

  if (!allLoaded) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8b8fa3' }}>Loading HELM...</div>;
  }

  return <AppContext.Provider value={api}>{children}</AppContext.Provider>;
}

/**
 * ChatProvider needs cross-domain data. This inner component sits inside all
 * the other providers so it can read their values and pass them to ChatProvider.
 */
function ChatBridge({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const taskCtx = useTaskContext();
  const gamificationCtx = useGamificationContext();
  const settingsCtx = useSettingsContext();
  const knowledge = useKnowledgeContext();
  const finance = useFinanceContext();
  const assistantCtx = useAssistantContext();

  const crossDomain: ChatCrossDomainData = useMemo(() => ({
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    tasks: taskCtx.tasks,
    financeAccounts: finance.financeAccounts,
    transactions: finance.transactions,
    knowledgeEntries: knowledge.knowledgeEntries,
    knowledgeTopics: knowledge.knowledgeTopics,
    lifestyleItems: knowledge.lifestyleItems,
    assistantCorrections: assistantCtx.corrections,
    gamification: gamificationCtx.gamification,
    settings: settingsCtx.settings,
    addTask: taskCtx.addTask,
    updateTask: taskCtx.updateTask,
    removeTask: taskCtx.removeTask,
    upsertAssistantCorrection: assistantCtx.upsertCorrection,
    noteAssistantCorrectionApplied: assistantCtx.noteCorrectionApplied,
    addCalendarEvent: calendar.addCalendarEvent,
    updateCalendarEvent: calendar.updateCalendarEvent,
    addTransaction: finance.addTransaction,
    addKnowledgeEntry: knowledge.addKnowledgeEntry,
    updateGamification: gamificationCtx.updateGamification,
  }), [
    calendar.calendarAccounts,
    calendar.calendarSources,
    calendar.calendarEvents,
    calendar.addCalendarEvent,
    calendar.updateCalendarEvent,
    taskCtx.tasks,
    taskCtx.addTask,
    taskCtx.updateTask,
    taskCtx.removeTask,
    finance.financeAccounts,
    finance.transactions,
    finance.addTransaction,
    knowledge.knowledgeEntries,
    knowledge.knowledgeTopics,
    knowledge.lifestyleItems,
    knowledge.addKnowledgeEntry,
    assistantCtx.corrections,
    assistantCtx.upsertCorrection,
    assistantCtx.noteCorrectionApplied,
    gamificationCtx.gamification,
    gamificationCtx.updateGamification,
    settingsCtx.settings,
  ]);

  return <ChatProvider crossDomain={crossDomain}>{children}</ChatProvider>;
}

// ── Public Provider ──
export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <GamificationProvider>
        <CalendarProvider>
          <TaskProvider>
            <KnowledgeProvider>
              <FinanceProvider>
                <ClockProvider>
                  <AssistantProvider>
                    <ChatBridge>
                      <ShellProvider>{children}</ShellProvider>
                    </ChatBridge>
                  </AssistantProvider>
                </ClockProvider>
              </FinanceProvider>
            </KnowledgeProvider>
          </TaskProvider>
        </CalendarProvider>
      </GamificationProvider>
    </SettingsProvider>
  );
}

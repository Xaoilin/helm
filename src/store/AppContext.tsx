import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import type {
  Surface, ChatConversation,
  CalendarAccount, CalendarSource, CalendarEvent,
  Trip, TripBooking, TripBookingInput, TripBudgetEntry, TripBudgetEntryInput, TripItineraryItem, TripLeg,
  Project, ProjectPage, Integration, Settings,
  Task, GamificationProfile,
  DashboardFocusState,
  KnowledgeTopic, KnowledgeEntry,
  CaptureItem,
  LifestyleItem,
  FastFoodLogEntry,
  FinanceAccount, Transaction, FinanceBudget, SavingsGoal,
  AssistantCorrection,
  AssistantActivityDraft,
  AssistantActivityEntry,
  AssistantUndoResult,
  ClockState,
  ClockTimerSound,
} from '../types/domain';
import {
  normalizeAssistantNavigationRequest,
  subscribeAssistantNavigation,
  type AssistantNavigationHandler,
  type AssistantNavigationRequest,
} from '../services/assistantNavigation';

import { CalendarProvider, useCalendar } from './contexts/CalendarContext';
import { TripProvider, useTripContext } from './contexts/TripContext';
import { ProjectProvider, useProjectContext } from './contexts/ProjectContext';
import { TaskProvider, useTaskContext } from './contexts/TaskContext';
import { ChatProvider, useChatContext, type ChatCrossDomainData } from './contexts/ChatContext';
import { KnowledgeProvider, useKnowledgeContext } from './contexts/KnowledgeContext';
import { CaptureProvider, useCaptureContext } from './contexts/CaptureContext';
import { HealthProvider, useHealthContext } from './contexts/HealthContext';
import { FinanceProvider, useFinanceContext } from './contexts/FinanceContext';
import { GamificationProvider, useGamificationContext } from './contexts/GamificationContext';
import { SettingsProvider, useSettingsContext } from './contexts/SettingsContext';
import { AssistantProvider, useAssistantContext } from './contexts/AssistantContext';
import { AssistantActivityProvider, useAssistantActivityContext } from './contexts/AssistantActivityContext';
import { ClockProvider, useClockContext } from './contexts/ClockContext';
import { DashboardFocusProvider, useDashboardFocusContext } from './contexts/DashboardFocusContext';
import { GoogleSyncProvider } from '../hooks/useGoogleSync';
import { STORAGE_KEYS } from '../config/constants';
import { logError } from '../services/logger';

interface AppContextAPI {
  surface: Surface;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  trips: Trip[];
  tripLegs: TripLeg[];
  tripItineraryItems: TripItineraryItem[];
  tripBookings: TripBooking[];
  tripBudgetEntries: TripBudgetEntry[];
  projects: Project[];
  projectPages: ProjectPage[];
  tasks: Task[];
  knowledgeTopics: KnowledgeTopic[];
  knowledgeEntries: KnowledgeEntry[];
  captureItems: CaptureItem[];
  lifestyleItems: LifestyleItem[];
  fastFoodEntries: FastFoodLogEntry[];
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  financeBudgets: FinanceBudget[];
  savingsGoals: SavingsGoal[];
  integrations: Integration[];
  assistantCorrections: AssistantCorrection[];
  assistantActivityLog: AssistantActivityEntry[];
  gamification: GamificationProfile;
  dashboardFocus: DashboardFocusState;
  settings: Settings;
  clock: ClockState;
  loaded: boolean;
  assistantNavigationRequest: AssistantNavigationRequest | null;

  navigate: (s: Surface) => void;
  requestAssistantNavigation: AssistantNavigationHandler;
  dismissAssistantNavigationRequest: (requestId?: string) => void;

  createConversation: () => string;
  setActiveConversation: (id: string | null) => void;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

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

  addTrip: (trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTrip: (id: string, updates: Partial<Trip>) => void;
  removeTrip: (id: string) => void;
  addTripLeg: (leg: Omit<TripLeg, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTripLeg: (id: string, updates: Partial<TripLeg>) => void;
  removeTripLeg: (id: string) => void;
  addTripItineraryItem: (item: Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTripItineraryItem: (id: string, updates: Partial<TripItineraryItem>) => void;
  removeTripItineraryItem: (id: string) => void;
  addTripBooking: (booking: TripBookingInput) => string;
  updateTripBooking: (id: string, updates: Partial<TripBooking>) => void;
  removeTripBooking: (id: string) => void;
  addTripBudgetEntry: (entry: TripBudgetEntryInput) => string;
  updateTripBudgetEntry: (id: string, updates: Partial<TripBudgetEntry>) => void;
  removeTripBudgetEntry: (id: string) => void;

  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProject: (id: string, updates: Partial<Project>) => void;
  removeProject: (id: string) => void;
  addProjectPage: (page: Omit<ProjectPage, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateProjectPage: (id: string, updates: Partial<ProjectPage>) => void;
  removeProjectPage: (id: string) => void;

  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;

  addKnowledgeTopic: (topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeTopic: (id: string, updates: Partial<KnowledgeTopic>) => void;
  removeKnowledgeTopic: (id: string) => void;
  addKnowledgeEntry: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeEntry: (id: string, updates: Partial<KnowledgeEntry>) => void;
  removeKnowledgeEntry: (id: string) => void;

  addCaptureItem: (item: Omit<CaptureItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCaptureItem: (id: string, updates: Partial<CaptureItem>) => void;
  removeCaptureItem: (id: string) => void;

  addLifestyleItem: (item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateLifestyleItem: (id: string, updates: Partial<LifestyleItem>) => void;
  removeLifestyleItem: (id: string) => void;
  reorderLifestyleItems: (reorderedIds: string[]) => void;

  addFastFoodEntry: (entry: Omit<FastFoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFastFoodEntry: (id: string, updates: Partial<FastFoodLogEntry>) => void;
  removeFastFoodEntry: (id: string) => void;

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

  updateGamification: (profile: GamificationProfile) => void;
  backfillPrayerLog: (taskId: string, dateStr: string, completed: boolean) => void;
  refreshDashboardFocus: () => void;
  dismissDashboardFocus: (candidateId?: string) => void;
  snoozeDashboardFocus: (candidateId?: string, minutes?: number) => void;
  openDashboardFocusTarget: (candidateId?: string) => void;

  createStopwatch: () => string;
  setStopwatchLabel: (id: string, label: string) => void;
  removeStopwatch: (id: string) => void;
  startStopwatch: (id: string) => void;
  pauseStopwatch: (id: string) => void;
  resetStopwatch: (id: string) => void;
  recordStopwatchLap: (id: string) => void;
  createTimer: () => string;
  setTimerLabel: (id: string, label: string) => void;
  removeTimer: (id: string) => void;
  setTimerDuration: (id: string, durationMs: number) => void;
  setTimerSound: (id: string, sound: ClockTimerSound) => void;
  startTimer: (id: string) => void;
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  acknowledgeTimer: (id: string) => void;
  previewTimerSound: (id: string, sound?: ClockTimerSound) => Promise<void>;

  upsertAssistantCorrection: (correction: {
    sourceText: string;
    targetText: string;
    lang: 'en' | 'ar';
    scope: AssistantCorrection['scope'];
  }) => string | null;
  noteAssistantCorrectionApplied: (id: string) => void;
  recordAssistantActivity: (activity: AssistantActivityDraft) => string;
  undoAssistantActivity: (id: string) => AssistantUndoResult;

  updateIntegration: (id: string, updates: Partial<Integration>) => void;
  updateSettings: (updates: Partial<Settings>) => void;
}

const AppContext = createContext<AppContextAPI | null>(null);

export function useApp(): AppContextAPI {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

interface ShellState {
  surface: Surface;
  assistantNavigationRequest: AssistantNavigationRequest | null;
}

function isShellSurface(value: string | null): value is Surface {
  switch (value) {
    case 'dashboard':
    case 'chat':
    case 'inbox':
    case 'calendar':
    case 'clock':
    case 'trips':
    case 'projects':
    case 'tasks':
    case 'finance':
    case 'health':
    case 'knowledge':
    case 'profile':
    case 'integrations':
    case 'activity':
    case 'settings':
    case 'debug':
      return true;
    default:
      return false;
  }
}

function getInitialShellSurface(): Surface {
  try {
    const storedSurface = window.sessionStorage.getItem(STORAGE_KEYS.SHELL_SURFACE);
    return isShellSurface(storedSurface) ? storedSurface : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

function ShellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShellState>(() => ({
    surface: getInitialShellSurface(),
    assistantNavigationRequest: null,
  }));

  const calendar = useCalendar();
  const tripCtx = useTripContext();
  const projectCtx = useProjectContext();
  const taskCtx = useTaskContext();
  const chat = useChatContext();
  const knowledge = useKnowledgeContext();
  const captureCtx = useCaptureContext();
  const health = useHealthContext();
  const finance = useFinanceContext();
  const gamificationCtx = useGamificationContext();
  const settingsCtx = useSettingsContext();
  const assistantCtx = useAssistantContext();
  const activityCtx = useAssistantActivityContext();
  const clockCtx = useClockContext();
  const dashboardFocusCtx = useDashboardFocusContext();

  const navigate = useCallback((surface: Surface) => setState(current => ({
    ...current,
    surface,
    assistantNavigationRequest: null,
  })), []);

  const requestAssistantNavigation = useCallback<AssistantNavigationHandler>((target) => {
    const request = normalizeAssistantNavigationRequest(target);
    setState(current => ({
      ...current,
      surface: request.surface,
      assistantNavigationRequest: request,
    }));
  }, []);

  const dismissAssistantNavigationRequest = useCallback((requestId?: string) => {
    setState(current => {
      if (!current.assistantNavigationRequest) return current;
      if (requestId && current.assistantNavigationRequest.id !== requestId) return current;
      return {
        ...current,
        assistantNavigationRequest: null,
      };
    });
  }, []);

  useEffect(() => subscribeAssistantNavigation(requestAssistantNavigation), [requestAssistantNavigation]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.SHELL_SURFACE, state.surface);
    } catch {
      // Session storage is best-effort; the shell still works without it.
    }
  }, [state.surface]);

  const removeProject = useCallback((id: string) => {
    projectCtx.removeProject(id);

    taskCtx.setTasks(prev => prev.map(task => (
      task.projectId === id
        ? {
          ...task,
          projectId: undefined,
          workflowState: undefined,
          blockedReason: undefined,
          boardOrder: undefined,
          updatedAt: new Date().toISOString(),
        }
        : task
    )));
  }, [projectCtx, taskCtx]);

  const allLoaded = calendar.loaded
    && tripCtx.loaded
    && projectCtx.loaded
    && taskCtx.loaded
    && chat.loaded
    && knowledge.loaded
    && captureCtx.loaded
    && health.loaded
    && finance.loaded
    && gamificationCtx.loaded
    && settingsCtx.loaded
    && assistantCtx.loaded
    && activityCtx.loaded
    && clockCtx.loaded
    && dashboardFocusCtx.loaded;

  const openDashboardFocusTarget = useCallback((candidateId?: string) => {
    const resolvedCandidateId = candidateId || dashboardFocusCtx.dashboardFocus.recommendation?.selectedCandidateId;
    const candidate = dashboardFocusCtx.dashboardFocus.candidates.find(item => item.id === resolvedCandidateId);

    if (!candidate) {
      requestAssistantNavigation({
        surface: 'tasks',
        surfaceState: {
          tasks: {
            tab: 'all',
            resetFilters: true,
          },
        },
      });
      return;
    }

    dashboardFocusCtx.noteDashboardFocusOpened(candidate.id);

    if (candidate.taskId) {
      requestAssistantNavigation({
        surface: 'tasks',
        surfaceState: {
          tasks: {
            tab: candidate.kind === 'habit' || candidate.kind === 'prayer' ? 'today' : 'all',
            resetFilters: true,
            revealTaskId: candidate.taskId,
            highlightTaskId: candidate.taskId,
          },
        },
      });
      return;
    }

    if (candidate.kind === 'meeting_prep') {
      navigate('calendar');
      return;
    }

    requestAssistantNavigation({
      surface: 'tasks',
      surfaceState: {
        tasks: {
          tab: 'all',
          resetFilters: true,
        },
      },
    });
  }, [
    dashboardFocusCtx,
    navigate,
    requestAssistantNavigation,
  ]);

  const undoAssistantActivity = useCallback((id: string): AssistantUndoResult => {
    const entry = activityCtx.assistantActivityLog.find(item => item.id === id);
    if (!entry) {
      return { ok: false, message: 'That Lina activity entry was not found.' };
    }
    if (entry.status === 'undone') {
      return { ok: false, message: 'That Lina action has already been undone.' };
    }
    if (!entry.undoOperation) {
      return { ok: false, message: 'This Lina action does not have an undo operation.' };
    }

    try {
      const operation = entry.undoOperation;
      switch (operation.type) {
        case 'capture.delete':
          captureCtx.removeCaptureItem(operation.id);
          break;
        case 'task.delete':
          taskCtx.removeTask(operation.id);
          break;
        case 'task.restore':
          taskCtx.setTasks(prev => {
            const existingIds = new Set(prev.map(task => task.id));
            const restored = operation.tasks.filter(task => !existingIds.has(task.id));
            return restored.length > 0 ? [...prev, ...restored] : prev;
          });
          break;
        case 'task.replace':
          taskCtx.setTasks(prev => {
            const exists = prev.some(task => task.id === operation.task.id);
            return exists
              ? prev.map(task => task.id === operation.task.id ? operation.task : task)
              : [...prev, operation.task];
          });
          if (operation.gamification) {
            gamificationCtx.updateGamification(operation.gamification);
          }
          break;
        case 'calendar.delete':
          calendar.removeCalendarEvent(operation.id);
          break;
        case 'calendar.replace':
          if (!calendar.calendarEvents.some(event => event.id === operation.event.id)) {
            throw new Error('The calendar event no longer exists.');
          }
          calendar.updateCalendarEvent(operation.event.id, operation.event);
          break;
        case 'finance.delete_transaction':
          if (!finance.transactions.some(transaction => transaction.id === operation.id)) {
            throw new Error('The transaction was already removed.');
          }
          finance.removeTransaction(operation.id);
          break;
        case 'knowledge.delete_entry':
          knowledge.removeKnowledgeEntry(operation.id);
          break;
      }

      activityCtx.markAssistantActivityUndone(id);
      return { ok: true, message: `Undid: ${entry.summary}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      activityCtx.markAssistantActivityUndoFailed(id, message);
      logError('AssistantActivityUndo', error);
      return { ok: false, message };
    }
  }, [
    activityCtx,
    calendar,
    captureCtx,
    finance,
    gamificationCtx,
    knowledge,
    taskCtx,
  ]);

  const api: AppContextAPI = useMemo(() => ({
    surface: state.surface,
    loaded: allLoaded,
    assistantNavigationRequest: state.assistantNavigationRequest,

    conversations: chat.conversations,
    activeConversationId: chat.activeConversationId,
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    trips: tripCtx.trips,
    tripLegs: tripCtx.tripLegs,
    tripItineraryItems: tripCtx.tripItineraryItems,
    tripBookings: tripCtx.tripBookings,
    tripBudgetEntries: tripCtx.tripBudgetEntries,
    projects: projectCtx.projects,
    projectPages: projectCtx.projectPages,
    tasks: taskCtx.tasks,
    knowledgeTopics: knowledge.knowledgeTopics,
    knowledgeEntries: knowledge.knowledgeEntries,
    captureItems: captureCtx.captureItems,
    lifestyleItems: knowledge.lifestyleItems,
    fastFoodEntries: health.fastFoodEntries,
    financeAccounts: finance.financeAccounts,
    transactions: finance.transactions,
    financeBudgets: finance.financeBudgets,
    savingsGoals: finance.savingsGoals,
    integrations: settingsCtx.integrations,
    assistantCorrections: assistantCtx.corrections,
    assistantActivityLog: activityCtx.assistantActivityLog,
    gamification: gamificationCtx.gamification,
    dashboardFocus: dashboardFocusCtx.dashboardFocus,
    settings: settingsCtx.settings,
    clock: clockCtx.clock,

    navigate,
    requestAssistantNavigation,
    dismissAssistantNavigationRequest,

    createConversation: chat.createConversation,
    setActiveConversation: chat.setActiveConversation,
    sendMessage: chat.sendMessage,
    deleteConversation: chat.deleteConversation,
    renameConversation: chat.renameConversation,

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

    addTrip: tripCtx.addTrip,
    updateTrip: tripCtx.updateTrip,
    removeTrip: tripCtx.removeTrip,
    addTripLeg: tripCtx.addTripLeg,
    updateTripLeg: tripCtx.updateTripLeg,
    removeTripLeg: tripCtx.removeTripLeg,
    addTripItineraryItem: tripCtx.addTripItineraryItem,
    updateTripItineraryItem: tripCtx.updateTripItineraryItem,
    removeTripItineraryItem: tripCtx.removeTripItineraryItem,
    addTripBooking: tripCtx.addTripBooking,
    updateTripBooking: tripCtx.updateTripBooking,
    removeTripBooking: tripCtx.removeTripBooking,
    addTripBudgetEntry: tripCtx.addTripBudgetEntry,
    updateTripBudgetEntry: tripCtx.updateTripBudgetEntry,
    removeTripBudgetEntry: tripCtx.removeTripBudgetEntry,

    addProject: projectCtx.addProject,
    updateProject: projectCtx.updateProject,
    removeProject,
    addProjectPage: projectCtx.addProjectPage,
    updateProjectPage: projectCtx.updateProjectPage,
    removeProjectPage: projectCtx.removeProjectPage,

    addTask: taskCtx.addTask,
    updateTask: taskCtx.updateTask,
    removeTask: taskCtx.removeTask,

    addKnowledgeTopic: knowledge.addKnowledgeTopic,
    updateKnowledgeTopic: knowledge.updateKnowledgeTopic,
    removeKnowledgeTopic: knowledge.removeKnowledgeTopic,
    addKnowledgeEntry: knowledge.addKnowledgeEntry,
    updateKnowledgeEntry: knowledge.updateKnowledgeEntry,
    removeKnowledgeEntry: knowledge.removeKnowledgeEntry,
    addCaptureItem: captureCtx.addCaptureItem,
    updateCaptureItem: captureCtx.updateCaptureItem,
    removeCaptureItem: captureCtx.removeCaptureItem,
    addLifestyleItem: knowledge.addLifestyleItem,
    updateLifestyleItem: knowledge.updateLifestyleItem,
    removeLifestyleItem: knowledge.removeLifestyleItem,
    reorderLifestyleItems: knowledge.reorderLifestyleItems,

    addFastFoodEntry: health.addFastFoodEntry,
    updateFastFoodEntry: health.updateFastFoodEntry,
    removeFastFoodEntry: health.removeFastFoodEntry,

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

    updateGamification: gamificationCtx.updateGamification,
    backfillPrayerLog: gamificationCtx.backfillPrayerLog,
    refreshDashboardFocus: dashboardFocusCtx.refreshDashboardFocus,
    dismissDashboardFocus: dashboardFocusCtx.dismissDashboardFocus,
    snoozeDashboardFocus: dashboardFocusCtx.snoozeDashboardFocus,
    openDashboardFocusTarget,

    createStopwatch: clockCtx.createStopwatch,
    setStopwatchLabel: clockCtx.setStopwatchLabel,
    removeStopwatch: clockCtx.removeStopwatch,
    startStopwatch: clockCtx.startStopwatch,
    pauseStopwatch: clockCtx.pauseStopwatch,
    resetStopwatch: clockCtx.resetStopwatch,
    recordStopwatchLap: clockCtx.recordStopwatchLap,
    createTimer: clockCtx.createTimer,
    setTimerLabel: clockCtx.setTimerLabel,
    removeTimer: clockCtx.removeTimer,
    setTimerDuration: clockCtx.setTimerDuration,
    setTimerSound: clockCtx.setTimerSound,
    startTimer: clockCtx.startTimer,
    pauseTimer: clockCtx.pauseTimer,
    resetTimer: clockCtx.resetTimer,
    acknowledgeTimer: clockCtx.acknowledgeTimer,
    previewTimerSound: clockCtx.previewTimerSound,

    upsertAssistantCorrection: assistantCtx.upsertCorrection,
    noteAssistantCorrectionApplied: assistantCtx.noteCorrectionApplied,
    recordAssistantActivity: activityCtx.recordAssistantActivity,
    undoAssistantActivity,

    updateIntegration: settingsCtx.updateIntegration,
    updateSettings: settingsCtx.updateSettings,
  }), [
    state,
    allLoaded,
    chat,
    calendar,
    tripCtx,
    projectCtx,
    taskCtx,
    knowledge,
    captureCtx,
    health,
    finance,
    settingsCtx,
    assistantCtx,
    activityCtx,
    gamificationCtx,
    dashboardFocusCtx,
    clockCtx,
    navigate,
    requestAssistantNavigation,
    dismissAssistantNavigationRequest,
    removeProject,
    openDashboardFocusTarget,
    undoAssistantActivity,
  ]);

  if (!allLoaded) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8b8fa3' }}>Loading HELM...</div>;
  }

  const googleSyncApp = {
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    updateCalendarAccount: calendar.updateCalendarAccount,
    bulkUpsertCalendarSources: calendar.bulkUpsertCalendarSources,
    bulkUpsertCalendarEvents: calendar.bulkUpsertCalendarEvents,
    removeCalendarSource: calendar.removeCalendarSource,
    updateCalendarEvent: calendar.updateCalendarEvent,
    removeCalendarEvent: calendar.removeCalendarEvent,
  };

  return (
    <AppContext.Provider value={api}>
      <GoogleSyncProvider app={googleSyncApp}>
        {children}
      </GoogleSyncProvider>
    </AppContext.Provider>
  );
}

function ChatBridge({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const projectCtx = useProjectContext();
  const taskCtx = useTaskContext();
  const gamificationCtx = useGamificationContext();
  const settingsCtx = useSettingsContext();
  const knowledge = useKnowledgeContext();
  const captureCtx = useCaptureContext();
  const finance = useFinanceContext();
  const assistantCtx = useAssistantContext();
  const activityCtx = useAssistantActivityContext();

  const crossDomain: ChatCrossDomainData = useMemo(() => ({
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    projects: projectCtx.projects,
    tasks: taskCtx.tasks,
    financeAccounts: finance.financeAccounts,
    transactions: finance.transactions,
    knowledgeEntries: knowledge.knowledgeEntries,
    knowledgeTopics: knowledge.knowledgeTopics,
    captureItems: captureCtx.captureItems,
    lifestyleItems: knowledge.lifestyleItems,
    assistantCorrections: assistantCtx.corrections,
    gamification: gamificationCtx.gamification,
    settings: settingsCtx.settings,
    recordAssistantActivity: activityCtx.recordAssistantActivity,
    addTask: taskCtx.addTask,
    updateTask: taskCtx.updateTask,
    removeTask: taskCtx.removeTask,
    upsertAssistantCorrection: assistantCtx.upsertCorrection,
    noteAssistantCorrectionApplied: assistantCtx.noteCorrectionApplied,
    addCalendarEvent: calendar.addCalendarEvent,
    updateCalendarEvent: calendar.updateCalendarEvent,
    addTransaction: finance.addTransaction,
    addKnowledgeEntry: knowledge.addKnowledgeEntry,
    addCaptureItem: captureCtx.addCaptureItem,
    updateGamification: gamificationCtx.updateGamification,
  }), [
    calendar.calendarAccounts,
    calendar.calendarSources,
    calendar.calendarEvents,
    calendar.addCalendarEvent,
    calendar.updateCalendarEvent,
    projectCtx.projects,
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
    captureCtx.captureItems,
    captureCtx.addCaptureItem,
    assistantCtx.corrections,
    assistantCtx.upsertCorrection,
    assistantCtx.noteCorrectionApplied,
    activityCtx.recordAssistantActivity,
    gamificationCtx.gamification,
    gamificationCtx.updateGamification,
    settingsCtx.settings,
  ]);

  return <ChatProvider crossDomain={crossDomain}>{children}</ChatProvider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <GamificationProvider>
        <CalendarProvider>
          <TripProvider>
            <ProjectProvider>
              <TaskProvider>
                <DashboardFocusProvider>
                  <KnowledgeProvider>
                    <CaptureProvider>
                      <HealthProvider>
                        <FinanceProvider>
                          <ClockProvider>
                            <AssistantProvider>
                              <AssistantActivityProvider>
                                <ChatBridge>
                                  <ShellProvider>{children}</ShellProvider>
                                </ChatBridge>
                              </AssistantActivityProvider>
                            </AssistantProvider>
                          </ClockProvider>
                        </FinanceProvider>
                      </HealthProvider>
                    </CaptureProvider>
                  </KnowledgeProvider>
                </DashboardFocusProvider>
              </TaskProvider>
            </ProjectProvider>
          </TripProvider>
        </CalendarProvider>
      </GamificationProvider>
    </SettingsProvider>
  );
}

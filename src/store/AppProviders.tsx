import { useMemo, type ReactNode } from 'react';
import { GoogleSyncProvider } from '../hooks/useGoogleSync';
import { AssistantActivityProvider, useAssistantActivityContext } from './contexts/AssistantActivityContext';
import { AssistantProvider, useAssistantContext } from './contexts/AssistantContext';
import { CalendarProvider, useCalendar } from './contexts/CalendarContext';
import { ChatProvider, type ChatCrossDomainData } from './contexts/ChatContext';
import { ClockProvider } from './contexts/ClockContext';
import { DailyMomentumProvider } from './contexts/DailyMomentumContext';
import { DashboardFocusProvider } from './contexts/DashboardFocusContext';
import { EmploymentProvider } from './contexts/EmploymentContext';
import { FinanceProvider, useFinanceContext } from './contexts/FinanceContext';
import { GamificationProvider, useGamificationContext } from './contexts/GamificationContext';
import { HealthProvider } from './contexts/HealthContext';
import { InventoryProvider, useInventoryContext } from './contexts/InventoryContext';
import { KnowledgeProvider, useKnowledgeContext } from './contexts/KnowledgeContext';
import { PrayerProvider, usePrayerContext } from './contexts/PrayerContext';
import { ProjectProvider, useProjectContext } from './contexts/ProjectContext';
import { SettingsProvider, useSettingsContext } from './contexts/SettingsContext';
import { TaskProvider, useTaskContext } from './contexts/TaskContext';
import { TripProvider } from './contexts/TripContext';
import { AssistantUndoProvider } from './contexts/AssistantUndoContext';
import { MilestoneCelebrationProvider } from './contexts/MilestoneCelebrationContext';
import { ShellProvider } from './ShellContext';

function GoogleSyncBridge({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const app = useMemo(() => ({
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    updateCalendarAccount: calendar.updateCalendarAccount,
    bulkUpsertCalendarSources: calendar.bulkUpsertCalendarSources,
    bulkUpsertCalendarEvents: calendar.bulkUpsertCalendarEvents,
    removeCalendarSource: calendar.removeCalendarSource,
    updateCalendarEvent: calendar.updateCalendarEvent,
    removeCalendarEvent: calendar.removeCalendarEvent,
    bulkRemoveCalendarEvents: calendar.bulkRemoveCalendarEvents,
  }), [
    calendar.calendarAccounts,
    calendar.calendarSources,
    calendar.calendarEvents,
    calendar.updateCalendarAccount,
    calendar.bulkUpsertCalendarSources,
    calendar.bulkUpsertCalendarEvents,
    calendar.removeCalendarSource,
    calendar.updateCalendarEvent,
    calendar.removeCalendarEvent,
    calendar.bulkRemoveCalendarEvents,
  ]);

  return <GoogleSyncProvider app={app}>{children}</GoogleSyncProvider>;
}

function ChatBridge({ children }: { children: ReactNode }) {
  const calendar = useCalendar();
  const projects = useProjectContext();
  const tasks = useTaskContext();
  const gamification = useGamificationContext();
  const settings = useSettingsContext();
  const knowledge = useKnowledgeContext();
  const inventory = useInventoryContext();
  const finance = useFinanceContext();
  const assistant = useAssistantContext();
  const activity = useAssistantActivityContext();
  const prayer = usePrayerContext();

  const crossDomain: ChatCrossDomainData = useMemo(() => ({
    calendarAccounts: calendar.calendarAccounts,
    calendarSources: calendar.calendarSources,
    calendarEvents: calendar.calendarEvents,
    projects: projects.projects,
    tasks: tasks.tasks,
    financeAccounts: finance.financeAccounts,
    transactions: finance.transactions,
    knowledgeEntries: knowledge.knowledgeEntries,
    knowledgeTopics: knowledge.knowledgeTopics,
    inventoryItems: inventory.inventoryItems,
    inventoryNeeds: inventory.inventoryNeeds,
    lifestyleItems: knowledge.lifestyleItems,
    assistantCorrections: assistant.corrections,
    gamification: gamification.gamification,
    settings: settings.settings,
    appTimeZone: settings.appTimeZone.effectiveTimeZone,
    recordAssistantActivity: activity.recordAssistantActivity,
    addTask: tasks.addTask,
    updateTask: tasks.updateTask,
    removeTask: tasks.removeTask,
    upsertAssistantCorrection: assistant.upsertCorrection,
    noteAssistantCorrectionApplied: assistant.noteCorrectionApplied,
    addCalendarEvent: calendar.addCalendarEvent,
    updateCalendarEvent: calendar.updateCalendarEvent,
    addTransaction: finance.addTransaction,
    addKnowledgeEntry: knowledge.addKnowledgeEntry,
    addInventoryItem: inventory.addInventoryItem,
    adjustInventoryQuantity: inventory.adjustInventoryQuantity,
    addInventoryNeed: inventory.addInventoryNeed,
    completeInventoryNeed: inventory.completeInventoryNeed,
    updateGamification: gamification.updateGamification,
    completePrayer: (prayerName, status, taskId, source = 'chat') => (
      prayer.completePrayer(prayerName, status, { taskId, source })
    ),
  }), [
    calendar,
    projects.projects,
    tasks,
    finance,
    knowledge,
    inventory,
    assistant,
    activity.recordAssistantActivity,
    gamification,
    prayer,
    settings.settings,
    settings.appTimeZone.effectiveTimeZone,
  ]);

  return <ChatProvider crossDomain={crossDomain}>{children}</ChatProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <GamificationProvider>
        <DailyMomentumProvider>
          <CalendarProvider>
            <TripProvider>
              <ProjectProvider>
                <TaskProvider>
                  <KnowledgeProvider>
                    <InventoryProvider>
                      <EmploymentProvider>
                        <HealthProvider>
                          <FinanceProvider>
                            <PrayerProvider>
                              <DashboardFocusProvider>
                                <ClockProvider>
                                  <AssistantProvider>
                                    <AssistantActivityProvider>
                                      <ChatBridge>
                                        <ShellProvider>
                                          <AssistantUndoProvider>
                                            <MilestoneCelebrationProvider>
                                              <GoogleSyncBridge>{children}</GoogleSyncBridge>
                                            </MilestoneCelebrationProvider>
                                          </AssistantUndoProvider>
                                        </ShellProvider>
                                      </ChatBridge>
                                    </AssistantActivityProvider>
                                  </AssistantProvider>
                                </ClockProvider>
                              </DashboardFocusProvider>
                            </PrayerProvider>
                          </FinanceProvider>
                        </HealthProvider>
                      </EmploymentProvider>
                    </InventoryProvider>
                  </KnowledgeProvider>
                </TaskProvider>
              </ProjectProvider>
            </TripProvider>
          </CalendarProvider>
        </DailyMomentumProvider>
      </GamificationProvider>
    </SettingsProvider>
  );
}

import type { ReactNode } from 'react';
import { CalendarProvider } from './contexts/CalendarContext';
import { ClockProvider } from './contexts/ClockContext';
import { DailyMomentumProvider } from './contexts/DailyMomentumContext';
import { EmploymentProvider } from './contexts/EmploymentContext';
import { FinanceProvider } from './contexts/FinanceContext';
import { GamificationProvider } from './contexts/GamificationContext';
import { HealthProvider } from './contexts/HealthContext';
import { InventoryProvider } from './contexts/InventoryContext';
import { KnowledgeProvider } from './contexts/KnowledgeContext';
import { PrayerProvider } from './contexts/PrayerContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { TaskProvider } from './contexts/TaskContext';
import { TripProvider } from './contexts/TripContext';
import { MilestoneCelebrationProvider } from './contexts/MilestoneCelebrationContext';
import { ShellProvider } from './ShellContext';
import { useDailyTaskRollover } from './workflows/useDailyTaskRollover';

/** Runs the daily habit and streak rollover once for the whole app, whichever page is open. */
function DailyTaskRollover() {
  useDailyTaskRollover();
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ShellProvider>
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
                                <DailyTaskRollover />
                                <ClockProvider>
                                  <MilestoneCelebrationProvider>
                                    {children}
                                  </MilestoneCelebrationProvider>
                                </ClockProvider>
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
    </ShellProvider>
  );
}

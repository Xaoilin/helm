import type { ReactNode } from 'react';
import { useShell } from './ShellContext';
import { useCalendar } from './contexts/CalendarContext';
import { useClockContext } from './contexts/ClockContext';
import { useDailyMomentumContext } from './contexts/DailyMomentumContext';
import { useFinanceContext } from './contexts/FinanceContext';
import { useGamificationContext } from './contexts/GamificationContext';
import { useHealthContext } from './contexts/HealthContext';
import { useInventoryContext } from './contexts/InventoryContext';
import { useKnowledgeContext } from './contexts/KnowledgeContext';
import { usePrayerContext } from './contexts/PrayerContext';
import { useProjectContext } from './contexts/ProjectContext';
import { useSettingsContext } from './contexts/SettingsContext';
import { useTaskContext } from './contexts/TaskContext';
import { useTripContext } from './contexts/TripContext';

export function useSharedPageReady(): boolean {
  const settings = useSettingsContext().loaded;
  const gamification = useGamificationContext().loaded;
  const momentum = useDailyMomentumContext().loaded;
  const tasks = useTaskContext().loaded;
  const prayer = usePrayerContext().loaded;
  return settings && gamification && momentum && tasks && prayer;
}

export function PageReadinessGate({ children }: { children: ReactNode }) {
  const shell = useShell();
  const shared = useSharedPageReady();
  const knowledge = useKnowledgeContext().loaded;
  const calendar = useCalendar().loaded;
  const settingsReady = useSettingsContext().serviceSettingsReady;
  const integrations = useSettingsContext().integrationsLoaded ?? true;
  const clock = useClockContext().loaded;
  const projects = useProjectContext().loaded;
  const inventory = useInventoryContext().loaded;
  const trips = useTripContext().loaded;
  const health = useHealthContext().loaded;
  const finance = useFinanceContext().loaded;
  // Gate only the page's consumers: a slow Calendar load must not hold the dashboard blank.
  // Calendar owns its date-window loading state so navigation stays mounted during a load.
  const pageReady = shell.surface === 'calendar' ? settingsReady
    : shell.surface === 'integrations' ? calendar && integrations
    : shell.surface === 'clock' ? clock
    : shell.surface === 'knowledge' ? knowledge
    : shell.surface === 'trips' ? trips && calendar
    : shell.surface === 'projects' || shell.surface === 'tasks' || shell.surface === 'secrets' ? projects
    : shell.surface === 'inventory' ? inventory && projects
    : shell.surface === 'health' ? health
    : shell.surface === 'finance' ? finance
    : true; // Employment and its confirmed first seed retain their own loading UI.

  // Dashboard sections own their readiness, so one slow read never hides the entire page.
  if (shell.surface !== 'dashboard' && (!shared || !pageReady)) {
    return <div role="status" aria-live="polite" className="surface-body">Loading page data...</div>;
  }

  return children;
}

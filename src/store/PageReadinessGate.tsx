import type { ReactNode } from 'react';
import { ASSISTANT_ENABLED } from '../config/deprecatedFeatures';
import { useShell } from './ShellContext';
import { useSyncAvailability } from './SyncAvailabilityContext';
import { useAssistantActivityContext } from './contexts/AssistantActivityContext';
import { useAssistantContext } from './contexts/AssistantContext';
import { useCalendar } from './contexts/CalendarContext';
import { useChatContext } from './contexts/ChatContext';
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
  const knowledge = useKnowledgeContext().loaded;
  const calendar = useCalendar().loaded;
  const clock = useClockContext().loaded;
  return settings && gamification && momentum && tasks && prayer && knowledge && calendar && clock;
}

export function useAssistantPageReady(): boolean {
  const shared = useSharedPageReady();
  const projects = useProjectContext().loaded;
  const inventory = useInventoryContext().loaded;
  const finance = useFinanceContext().loaded;
  const conversations = useChatContext().loaded;
  const corrections = useAssistantContext().loaded;
  const activity = useAssistantActivityContext().loaded;
  return shared && projects && inventory && finance && conversations && corrections && activity;
}

export function PageReadinessGate({ children }: { children: ReactNode }) {
  const shell = useShell();
  const { readOnly } = useSyncAvailability();
  const shared = useSharedPageReady();
  const assistant = useAssistantPageReady();
  const projects = useProjectContext().loaded;
  const inventory = useInventoryContext().loaded;
  const trips = useTripContext().loaded;
  const health = useHealthContext().loaded;
  const finance = useFinanceContext().loaded;
  const activity = useAssistantActivityContext().loaded;
  const pageReady = shell.surface === 'chat' ? assistant
    : shell.surface === 'trips' ? trips
    : shell.surface === 'projects' || shell.surface === 'tasks' || shell.surface === 'secrets' ? projects
    : shell.surface === 'inventory' ? inventory && projects
    : shell.surface === 'health' ? health
    : shell.surface === 'finance' ? finance
    : shell.surface === 'activity' ? !ASSISTANT_ENABLED || (activity && finance)
    : true; // Employment and its confirmed first seed retain their own loading UI.

  if ((!shared || !pageReady) && shell.pageLoadError) {
    return (
      <div role="alert" className="surface-body">
        <p>This page could not load: {shell.pageLoadError}</p>
        {!readOnly && <button type="button" className="btn btn-secondary" onClick={shell.retryPageLoad}>Try again</button>}
      </div>
    );
  }

  if (!shared || !pageReady) {
    return <div role="status" aria-live="polite" className="surface-body">Loading page data...</div>;
  }

  return children;
}

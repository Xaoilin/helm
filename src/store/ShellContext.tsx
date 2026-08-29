import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { STORAGE_KEYS } from '../config/constants';
import {
  normalizeAssistantNavigationRequest,
  subscribeAssistantNavigation,
  type AssistantNavigationHandler,
  type AssistantNavigationRequest,
} from '../services/assistantNavigation';
import type { Surface } from '../types/domain';
import { useAssistantActivityContext } from './contexts/AssistantActivityContext';
import { useAssistantContext } from './contexts/AssistantContext';
import { useCalendar } from './contexts/CalendarContext';
import { useChatContext } from './contexts/ChatContext';
import { useClockContext } from './contexts/ClockContext';
import { useDashboardFocusContext } from './contexts/DashboardFocusContext';
import { useEmploymentContext } from './contexts/EmploymentContext';
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

interface ShellContextValue {
  surface: Surface;
  assistantNavigationRequest: AssistantNavigationRequest | null;
  navigate: (surface: Surface) => void;
  requestAssistantNavigation: AssistantNavigationHandler;
  dismissAssistantNavigationRequest: (requestId?: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used within ShellProvider');
  return context;
}

function isShellSurface(value: string | null): value is Surface {
  switch (value) {
    case 'dashboard':
    case 'chat':
    case 'calendar':
    case 'clock':
    case 'trips':
    case 'projects':
    case 'inventory':
    case 'secrets':
    case 'tasks':
    case 'employment':
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

function AppReadinessGate({ children }: { children: ReactNode }) {
  const calendarLoaded = useCalendar().loaded;
  const tripsLoaded = useTripContext().loaded;
  const projectsLoaded = useProjectContext().loaded;
  const tasksLoaded = useTaskContext().loaded;
  const chatLoaded = useChatContext().loaded;
  const knowledgeLoaded = useKnowledgeContext().loaded;
  const inventoryLoaded = useInventoryContext().loaded;
  const employmentLoaded = useEmploymentContext().loaded;
  const healthLoaded = useHealthContext().loaded;
  const financeLoaded = useFinanceContext().loaded;
  const gamificationLoaded = useGamificationContext().loaded;
  const settingsLoaded = useSettingsContext().loaded;
  const assistantLoaded = useAssistantContext().loaded;
  const activityLoaded = useAssistantActivityContext().loaded;
  const clockLoaded = useClockContext().loaded;
  const prayerLoaded = usePrayerContext().loaded;
  const dashboardFocusLoaded = useDashboardFocusContext().loaded;
  const loaded = calendarLoaded
    && tripsLoaded
    && projectsLoaded
    && tasksLoaded
    && chatLoaded
    && knowledgeLoaded
    && inventoryLoaded
    && employmentLoaded
    && healthLoaded
    && financeLoaded
    && gamificationLoaded
    && settingsLoaded
    && assistantLoaded
    && activityLoaded
    && clockLoaded
    && prayerLoaded
    && dashboardFocusLoaded;

  if (!loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8b8fa3' }}>
        Loading Sabah One...
      </div>
    );
  }

  return children;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<Surface>(getInitialShellSurface);
  const [assistantNavigationRequest, setAssistantNavigationRequest] = useState<AssistantNavigationRequest | null>(null);

  const navigate = useCallback((nextSurface: Surface) => {
    setSurface(nextSurface);
    setAssistantNavigationRequest(null);
  }, []);

  const requestAssistantNavigation = useCallback<AssistantNavigationHandler>((target) => {
    const request = normalizeAssistantNavigationRequest(target);
    if (!isShellSurface(request.surface)) {
      setSurface('dashboard');
      setAssistantNavigationRequest(null);
      return;
    }
    setSurface(request.surface);
    setAssistantNavigationRequest(request);
  }, []);

  const dismissAssistantNavigationRequest = useCallback((requestId?: string) => {
    setAssistantNavigationRequest(current => {
      if (!current || (requestId && current.id !== requestId)) return current;
      return null;
    });
  }, []);

  useEffect(() => subscribeAssistantNavigation(requestAssistantNavigation), [requestAssistantNavigation]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.SHELL_SURFACE, surface);
    } catch {
      // Session storage is best-effort; navigation remains available without it.
    }
  }, [surface]);

  const value = useMemo<ShellContextValue>(() => ({
    surface,
    assistantNavigationRequest,
    navigate,
    requestAssistantNavigation,
    dismissAssistantNavigationRequest,
  }), [
    assistantNavigationRequest,
    dismissAssistantNavigationRequest,
    navigate,
    requestAssistantNavigation,
    surface,
  ]);

  return (
    <ShellContext.Provider value={value}>
      <AppReadinessGate>{children}</AppReadinessGate>
    </ShellContext.Provider>
  );
}

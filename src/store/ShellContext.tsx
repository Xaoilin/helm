import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { activateStoreCollections, refreshDatabasePersistence } from './persistence';
import { getPageCollections } from './pageCollections';

interface ShellContextValue {
  surface: Surface;
  pageLoadError: string | null;
  retryPageLoad: () => void;
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

export function getInitialShellSurface(): Surface {
  try {
    const storedSurface = window.sessionStorage.getItem(STORAGE_KEYS.SHELL_SURFACE);
    return isShellSurface(storedSurface) ? storedSurface : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<Surface>(getInitialShellSurface);
  const [pageLoadError, setPageLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadGeneration = useRef(0);
  const [assistantNavigationRequest, setAssistantNavigationRequest] = useState<AssistantNavigationRequest | null>(null);

  const navigate = useCallback((nextSurface: Surface) => {
    loadGeneration.current += 1;
    setSurface(nextSurface);
    setPageLoadError(null);
    setAssistantNavigationRequest(null);
  }, []);

  const requestAssistantNavigation = useCallback<AssistantNavigationHandler>((target) => {
    const request = normalizeAssistantNavigationRequest(target);
    loadGeneration.current += 1;
    setPageLoadError(null);
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

  const retryPageLoad = useCallback(() => {
    const generation = ++loadGeneration.current;
    setPageLoadError(null);
    void refreshDatabasePersistence().then(() => {
      if (generation === loadGeneration.current) setLoadAttempt(attempt => attempt + 1);
    }).catch(error => {
      if (generation === loadGeneration.current) setPageLoadError(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(() => {
    let active = true;
    void activateStoreCollections(getPageCollections(surface)).catch(error => {
      if (active) setPageLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [surface, loadAttempt]);

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
    pageLoadError,
    retryPageLoad,
    assistantNavigationRequest,
    navigate,
    requestAssistantNavigation,
    dismissAssistantNavigationRequest,
  }), [
    assistantNavigationRequest,
    pageLoadError,
    retryPageLoad,
    dismissAssistantNavigationRequest,
    navigate,
    requestAssistantNavigation,
    surface,
  ]);

  return (
    <ShellContext.Provider value={value}>
      {children}
    </ShellContext.Provider>
  );
}

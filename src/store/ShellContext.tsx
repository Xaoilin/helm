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
import type { Surface } from '../types/domain';
import { activateStoreCollections, refreshDatabasePersistence } from './persistence';
import { getPageCollections } from './pageCollections';

/** Initial Tasks view a navigation request asks for. */
export interface TasksNavigationState {
  tab?: 'today' | 'all' | 'goals';
  resetFilters?: boolean;
}

/** A one-shot request to open a surface in a given state; the surface dismisses it once applied. */
export interface NavigationRequest {
  id: string;
  surface: Surface;
  surfaceState?: { tasks?: TasksNavigationState };
}

export type NavigationTarget = Omit<NavigationRequest, 'id'>;

interface ShellContextValue {
  surface: Surface;
  pageLoadError: string | null;
  retryPageLoad: () => void;
  navigationRequest: NavigationRequest | null;
  navigate: (surface: Surface) => void;
  requestNavigation: (target: NavigationTarget) => void;
  dismissNavigationRequest: (requestId?: string) => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used within ShellProvider');
  return context;
}

let navigationSequence = 0;

function isShellSurface(value: string | null): value is Surface {
  switch (value) {
    case 'dashboard':
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
  const [navigationRequest, setNavigationRequest] = useState<NavigationRequest | null>(null);

  const navigate = useCallback((nextSurface: Surface) => {
    loadGeneration.current += 1;
    setSurface(isShellSurface(nextSurface) ? nextSurface : 'dashboard');
    setPageLoadError(null);
    setNavigationRequest(null);
  }, []);

  const requestNavigation = useCallback((target: NavigationTarget) => {
    loadGeneration.current += 1;
    setPageLoadError(null);
    if (!isShellSurface(target.surface)) {
      setSurface('dashboard');
      setNavigationRequest(null);
      return;
    }
    setSurface(target.surface);
    setNavigationRequest({ ...target, id: `nav-${Date.now()}-${navigationSequence++}` });
  }, []);

  const dismissNavigationRequest = useCallback((requestId?: string) => {
    setNavigationRequest(current => {
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
    navigationRequest,
    navigate,
    requestNavigation,
    dismissNavigationRequest,
  }), [
    navigationRequest,
    pageLoadError,
    retryPageLoad,
    dismissNavigationRequest,
    navigate,
    requestNavigation,
    surface,
  ]);

  return (
    <ShellContext.Provider value={value}>
      {children}
    </ShellContext.Provider>
  );
}

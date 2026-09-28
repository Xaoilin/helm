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
import type { Surface } from '../types/domain';

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

function getInitialShellSurface(): Surface {
  try {
    const storedSurface = window.sessionStorage.getItem(STORAGE_KEYS.SHELL_SURFACE);
    return isShellSurface(storedSurface) ? storedSurface : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<Surface>(getInitialShellSurface);
  const [navigationRequest, setNavigationRequest] = useState<NavigationRequest | null>(null);

  const navigate = useCallback((nextSurface: Surface) => {
    setSurface(isShellSurface(nextSurface) ? nextSurface : 'dashboard');
    setNavigationRequest(null);
  }, []);

  const requestNavigation = useCallback((target: NavigationTarget) => {
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

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.SHELL_SURFACE, surface);
    } catch {
      // Session storage is best-effort; navigation remains available without it.
    }
  }, [surface]);

  const value = useMemo<ShellContextValue>(() => ({
    surface,
    navigationRequest,
    navigate,
    requestNavigation,
    dismissNavigationRequest,
  }), [
    navigationRequest,
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

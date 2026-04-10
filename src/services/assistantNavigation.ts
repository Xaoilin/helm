import type { Surface } from '../types/domain';

export type AssistantTaskTab = 'today' | 'all' | 'goals';

export interface AssistantTasksNavigationState {
  tab?: AssistantTaskTab;
  resetFilters?: boolean;
  revealTaskId?: string;
  highlightTaskId?: string;
}

export interface AssistantSurfaceState {
  tasks?: AssistantTasksNavigationState;
}

export interface AssistantNavigationRequest {
  id: string;
  surface: Surface;
  surfaceState?: AssistantSurfaceState;
}

export type AssistantNavigationTarget = Surface | Omit<AssistantNavigationRequest, 'id'> | AssistantNavigationRequest;
export type AssistantNavigationHandler = (target: AssistantNavigationTarget) => void;

type NavigationListener = (request: AssistantNavigationRequest) => void;

const listeners = new Set<NavigationListener>();
let requestSequence = 0;

function normalizeTasksNavigationState(value: AssistantSurfaceState['tasks'] | undefined): AssistantTasksNavigationState | undefined {
  if (!value) return undefined;

  return {
    tab: value.tab,
    resetFilters: value.resetFilters,
    revealTaskId: value.revealTaskId,
    highlightTaskId: value.highlightTaskId,
  };
}

export function normalizeAssistantNavigationRequest(target: AssistantNavigationTarget): AssistantNavigationRequest {
  if (typeof target === 'string') {
    return {
      id: `assistant-nav-${Date.now()}-${requestSequence++}`,
      surface: target,
    };
  }

  return {
    id: 'id' in target && target.id ? target.id : `assistant-nav-${Date.now()}-${requestSequence++}`,
    surface: target.surface,
    surfaceState: target.surfaceState
      ? {
          tasks: normalizeTasksNavigationState(target.surfaceState.tasks),
        }
      : undefined,
  };
}

export function requestAssistantNavigation(target: AssistantNavigationTarget): void {
  const request = normalizeAssistantNavigationRequest(target);
  listeners.forEach(listener => listener(request));
}

export function subscribeAssistantNavigation(listener: NavigationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

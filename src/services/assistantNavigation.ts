import type { Surface } from '../types/domain';

export type AssistantTaskTab = 'today' | 'all' | 'goals';

export interface AssistantTaskRevealRequest {
  taskId: string;
  tab?: AssistantTaskTab;
  resetFilters?: boolean;
  highlight?: boolean;
}

export interface AssistantNavigationRequest {
  id: string;
  surface: Surface;
  taskReveal?: AssistantTaskRevealRequest;
}

export type AssistantNavigationTarget = Surface | Omit<AssistantNavigationRequest, 'id'> | AssistantNavigationRequest;
export type AssistantNavigationHandler = (target: AssistantNavigationTarget) => void;

type NavigationListener = (request: AssistantNavigationRequest) => void;

const listeners = new Set<NavigationListener>();
let requestSequence = 0;

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
    taskReveal: target.taskReveal
      ? {
          taskId: target.taskReveal.taskId,
          tab: target.taskReveal.tab,
          resetFilters: target.taskReveal.resetFilters,
          highlight: target.taskReveal.highlight,
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

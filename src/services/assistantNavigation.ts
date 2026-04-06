import type { Surface } from '../types/domain';

type NavigationListener = (surface: Surface) => void;

const listeners = new Set<NavigationListener>();

export function requestAssistantNavigation(surface: Surface): void {
  listeners.forEach(listener => listener(surface));
}

export function subscribeAssistantNavigation(listener: NavigationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

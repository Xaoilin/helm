/** A service response proves connectivity even when the browser's network hint is wrong. */
let serviceReachable = false;
const listeners = new Set<() => void>();

export function getOnlineStatus(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false || serviceReachable;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function browserConnectionChanged(): void {
  // Evidence from before this network change must not hide a real disconnection.
  serviceReachable = false;
  notify();
}

export function subscribeOnlineStatus(onChange: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('online', browserConnectionChanged);
    window.addEventListener('offline', browserConnectionChanged);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener('online', browserConnectionChanged);
      window.removeEventListener('offline', browserConnectionChanged);
      serviceReachable = false;
    }
  };
}

/** HTTP error responses also prove reachability; the caller still reports the operation error. */
export function reportServiceReachable(): void {
  if (serviceReachable) return;
  serviceReachable = true;
  notify();
}

/**
 * Centralized error logging service.
 *
 * All errors should go through here instead of being swallowed silently.
 * Format: [ServiceName] action failed: message
 *
 * Future: connect to Sentry, LogRocket, or a backend logging service.
 */

export function logError(source: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${source}]`, message, error);
}

export function logWarn(source: string, message: string): void {
  console.warn(`[${source}]`, message);
}

export function logInfo(source: string, message: string): void {
  console.info(`[${source}]`, message);
}

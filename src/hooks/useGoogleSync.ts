import { useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import {
  getValidAccessToken,
} from '../services/googleAuth';
import {
  fetchCalendarList,
  fetchEvents,
  googleEventToLocal,
  GoogleApiError,
} from '../services/googleCalendarApi';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface GoogleSyncResult {
  syncState: SyncState;
  lastSyncTime: string | null;
  syncError: string | null;
  triggerSync: () => Promise<void>;
  accountSyncStates: Record<string, { state: SyncState; lastSync: string | null; error: string | null }>;
}

/** Hook that orchestrates syncing ALL Google Calendar accounts. */
export function useGoogleSync(): GoogleSyncResult {
  const app = useApp();
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [accountSyncStates, setAccountSyncStates] = useState<Record<string, { state: SyncState; lastSync: string | null; error: string | null }>>({});
  const syncingRef = useRef(false);

  const googleAccounts = app.calendarAccounts.filter(a => a.provider === 'google' && a.connected && !a.mocked);
  const clientId = app.settings.googleOAuthClientId;

  const syncAccount = useCallback(async (accountId: string) => {
    if (!clientId) return;

    setAccountSyncStates(prev => ({ ...prev, [accountId]: { state: 'syncing', lastSync: prev[accountId]?.lastSync || null, error: null } }));

    try {
      let accessToken = await getValidAccessToken(accountId, clientId);

      let googleCalendars;
      try {
        googleCalendars = await fetchCalendarList(accessToken);
      } catch (fetchErr) {
        if (fetchErr instanceof GoogleApiError && fetchErr.isAuthError) {
          // Token expired — try silent refresh with timeout (no popup)
          try {
            const { loadGisScript, refreshAccessToken, saveGoogleTokens } = await import('../services/googleAuth');
            await loadGisScript();
            // Race against a 3s timeout — if GIS would open a popup, it takes longer
            const newTokens = await Promise.race([
              refreshAccessToken(clientId),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
            ]);
            saveGoogleTokens(accountId, newTokens);
            accessToken = newTokens.accessToken;
            googleCalendars = await fetchCalendarList(accessToken);
          } catch {
            throw new Error('Token expired. Reconnect this account in Integrations.');
          }
        } else {
          throw fetchErr;
        }
      }

      // Reconcile calendar sources
      // Check ALL sources (not just this account) to avoid duplicating calendars shared across accounts
      const existingSources = app.calendarSources.filter(s => s.accountId === accountId);
      const existingByGoogleId = new Map(existingSources.filter(s => s.googleCalendarId).map(s => [s.googleCalendarId!, s]));
      const allGoogleCalendarIds = new Set(
        app.calendarSources.filter(s => s.googleCalendarId && s.accountId !== accountId).map(s => s.googleCalendarId!)
      );

      const sourcesToUpsert: Array<{
        id?: string;
        accountId: string;
        name: string;
        color: string;
        visible: boolean;
        googleCalendarId: string;
        accessRole: string;
      }> = [];

      for (const gc of googleCalendars) {
        // Skip calendars that already exist under a different account (shared/subscribed calendars)
        if (allGoogleCalendarIds.has(gc.id)) continue;

        const existing = existingByGoogleId.get(gc.id);
        if (existing) {
          if (existing.name !== gc.summary || existing.color !== (gc.backgroundColor || '#4f5bff')) {
            sourcesToUpsert.push({
              id: existing.id,
              accountId,
              name: gc.summary,
              color: gc.backgroundColor || '#4f5bff',
              visible: existing.visible,
              googleCalendarId: gc.id,
              accessRole: gc.accessRole,
            });
          }
        } else {
          sourcesToUpsert.push({
            accountId,
            name: gc.summary,
            color: gc.backgroundColor || '#4f5bff',
            visible: true,
            googleCalendarId: gc.id,
            accessRole: gc.accessRole,
          });
        }
      }

      // Remove sources for calendars no longer in this account's list
      // Also remove duplicate sources that exist under another account (cleanup from older syncs)
      const googleCalendarIds = new Set(googleCalendars.map(gc => gc.id));
      for (const src of existingSources) {
        if (src.googleCalendarId && (!googleCalendarIds.has(src.googleCalendarId) || allGoogleCalendarIds.has(src.googleCalendarId))) {
          app.removeCalendarSource(src.id);
        }
      }

      if (sourcesToUpsert.length > 0) {
        app.bulkUpsertCalendarSources(sourcesToUpsert);
      }

      // Fetch events
      const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

      const updatedSources = app.calendarSources.filter(
        s => s.accountId === accountId && s.googleCalendarId
      );

      // Global set of all googleEventIds already stored (across ALL accounts/sources)
      // to prevent the same event appearing under multiple sources
      const globalEventIds = new Set(
        app.calendarEvents.filter(e => e.googleEventId).map(e => e.googleEventId!)
      );

      for (const source of updatedSources) {
        if (!source.googleCalendarId) continue;
        try {
          const googleEvents = await fetchEvents(accessToken, source.googleCalendarId, timeMin, timeMax);
          const mappedEvents = googleEvents.map(ge => googleEventToLocal(ge, source.id, source.googleCalendarId!));

          const existingEvents = app.calendarEvents.filter(e => e.sourceId === source.id);
          const existingByGoogleEventId = new Map(
            existingEvents.filter(e => e.googleEventId).map(e => [e.googleEventId!, e])
          );

          const eventsToUpsert: Array<typeof mappedEvents[number] & { id?: string }> = [];
          const seenGoogleEventIds = new Set<string>();

          for (const me of mappedEvents) {
            seenGoogleEventIds.add(me.googleEventId);
            const existing = existingByGoogleEventId.get(me.googleEventId);
            if (existing) {
              // Update if changed
              if (existing.title !== me.title || existing.start !== me.start || existing.end !== me.end || existing.description !== me.description) {
                eventsToUpsert.push({ ...me, id: existing.id });
              }
            } else if (!globalEventIds.has(me.googleEventId)) {
              // Only add if this event doesn't already exist under another source
              eventsToUpsert.push(me);
              globalEventIds.add(me.googleEventId);
            }
          }

          const eventsToRemove = existingEvents
            .filter(e => e.googleEventId && !seenGoogleEventIds.has(e.googleEventId))
            .map(e => e.id);

          if (eventsToRemove.length > 0) app.bulkRemoveCalendarEvents(eventsToRemove);
          if (eventsToUpsert.length > 0) app.bulkUpsertCalendarEvents(eventsToUpsert);
        } catch (err) {
          console.warn(`Failed to sync calendar ${source.name}:`, err);
        }
      }

      const now = new Date().toISOString();
      app.updateCalendarAccount(accountId, { lastSyncTime: now, syncError: undefined });
      setAccountSyncStates(prev => ({ ...prev, [accountId]: { state: 'idle', lastSync: now, error: null } }));
    } catch (err) {
      const message = err instanceof GoogleApiError
        ? (err.isAuthError ? 'Authentication expired. Please reconnect.'
          : err.isForbidden ? 'Access was revoked. Please reconnect.'
          : err.isRateLimit ? 'Rate limit reached. Try again later.'
          : `API error: ${err.message}`)
        : (err instanceof Error ? err.message : 'Unknown sync error');

      app.updateCalendarAccount(accountId, { syncError: message });
      setAccountSyncStates(prev => ({ ...prev, [accountId]: { state: 'error', lastSync: prev[accountId]?.lastSync || null, error: message } }));

      if (err instanceof GoogleApiError && (err.isAuthError || err.isForbidden)) {
        const integration = app.integrations.find(i => i.provider === 'google');
        if (integration) app.updateIntegration(integration.id, { status: 'error', lastError: message });
      }
    }
  }, [clientId, app]);

  const triggerSync = useCallback(async () => {
    if (syncingRef.current || googleAccounts.length === 0 || !clientId) return;
    syncingRef.current = true;
    setSyncState('syncing');
    setSyncError(null);

    // Pre-sync cleanup: remove duplicate sources and duplicate events
    cleanupDuplicateSources(app);
    cleanupDuplicateEvents(app);

    let hasError = false;
    for (const acc of googleAccounts) {
      await syncAccount(acc.id);
      const accState = accountSyncStates[acc.id];
      if (accState?.state === 'error') hasError = true;
    }

    setSyncState(hasError ? 'error' : 'idle');
    if (hasError) setSyncError('Some accounts had sync errors');
    syncingRef.current = false;
  }, [googleAccounts, clientId, syncAccount, accountSyncStates]);

  // Auto-sync on mount — but only if last sync was >15 min ago
  // This prevents the Google login popup from appearing on every Calendar tab switch
  useEffect(() => {
    if (googleAccounts.length > 0 && clientId) {
      const lastSync = googleAccounts.reduce<number>((latest, acc) => {
        if (!acc.lastSyncTime) return latest;
        return Math.max(latest, new Date(acc.lastSyncTime).getTime());
      }, 0);
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      if (lastSync < fifteenMinAgo) {
        triggerSync();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleAccounts.length]);

  // Most recent sync time across all accounts
  const lastSyncTime = googleAccounts.reduce<string | null>((latest, acc) => {
    if (!acc.lastSyncTime) return latest;
    if (!latest) return acc.lastSyncTime;
    return acc.lastSyncTime > latest ? acc.lastSyncTime : latest;
  }, null);

  return {
    syncState,
    lastSyncTime,
    syncError,
    triggerSync,
    accountSyncStates,
  };
}

/**
 * Removes duplicate calendar sources that share the same googleCalendarId across accounts.
 * Keeps the source belonging to the earliest account (by calendarAccounts array order).
 * Re-attributes events from removed sources to the surviving source.
 * Exported for testability.
 */
export function cleanupDuplicateSources(app: {
  calendarAccounts: { id: string }[];
  calendarSources: { id: string; accountId: string; googleCalendarId?: string }[];
  calendarEvents: { id: string; sourceId: string }[];
  removeCalendarSource: (id: string) => void;
  updateCalendarEvent: (id: string, updates: { sourceId: string }) => void;
}) {
  // Build account priority order
  const accountOrder = new Map(app.calendarAccounts.map((a, i) => [a.id, i]));

  // Group sources by googleCalendarId
  const byGCalId = new Map<string, typeof app.calendarSources>();
  for (const src of app.calendarSources) {
    if (!src.googleCalendarId) continue;
    const group = byGCalId.get(src.googleCalendarId) || [];
    group.push(src);
    byGCalId.set(src.googleCalendarId, group);
  }

  for (const [, group] of byGCalId) {
    if (group.length <= 1) continue;

    // Sort by account order — earliest account wins
    group.sort((a, b) => (accountOrder.get(a.accountId) ?? 999) - (accountOrder.get(b.accountId) ?? 999));
    const keeper = group[0];
    const duplicates = group.slice(1);

    for (const dup of duplicates) {
      // Re-attribute events from the duplicate source to the keeper
      for (const evt of app.calendarEvents) {
        if (evt.sourceId === dup.id) {
          app.updateCalendarEvent(evt.id, { sourceId: keeper.id });
        }
      }
      app.removeCalendarSource(dup.id);
    }
  }
}

/**
 * Remove duplicate events that share the same googleEventId.
 * Keeps the first occurrence (by insertion order) and removes the rest.
 */
export function cleanupDuplicateEvents(app: {
  calendarEvents: { id: string; googleEventId?: string }[];
  removeCalendarEvent: (id: string) => void;
}) {
  const seen = new Set<string>();
  for (const evt of app.calendarEvents) {
    if (!evt.googleEventId) continue;
    if (seen.has(evt.googleEventId)) {
      app.removeCalendarEvent(evt.id);
    } else {
      seen.add(evt.googleEventId);
    }
  }
}

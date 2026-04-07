import { useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { GOOGLE_OAUTH_CLIENT_ID } from '../config';
import {
  fetchCalendarList,
  fetchEvents,
  googleEventToLocal,
  GoogleApiError,
} from '../services/googleCalendarApi';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  isGoogleCalendarAccount,
} from '../services/googleCalendarAuthManager';
import { LIMITS, TIMING } from '../config/constants';

export type SyncState = 'idle' | 'syncing' | 'error';

export interface GoogleSyncResult {
  syncState: SyncState;
  lastSyncTime: string | null;
  syncError: string | null;
  triggerSync: (manual?: boolean) => Promise<void>;
  accountSyncStates: Record<string, { state: SyncState; lastSync: string | null; error: string | null }>;
}

function getAccountActivityTime(account: { lastSyncTime?: string; lastAuthCheckAt?: string }): number {
  const lastSync = account.lastSyncTime ? new Date(account.lastSyncTime).getTime() : 0;
  const lastAuthCheck = account.lastAuthCheckAt ? new Date(account.lastAuthCheckAt).getTime() : 0;
  return Math.max(lastSync, lastAuthCheck);
}

function shouldAttemptPassiveSync(account: { authStatus?: string; lastSyncTime?: string; lastAuthCheckAt?: string }): boolean {
  if (account.authStatus === 'needs_reconnect' || account.authStatus === 'revoked') {
    return false;
  }
  return getAccountActivityTime(account) < Date.now() - TIMING.SYNC_THROTTLE;
}

/** Hook that orchestrates syncing all connected Google Calendar accounts without interactive auth. */
export function useGoogleSync(): GoogleSyncResult {
  const app = useApp();
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [accountSyncStates, setAccountSyncStates] = useState<Record<string, { state: SyncState; lastSync: string | null; error: string | null }>>({});
  const syncingRef = useRef(false);

  const googleAccounts = app.calendarAccounts.filter(isGoogleCalendarAccount);
  const clientId = GOOGLE_OAUTH_CLIENT_ID;

  const syncAccount = useCallback(async (accountId: string): Promise<boolean> => {
    const account = app.calendarAccounts.find(candidate => candidate.id === accountId);
    if (!account || !clientId) return false;

    setAccountSyncStates(prev => ({
      ...prev,
      [accountId]: {
        state: 'syncing',
        lastSync: prev[accountId]?.lastSync || account.lastSyncTime || null,
        error: null,
      },
    }));

    try {
      const token = await getGoogleCalendarPassiveAccessTokenWithRefresh(account, clientId);
      const accessToken = token.accessToken;
      const googleCalendars = await fetchCalendarList(accessToken);

      const existingSources = app.calendarSources.filter(source => source.accountId === accountId);
      const existingByGoogleId = new Map(existingSources.filter(source => source.googleCalendarId).map(source => [source.googleCalendarId!, source]));
      const allGoogleCalendarIds = new Set(
        app.calendarSources
          .filter(source => source.googleCalendarId && source.accountId !== accountId)
          .map(source => source.googleCalendarId!),
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

      for (const googleCalendar of googleCalendars) {
        if (allGoogleCalendarIds.has(googleCalendar.id)) continue;

        const existing = existingByGoogleId.get(googleCalendar.id);
        if (existing) {
          if (existing.name !== googleCalendar.summary || existing.color !== (googleCalendar.backgroundColor || '#4f5bff')) {
            sourcesToUpsert.push({
              id: existing.id,
              accountId,
              name: googleCalendar.summary,
              color: googleCalendar.backgroundColor || '#4f5bff',
              visible: existing.visible,
              googleCalendarId: googleCalendar.id,
              accessRole: googleCalendar.accessRole,
            });
          }
        } else {
          sourcesToUpsert.push({
            accountId,
            name: googleCalendar.summary,
            color: googleCalendar.backgroundColor || '#4f5bff',
            visible: true,
            googleCalendarId: googleCalendar.id,
            accessRole: googleCalendar.accessRole,
          });
        }
      }

      const googleCalendarIds = new Set(googleCalendars.map(calendar => calendar.id));
      for (const source of existingSources) {
        if (source.googleCalendarId && (!googleCalendarIds.has(source.googleCalendarId) || allGoogleCalendarIds.has(source.googleCalendarId))) {
          app.removeCalendarSource(source.id);
        }
      }

      if (sourcesToUpsert.length > 0) {
        app.bulkUpsertCalendarSources(sourcesToUpsert);
      }

      const timeMin = new Date(Date.now() - LIMITS.CALENDAR_PAST_DAYS * 86400000).toISOString();
      const timeMax = new Date(Date.now() + LIMITS.CALENDAR_FUTURE_DAYS * 86400000).toISOString();
      const updatedSources = app.calendarSources.filter(source => source.accountId === accountId && source.googleCalendarId);
      const globalEventIds = new Set(app.calendarEvents.filter(event => event.googleEventId).map(event => event.googleEventId!));

      for (const source of updatedSources) {
        if (!source.googleCalendarId) continue;

        try {
          const googleEvents = await fetchEvents(accessToken, source.googleCalendarId, timeMin, timeMax);
          const mappedEvents = googleEvents.map(event => googleEventToLocal(event, source.id, source.googleCalendarId!));

          const existingEvents = app.calendarEvents.filter(event => event.sourceId === source.id);
          const existingByGoogleEventId = new Map(
            existingEvents.filter(event => event.googleEventId).map(event => [event.googleEventId!, event]),
          );

          const eventsToUpsert: Array<typeof mappedEvents[number] & { id?: string }> = [];
          const seenGoogleEventIds = new Set<string>();

          for (const mappedEvent of mappedEvents) {
            seenGoogleEventIds.add(mappedEvent.googleEventId);
            const existing = existingByGoogleEventId.get(mappedEvent.googleEventId);
            if (existing) {
              if (
                existing.title !== mappedEvent.title
                || existing.start !== mappedEvent.start
                || existing.end !== mappedEvent.end
                || existing.description !== mappedEvent.description
              ) {
                eventsToUpsert.push({ ...mappedEvent, id: existing.id });
              }
            } else if (!globalEventIds.has(mappedEvent.googleEventId)) {
              eventsToUpsert.push(mappedEvent);
              globalEventIds.add(mappedEvent.googleEventId);
            }
          }

          const eventsToRemove = existingEvents
            .filter(event => event.googleEventId && !seenGoogleEventIds.has(event.googleEventId))
            .map(event => event.id);

          if (eventsToRemove.length > 0) app.bulkRemoveCalendarEvents(eventsToRemove);
          if (eventsToUpsert.length > 0) app.bulkUpsertCalendarEvents(eventsToUpsert);
        } catch (error) {
          console.warn(`Failed to sync calendar ${source.name}:`, error);
        }
      }

      const now = new Date().toISOString();
      app.updateCalendarAccount(accountId, {
        authProvider: token.authProvider,
        authStatus: 'connected',
        authEmail: account.email,
        authExpiresAt: token.authExpiresAt,
        lastAuthCheckAt: now,
        lastAuthError: undefined,
        lastSyncTime: now,
        syncError: undefined,
      });
      setAccountSyncStates(prev => ({
        ...prev,
        [accountId]: { state: 'idle', lastSync: now, error: null },
      }));
      return true;
    } catch (error) {
      const now = new Date().toISOString();
      let message = GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE;
      let authStatus = account.authStatus ?? 'error';

      if (error instanceof GoogleCalendarReconnectRequiredError) {
        message = error.message;
        authStatus = error.authStatus;
        app.updateCalendarAccount(accountId, {
          authProvider: error.authProvider,
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else if (error instanceof GoogleApiError && error.isForbidden) {
        message = GOOGLE_ACCESS_REVOKED_MESSAGE;
        authStatus = 'revoked';
        app.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else if (error instanceof GoogleApiError && error.isAuthError) {
        message = GOOGLE_ACCESS_EXPIRED_MESSAGE;
        authStatus = 'needs_reconnect';
        app.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else {
        authStatus = 'error';
        app.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          syncError: message,
        });
      }

      setAccountSyncStates(prev => ({
        ...prev,
        [accountId]: {
          state: 'error',
          lastSync: prev[accountId]?.lastSync || account.lastSyncTime || null,
          error: message,
        },
      }));

      return false;
    }
  }, [app, clientId]);

  const triggerSync = useCallback(async (manual = false) => {
    void manual;
    if (syncingRef.current || googleAccounts.length === 0 || !clientId) return;

    syncingRef.current = true;
    setSyncState('syncing');
    setSyncError(null);

    cleanupDuplicateSources(app);
    cleanupDuplicateEvents(app);

    const syncableAccounts = googleAccounts.filter(account => account.authStatus !== 'needs_reconnect' && account.authStatus !== 'revoked');
    const blockedAccounts = googleAccounts.length - syncableAccounts.length;

    let hasError = blockedAccounts > 0;
    for (const account of syncableAccounts) {
      const synced = await syncAccount(account.id);
      if (!synced) {
        hasError = true;
      }
    }

    syncingRef.current = false;
    setSyncState(hasError ? 'error' : 'idle');
    setSyncError(hasError ? 'Some Google Calendar accounts need attention.' : null);
  }, [app, clientId, googleAccounts, syncAccount]);

  useEffect(() => {
    if (!clientId || googleAccounts.length === 0) return;

    const shouldAutoSync = googleAccounts.some(shouldAttemptPassiveSync);
    if (shouldAutoSync) {
      const timer = window.setTimeout(() => {
        void triggerSync(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [clientId, googleAccounts, triggerSync]);

  const lastSyncTime = googleAccounts.reduce<string | null>((latest, account) => {
    if (!account.lastSyncTime) return latest;
    if (!latest) return account.lastSyncTime;
    return account.lastSyncTime > latest ? account.lastSyncTime : latest;
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
  const accountOrder = new Map(app.calendarAccounts.map((account, index) => [account.id, index]));
  const byGoogleCalendarId = new Map<string, typeof app.calendarSources>();

  for (const source of app.calendarSources) {
    if (!source.googleCalendarId) continue;
    const group = byGoogleCalendarId.get(source.googleCalendarId) || [];
    group.push(source);
    byGoogleCalendarId.set(source.googleCalendarId, group);
  }

  for (const [, group] of byGoogleCalendarId) {
    if (group.length <= 1) continue;

    group.sort((left, right) => (accountOrder.get(left.accountId) ?? 999) - (accountOrder.get(right.accountId) ?? 999));
    const keeper = group[0];
    const duplicates = group.slice(1);

    for (const duplicate of duplicates) {
      for (const event of app.calendarEvents) {
        if (event.sourceId === duplicate.id) {
          app.updateCalendarEvent(event.id, { sourceId: keeper.id });
        }
      }
      app.removeCalendarSource(duplicate.id);
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
  for (const event of app.calendarEvents) {
    if (!event.googleEventId) continue;
    if (seen.has(event.googleEventId)) {
      app.removeCalendarEvent(event.id);
    } else {
      seen.add(event.googleEventId);
    }
  }
}

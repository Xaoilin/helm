/**
 * Calendar state, owned by the calendar service. Every change is sent to the service and published
 * only once the service confirms it; Google-backed changes are confirmed by Google first. Google
 * credentials never reach the browser, so a Google problem can never affect the Sabah One session.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';
import { useDomainDemand } from './useDomainDemand';
import { ShellContext } from '../ShellContext';
import { calendarWindow, type CalendarWindow } from '../../services/calendarWindow';
import { getAppDate } from '../../services/appTimeZone';
import type { CalendarAccount, CalendarEvent, CalendarSource } from '../../types/domain';
import {
  connectGoogleAccount as connectGoogleAccountRequest,
  createEvent,
  createLocalAccount,
  createLocalSource,
  deleteAccount,
  deleteEvent,
  deleteSource,
  getCalendar,
  isCalendarServiceEnabled,
  syncCalendar,
  updateAccount,
  updateEvent,
  updateSource,
  type SourceChanges,
} from '../../services/backend/calendarServiceApi';
import type {
  ServiceCalendarAccount,
  ServiceCalendarEvent,
  ServiceCalendarSource,
} from '../../services/backend/contracts';
import { ServiceError } from '../../services/backend/serviceClient';
import { useSettingsContext } from './SettingsContext';

/** Google accounts not synced for this long are synced when the calendar loads or regains focus. */
export const CALENDAR_SYNC_STALE_MS = 15 * 60_000;
const SYNC_CHECK_INTERVAL_MS = 5 * 60_000;

export type NewCalendarEvent = Omit<CalendarEvent, 'id'>;

export interface CalendarContextValue {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  /** True once the first load finished, whether or not it succeeded. */
  loaded: boolean;
  eventsLoading?: boolean;
  requestWindow?: (window: CalendarWindow) => void;
  /** Why the calendar could not be loaded; null while it is current. */
  loadError: string | null;
  syncing: boolean;
  /** What the last Google sync could not do; null when every account synced. */
  syncProblem: string | null;
  reload: () => Promise<void>;
  syncGoogle: (accountId?: string) => Promise<void>;
  addCalendarAccount: (account: { name: string; email?: string; paletteIndex?: number }) => Promise<CalendarAccount>;
  updateCalendarAccount: (id: string, changes: { name?: string; paletteIndex?: number }) => Promise<void>;
  setPrimaryCalendarAccount: (id: string) => Promise<void>;
  removeCalendarAccount: (id: string) => Promise<void>;
  connectGoogleAccount: (code: string, redirectUri: string, expectedEmail?: string) => Promise<CalendarAccount>;
  addCalendarSource: (source: { accountId: string; name: string; color: string; visible?: boolean }) => Promise<CalendarSource>;
  updateCalendarSource: (id: string, changes: SourceChanges) => Promise<void>;
  removeCalendarSource: (id: string) => Promise<void>;
  addCalendarEvent: (event: NewCalendarEvent) => Promise<CalendarEvent>;
  /** Merges the changes into the event and saves the result. */
  updateCalendarEvent: (id: string, changes: Partial<NewCalendarEvent>) => Promise<CalendarEvent>;
  removeCalendarEvent: (id: string) => Promise<void>;
}

export const CalendarCtx = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const ctx = useContext(CalendarCtx);
  if (!ctx) throw new Error('useCalendar must be used within CalendarProvider');
  return ctx;
}

/** A message the user can act on for a failed calendar request. */
export function calendarErrorMessage(error: unknown): string {
  if (error instanceof ServiceError) {
    switch (error.code) {
      case 'google_reconnect_required':
        return `${error.message} Reconnect it in Integrations; your Sabah One session is not affected.`;
      case 'network':
      case 'timeout':
      case 'session_unavailable':
        return `${error.message} Nothing was changed; try again.`;
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function toAccount(account: ServiceCalendarAccount): CalendarAccount {
  const google = account.provider === 'google';
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    provider: account.provider,
    isPrimary: account.isPrimary,
    connected: !google || account.authStatus === 'connected',
    mocked: false,
    paletteIndex: account.paletteIndex ?? undefined,
    lastSyncTime: account.lastSyncedAt ?? undefined,
    syncError: account.syncError ?? undefined,
    ...(google ? {
      authProvider: 'calendar-oauth' as const,
      authStatus: account.authStatus,
      authEmail: account.email,
      lastAuthError: account.authError ?? undefined,
    } : {}),
  };
}

function toSource(source: ServiceCalendarSource): CalendarSource {
  return {
    id: source.id,
    accountId: source.accountId,
    name: source.name,
    color: source.color,
    visible: source.visible,
    googleCalendarId: source.googleCalendarId ?? undefined,
    accessRole: source.accessRole ?? undefined,
    writable: source.writable,
  };
}

function toEvent(event: ServiceCalendarEvent, sources: readonly CalendarSource[]): CalendarEvent {
  return {
    id: event.id,
    sourceId: event.sourceId,
    title: event.title,
    description: event.description,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location ?? undefined,
    googleEventId: event.googleEventId ?? undefined,
    googleCalendarId: sources.find(source => source.id === event.sourceId)?.googleCalendarId,
  };
}

/** Google accounts that can sync and have not synced recently. */
function needsSync(accounts: readonly CalendarAccount[], now = Date.now()): boolean {
  return accounts.some(account => account.provider === 'google'
    && account.authStatus === 'connected'
    && (!account.lastSyncTime || now - new Date(account.lastSyncTime).getTime() > CALENDAR_SYNC_STALE_MS));
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { appTimeZone, serviceSettingsReady: settingsLoaded, settings } = useSettingsContext();
  const timeZone = appTimeZone.effectiveTimeZone;
  const shell = useContext(ShellContext);
  const demanded = useDomainDemand('Calendar');
  const today = getAppDate(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
  const [requestedWindow, setRequestedWindow] = useState<CalendarWindow | null>(null);
  const requestWindow = useCallback((next: CalendarWindow) => {
    setRequestedWindow(previous => previous?.from === next.from && previous.to === next.to ? previous : next);
  }, []);
  const range = shell?.surface === 'calendar' ? requestedWindow
    : calendarWindow(today, shell ? 'accounts' : settings.defaultCalendarTab ?? 'week');
  const rangeKey = range ? `${range.from}/${range.to}` : '';
  const rangeRef = useRef(rangeKey);
  useEffect(() => { rangeRef.current = rangeKey; }, [rangeKey]);
  const active = demanded && settingsLoaded && Boolean(range);
  const [confirmedRange, setConfirmedRange] = useState('');
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncProblem, setSyncProblem] = useState<string | null>(null);
  const sourcesRef = useRef<CalendarSource[]>([]);
  const eventsRef = useRef<CalendarEvent[]>([]);
  const accountsRef = useRef<CalendarAccount[]>([]);
  const syncInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => { sourcesRef.current = calendarSources; }, [calendarSources]);
  useEffect(() => { eventsRef.current = calendarEvents; }, [calendarEvents]);
  useEffect(() => { accountsRef.current = calendarAccounts; }, [calendarAccounts]);

  const load = useCallback(async () => {
    if (!rangeKey) return;
    const [from, to] = rangeKey.split('/');
    try {
      const calendar = await getCalendar(from, to);
      if (rangeRef.current !== rangeKey) return;
      const sources = calendar.sources.map(toSource);
      const accounts = calendar.accounts.map(toAccount);
      accountsRef.current = accounts;
      setCalendarAccounts(accounts);
      setCalendarSources(sources);
      setCalendarEvents(calendar.events.map(event => toEvent(event, sources)));
      setConfirmedRange(rangeKey);
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 401 || error.status === 403)) {
        setCalendarAccounts([]);
        setCalendarSources([]);
        setCalendarEvents([]);
        accountsRef.current = [];
        sourcesRef.current = [];
        eventsRef.current = [];
      }
      throw error;
    }
  }, [rangeKey]);
  const { loaded, error: loadError, reload, invalidate } = useServiceLoad('Calendar', isCalendarServiceEnabled(), load,
    LIVE_DOMAINS.calendar, { active, requestKey: rangeKey });

  const syncGoogle = useCallback((accountId?: string): Promise<void> => {
    syncInFlight.current ??= (async () => {
      setSyncing(true);
      try {
        const result = await syncCalendar(accountId);
        const problems = result.accounts.filter(account => account.status !== 'synced')
          .map(account => `${account.email}: ${account.message ?? account.status}`);
        setSyncProblem(problems.length > 0 ? problems.join(' ') : null);
      } catch (error) {
        setSyncProblem(calendarErrorMessage(error));
      } finally {
        setSyncing(false);
      }
      await invalidate();
    })().finally(() => { syncInFlight.current = null; });
    return syncInFlight.current;
  }, [invalidate]);

  // Load, then bring stale Google accounts up to date; repeat while the page is open and visible.
  useEffect(() => {
    if (!active || !loaded || loadError || !isCalendarServiceEnabled()) return undefined;
    let cancelled = false;
    const syncIfStale = () => {
      if (!cancelled && document.visibilityState === 'visible' && needsSync(accountsRef.current)) {
        void syncGoogle();
      }
    };
    syncIfStale();
    const interval = window.setInterval(syncIfStale, SYNC_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', syncIfStale);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', syncIfStale);
    };
  }, [active, loaded, loadError, syncGoogle]);

  const replaceAccount = useCallback((updated: ServiceCalendarAccount, primary: boolean) => {
    const account = toAccount(updated);
    setCalendarAccounts(previous => previous.map(existing => existing.id === account.id
      ? account
      : primary ? { ...existing, isPrimary: false } : existing));
  }, []);

  const addCalendarAccount = useCallback(async (account: { name: string; email?: string; paletteIndex?: number }) => {
    const created = await createLocalAccount(account);
    // The service also creates the account's first calendar.
    await reload();
    return toAccount(created);
  }, [reload]);

  const updateCalendarAccount = useCallback(async (id: string, changes: { name?: string; paletteIndex?: number }) => {
    replaceAccount(await updateAccount(id, changes), false);
  }, [replaceAccount]);

  const setPrimaryCalendarAccount = useCallback(async (id: string) => {
    replaceAccount(await updateAccount(id, { primary: true }), true);
  }, [replaceAccount]);

  const removeCalendarAccount = useCallback(async (id: string) => {
    await deleteAccount(id);
    // Another account may have become primary; the service decides.
    await reload();
  }, [reload]);

  const connectGoogleAccount = useCallback(async (code: string, redirectUri: string, expectedEmail?: string) => {
    const account = await connectGoogleAccountRequest(code, redirectUri, expectedEmail);
    setSyncProblem(null);
    await reload();
    return toAccount(account);
  }, [reload]);

  const addCalendarSource = useCallback(async (source: { accountId: string; name: string; color: string; visible?: boolean }) => {
    const created = toSource(await createLocalSource(source));
    setCalendarSources(previous => [...previous, created]);
    return created;
  }, []);

  const updateCalendarSource = useCallback(async (id: string, changes: SourceChanges) => {
    const updated = toSource(await updateSource(id, changes));
    setCalendarSources(previous => previous.map(source => source.id === id ? updated : source));
  }, []);

  const removeCalendarSource = useCallback(async (id: string) => {
    await deleteSource(id);
    setCalendarSources(previous => previous.filter(source => source.id !== id));
    setCalendarEvents(previous => previous.filter(event => event.sourceId !== id));
  }, []);

  const toRequest = useCallback((event: NewCalendarEvent) => ({
    sourceId: event.sourceId,
    title: event.title,
    description: event.description,
    location: event.location,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    timeZone,
  }), [timeZone]);

  const addCalendarEvent = useCallback(async (event: NewCalendarEvent) => {
    const created = toEvent(await createEvent(toRequest(event)), sourcesRef.current);
    setCalendarEvents(previous => [...previous, created]);
    return created;
  }, [toRequest]);

  const updateCalendarEvent = useCallback(async (id: string, changes: Partial<NewCalendarEvent>) => {
    const existing = eventsRef.current.find(event => event.id === id);
    if (!existing) throw new Error('This event is no longer in your calendar.');
    const updated = toEvent(await updateEvent(id, toRequest({ ...existing, ...changes })), sourcesRef.current);
    setCalendarEvents(previous => previous.map(event => event.id === id ? updated : event));
    return updated;
  }, [toRequest]);

  const removeCalendarEvent = useCallback(async (id: string) => {
    await deleteEvent(id);
    setCalendarEvents(previous => previous.filter(event => event.id !== id));
  }, []);

  const value: CalendarContextValue = {
    calendarAccounts, calendarSources, calendarEvents, loaded, loadError, syncing, syncProblem,
    requestWindow, eventsLoading: active && confirmedRange !== rangeKey && !loadError,
    reload, syncGoogle,
    addCalendarAccount, updateCalendarAccount, setPrimaryCalendarAccount, removeCalendarAccount, connectGoogleAccount,
    addCalendarSource, updateCalendarSource, removeCalendarSource,
    addCalendarEvent, updateCalendarEvent, removeCalendarEvent,
  };

  return <CalendarCtx.Provider value={value}>{children}</CalendarCtx.Provider>;
}

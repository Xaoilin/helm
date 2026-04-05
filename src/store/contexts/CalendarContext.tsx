import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { CalendarAccount, CalendarSource, CalendarEvent } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { clearGoogleTokens } from '../../services/googleAuth';

export interface CalendarContextValue {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  loaded: boolean;
  addCalendarAccount: (account: Omit<CalendarAccount, 'id'>) => string;
  updateCalendarAccount: (id: string, updates: Partial<CalendarAccount>) => void;
  removeCalendarAccount: (id: string) => void;
  setPrimaryCalendarAccount: (id: string) => void;
  addCalendarSource: (source: Omit<CalendarSource, 'id'>) => string;
  updateCalendarSource: (id: string, updates: Partial<CalendarSource>) => void;
  removeCalendarSource: (id: string) => void;
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => string;
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  removeCalendarEvent: (id: string) => void;
  bulkUpsertCalendarSources: (sources: Array<Partial<CalendarSource> & { accountId: string; name: string; color: string; visible: boolean }>) => void;
  bulkUpsertCalendarEvents: (events: Array<Partial<CalendarEvent> & { sourceId: string; title: string; description: string; start: string; end: string; allDay: boolean }>) => void;
  bulkRemoveCalendarEvents: (ids: string[]) => void;
}

const CalendarCtx = createContext<CalendarContextValue | null>(null);

export function useCalendar(): CalendarContextValue {
  const ctx = useContext(CalendarCtx);
  if (!ctx) throw new Error('useCalendar must be used within CalendarProvider');
  return ctx;
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [calendarAccounts, setCalendarAccounts] = useState<CalendarAccount[]>([]);
  const [calendarSources, setCalendarSources] = useState<CalendarSource[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load
  useEffect(() => {
    (async () => {
      const [accounts, sources, events] = await Promise.all([
        loadStore<CalendarAccount[]>('calendarAccounts'),
        loadStore<CalendarSource[]>('calendarSources'),
        loadStore<CalendarEvent[]>('calendarEvents'),
      ]);
      setCalendarAccounts(accounts ?? []);
      setCalendarSources(sources ?? []);
      setCalendarEvents(events ?? []);
      setLoaded(true);
    })();
  }, []);

  // Persist
  useEffect(() => { if (loaded) saveStore('calendarAccounts', calendarAccounts); }, [calendarAccounts, loaded]);
  useEffect(() => { if (loaded) saveStore('calendarSources', calendarSources); }, [calendarSources, loaded]);
  useEffect(() => { if (loaded) saveStore('calendarEvents', calendarEvents); }, [calendarEvents, loaded]);

  // ── Accounts ──
  const addCalendarAccount = useCallback((account: Omit<CalendarAccount, 'id'>): string => {
    const id = uuid();
    setCalendarAccounts(prev => {
      const isPrimary = prev.length === 0 ? true : account.isPrimary;
      const existing = isPrimary ? prev.map(a => ({ ...a, isPrimary: false })) : prev;
      return [...existing, { ...account, id, isPrimary }];
    });
    return id;
  }, []);

  const updateCalendarAccount = useCallback((id: string, updates: Partial<CalendarAccount>) => {
    setCalendarAccounts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const removeCalendarAccount = useCallback((id: string) => {
    clearGoogleTokens(id);
    setCalendarAccounts(prev => {
      const remaining = prev.filter(a => a.id !== id);
      if (remaining.length > 0 && !remaining.some(a => a.isPrimary)) {
        remaining[0] = { ...remaining[0], isPrimary: true };
      }
      return remaining;
    });
    // Cascade: remove orphaned sources and events
    setCalendarSources(prev => {
      const removedSourceIds = prev.filter(src => src.accountId === id).map(src => src.id);
      setCalendarEvents(evts => evts.filter(e => !removedSourceIds.includes(e.sourceId)));
      return prev.filter(src => src.accountId !== id);
    });
  }, []);

  const setPrimaryCalendarAccount = useCallback((id: string) => {
    setCalendarAccounts(prev => prev.map(a => ({ ...a, isPrimary: a.id === id })));
  }, []);

  // ── Sources ──
  const addCalendarSource = useCallback((source: Omit<CalendarSource, 'id'>): string => {
    const id = uuid();
    setCalendarSources(prev => [...prev, { ...source, id }]);
    return id;
  }, []);

  const updateCalendarSource = useCallback((id: string, updates: Partial<CalendarSource>) => {
    setCalendarSources(prev => prev.map(src => src.id === id ? { ...src, ...updates } : src));
  }, []);

  const removeCalendarSource = useCallback((id: string) => {
    setCalendarSources(prev => prev.filter(src => src.id !== id));
    setCalendarEvents(prev => prev.filter(e => e.sourceId !== id));
  }, []);

  // ── Events ──
  const addCalendarEvent = useCallback((event: Omit<CalendarEvent, 'id'>): string => {
    const id = uuid();
    setCalendarEvents(prev => [...prev, { ...event, id }]);
    return id;
  }, []);

  const updateCalendarEvent = useCallback((id: string, updates: Partial<CalendarEvent>) => {
    setCalendarEvents(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const removeCalendarEvent = useCallback((id: string) => {
    setCalendarEvents(prev => prev.filter(e => e.id !== id));
  }, []);

  // ── Bulk (for sync) ──
  const bulkUpsertCalendarSources = useCallback((sources: Array<Partial<CalendarSource> & { accountId: string; name: string; color: string; visible: boolean }>) => {
    setCalendarSources(prev => {
      const newSources = [...prev];
      for (const src of sources) {
        if (src.id) {
          const idx = newSources.findIndex(x => x.id === src.id);
          if (idx >= 0) {
            newSources[idx] = { ...newSources[idx], ...src } as CalendarSource;
          }
        } else {
          newSources.push({ ...src, id: uuid() } as CalendarSource);
        }
      }
      return newSources;
    });
  }, []);

  const bulkUpsertCalendarEvents = useCallback((events: Array<Partial<CalendarEvent> & { sourceId: string; title: string; description: string; start: string; end: string; allDay: boolean }>) => {
    setCalendarEvents(prev => {
      const newEvents = [...prev];
      for (const evt of events) {
        if (evt.id) {
          const idx = newEvents.findIndex(x => x.id === evt.id);
          if (idx >= 0) {
            newEvents[idx] = { ...newEvents[idx], ...evt } as CalendarEvent;
          }
        } else {
          newEvents.push({ ...evt, id: uuid() } as CalendarEvent);
        }
      }
      return newEvents;
    });
  }, []);

  const bulkRemoveCalendarEvents = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setCalendarEvents(prev => prev.filter(e => !idSet.has(e.id)));
  }, []);

  const value: CalendarContextValue = {
    calendarAccounts, calendarSources, calendarEvents, loaded,
    addCalendarAccount, updateCalendarAccount, removeCalendarAccount, setPrimaryCalendarAccount,
    addCalendarSource, updateCalendarSource, removeCalendarSource,
    addCalendarEvent, updateCalendarEvent, removeCalendarEvent,
    bulkUpsertCalendarSources, bulkUpsertCalendarEvents, bulkRemoveCalendarEvents,
  };

  return <CalendarCtx.Provider value={value}>{children}</CalendarCtx.Provider>;
}

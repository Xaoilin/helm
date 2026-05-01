import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { useGoogleSync } from '../hooks/useGoogleSync';
import { appendGoogleCalendarDiagnosticEvent } from '../services/googleCalendarDiagnosticEvents';
import {
  createEvent as googleCreateEvent,
  updateEvent as googleUpdateEvent,
  deleteEvent as googleDeleteEvent,
  localEventToGooglePayload,
} from '../services/googleCalendarApi';
import { logError } from '../services/logger';
import type { CalendarAccount, CalendarEvent } from '../types/domain';
import {
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarCredentialStatusLabel,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarStatusLabel,
  isGoogleCalendarAccount,
} from '../services/googleCalendarAuthManager';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ACCOUNT_PALETTES = [
  { bg: '#1a2744', border: '#3b82f6', text: '#93bbfc' },
  { bg: '#2a1f3d', border: '#a855f7', text: '#c4a0f7' },
  { bg: '#1a3328', border: '#22c55e', text: '#86efac' },
  { bg: '#3d2a1a', border: '#f59e0b', text: '#fcd34d' },
  { bg: '#3d1a2a', border: '#ec4899', text: '#f9a8d4' },
  { bg: '#1a3a3d', border: '#14b8a6', text: '#5eead4' },
  { bg: '#3d2d1a', border: '#f97316', text: '#fdba74' },
  { bg: '#2d1a1a', border: '#ef4444', text: '#fca5a5' },
] as const;

type Tab = 'month' | 'week' | 'agenda' | 'accounts';

export default function CalendarSurface() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>(app.settings.defaultCalendarTab || 'week');
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState(() => {
    const todayDate = new Date();
    return `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  });
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CalendarAccount | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [savingToGoogle, setSavingToGoogle] = useState(false);
  const [movingSourceId, setMovingSourceId] = useState<string | null>(null);

  // Form state for account
  const [accName, setAccName] = useState('');
  const [accEmail, setAccEmail] = useState('');
  const [accProvider, setAccProvider] = useState<CalendarAccount['provider']>('local');

  // Form state for event
  const [evtTitle, setEvtTitle] = useState('');
  const [evtDesc, setEvtDesc] = useState('');
  const [evtStart, setEvtStart] = useState('');
  const [evtEnd, setEvtEnd] = useState('');
  const [evtSourceId, setEvtSourceId] = useState('');
  const [evtAllDay, setEvtAllDay] = useState(false);
  const [evtLocation, setEvtLocation] = useState('');

  const today = new Date();
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Multi-account sync
  const googleAccounts = app.calendarAccounts.filter(isGoogleCalendarAccount);
  const { syncState, lastSyncTime, syncError, triggerSync } = useGoogleSync();
  const hasGoogleAccounts = googleAccounts.length > 0;

  // Visible sources
  const visibleSourceIds = useMemo(
    () => new Set(app.calendarSources.filter(s => s.visible).map(s => s.id)),
    [app.calendarSources]
  );

  const visibleEvents = useMemo(
    () => app.calendarEvents.filter(e => visibleSourceIds.has(e.sourceId)),
    [app.calendarEvents, visibleSourceIds]
  );

  // Helpers
  const isGoogleSource = (sourceId: string) => {
    const source = app.calendarSources.find(s => s.id === sourceId);
    if (!source) return false;
    const account = app.calendarAccounts.find(a => a.id === source.accountId);
    return !!account && isGoogleCalendarAccount(account);
  };

  const getGoogleCalendarId = (sourceId: string) => {
    return app.calendarSources.find(s => s.id === sourceId)?.googleCalendarId;
  };

  const getAccountForSource = (sourceId: string) => {
    const source = app.calendarSources.find(s => s.id === sourceId);
    return source ? app.calendarAccounts.find(a => a.id === source.accountId) : null;
  };

  const getSourceColor = (sourceId: string) => {
    return app.calendarSources.find(s => s.id === sourceId)?.color || '#4f5bff';
  };

  const accountPaletteMap = useMemo(() => {
    const map = new Map<string, typeof ACCOUNT_PALETTES[number]>();
    app.calendarAccounts.forEach((acc, i) => {
      const idx = acc.paletteIndex ?? i;
      map.set(acc.id, ACCOUNT_PALETTES[idx % ACCOUNT_PALETTES.length]);
    });
    return map;
  }, [app.calendarAccounts]);

  const getEventPalette = (sourceId: string) => {
    const source = app.calendarSources.find(s => s.id === sourceId);
    if (!source) return ACCOUNT_PALETTES[0];
    return accountPaletteMap.get(source.accountId) || ACCOUNT_PALETTES[0];
  };

  const isToday = (date: Date) =>
    date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();

  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const getEventsForDate = (date: Date) => {
    const dateStr = toLocalDateStr(date);
    return visibleEvents.filter(e => toLocalDateStr(new Date(e.start)) === dateStr);
  };

  const selectedDate = useMemo(() => {
    const [selectedYear, selectedMonth, selectedDay] = selectedDateStr.split('-').map(Number);
    return new Date(selectedYear, selectedMonth - 1, selectedDay);
  }, [selectedDateStr]);

  const selectedDateEvents = useMemo(
    () => getEventsForDate(selectedDate).sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return a.start.localeCompare(b.start);
    }),
    // getEventsForDate closes over visibleEvents and is intentionally recalculated when visible events change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDate, visibleEvents],
  );

  // ── Month Grid ──
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month - 1, daysInPrev - i), isCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
    }
    return days;
  }, [year, month]);

  // ── Week Grid ──
  const weekDays = useMemo(() => {
    const startOfWeek = new Date(viewDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [viewDate]);

  // ── Navigation ──
  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const prevWeek = () => { const d = new Date(viewDate); d.setDate(d.getDate() - 7); setViewDate(d); };
  const nextWeek = () => { const d = new Date(viewDate); d.setDate(d.getDate() + 7); setViewDate(d); };
  const goToday = () => setViewDate(new Date());

  // ── Account CRUD ──
  const openAddAccount = () => {
    setAccName(''); setAccEmail(''); setAccProvider('local'); setEditingAccount(null); setShowAddAccount(true);
  };
  const openEditAccount = (acc: CalendarAccount) => {
    setAccName(acc.name); setAccEmail(acc.email); setAccProvider(acc.provider); setEditingAccount(acc); setShowAddAccount(true);
  };
  const saveAccount = () => {
    if (!accName.trim() || !accEmail.trim()) return;
    if (editingAccount) {
      app.updateCalendarAccount(editingAccount.id, { name: accName.trim(), email: accEmail.trim(), provider: accProvider });
    } else {
      const id = app.addCalendarAccount({ name: accName.trim(), email: accEmail.trim(), provider: accProvider, isPrimary: false, connected: false, mocked: true });
      app.addCalendarSource({ accountId: id, name: accName.trim(), color: randomColor(), visible: true });
    }
    setShowAddAccount(false);
  };

  // ── Event CRUD ──
  const openAddEvent = (presetDate?: Date) => {
    setEvtTitle(''); setEvtDesc(''); setEvtAllDay(false); setEvtLocation('');
    const d = presetDate || new Date();
    const startStr = `${toLocalDateStr(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const end = new Date(d.getTime() + 3600000);
    const endStr = `${toLocalDateStr(end)}T${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`;
    setEvtStart(startStr); setEvtEnd(endStr);
    setEvtSourceId(app.calendarSources[0]?.id || '');
    setEditingEvent(null); setShowAddEvent(true);
  };
  const openEditEvent = (evt: CalendarEvent) => {
    setEvtTitle(evt.title); setEvtDesc(evt.description); setEvtAllDay(evt.allDay);
    setEvtStart(evt.start.slice(0, 16)); setEvtEnd(evt.end.slice(0, 16));
    setEvtSourceId(evt.sourceId); setEvtLocation(evt.location || '');
    setEditingEvent(evt); setShowAddEvent(true);
  };

  const saveEvent = async () => {
    if (!evtTitle.trim() || !evtSourceId) return;
    const eventData = {
      title: evtTitle.trim(),
      description: evtDesc.trim(),
      start: new Date(evtStart).toISOString(),
      end: new Date(evtEnd).toISOString(),
      allDay: evtAllDay,
      sourceId: evtSourceId,
      location: evtLocation.trim() || undefined,
    };

    const isGoogle = isGoogleSource(evtSourceId);
    const googleCalId = getGoogleCalendarId(evtSourceId);
    const account = getAccountForSource(evtSourceId);

    if (isGoogle && googleCalId && account) {
      setSavingToGoogle(true);
      try {
        const token = await getGoogleCalendarPassiveAccessTokenWithRefresh(account, '');
        const accessToken = token.accessToken;
        const payload = localEventToGooglePayload(eventData);

        if (editingEvent && editingEvent.googleEventId) {
          const result = await googleUpdateEvent(accessToken, googleCalId, editingEvent.googleEventId, payload);
          app.updateCalendarEvent(editingEvent.id, { ...eventData, googleEventId: result.id, pendingSync: undefined });
        } else {
          const result = await googleCreateEvent(accessToken, googleCalId, payload);
          app.addCalendarEvent({ ...eventData, googleEventId: result.id, googleCalendarId: googleCalId });
        }
        app.updateCalendarAccount(account.id, {
          authProvider: token.authProvider,
          authStatus: 'connected',
          authEmail: account.email,
          authExpiresAt: token.authExpiresAt,
          lastAuthCheckAt: new Date().toISOString(),
          lastAuthError: undefined,
          syncError: undefined,
        });
      } catch (err) {
        logError('CalendarSurface', err);
        appendGoogleCalendarDiagnosticEvent({
          operation: 'sync_account',
          phase: 'failure',
          outcome: err instanceof GoogleCalendarReconnectRequiredError ? 'needs_reconnect' : 'failure',
          triggerSource: 'user_action',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: account.authProvider,
          message: err instanceof Error ? `Google event write failed: ${err.message}` : 'Google event write failed.',
        });
        if (err instanceof GoogleCalendarReconnectRequiredError) {
          app.updateCalendarAccount(account.id, {
            authProvider: err.authProvider,
            authStatus: err.authStatus,
            authEmail: account.email,
            lastAuthCheckAt: new Date().toISOString(),
            lastAuthError: err.message,
            syncError: undefined,
          });
        }
        if (editingEvent) {
          app.updateCalendarEvent(editingEvent.id, { ...eventData, pendingSync: 'update' });
        } else {
          app.addCalendarEvent({ ...eventData, pendingSync: 'create' });
        }
      } finally {
        setSavingToGoogle(false);
      }
    } else {
      if (editingEvent) {
        app.updateCalendarEvent(editingEvent.id, eventData);
      } else {
        app.addCalendarEvent(eventData);
      }
    }
    setShowAddEvent(false);
  };

  const handleDeleteEvent = async () => {
    if (!editingEvent) return;
    const isGoogle = isGoogleSource(editingEvent.sourceId);
    const googleCalId = getGoogleCalendarId(editingEvent.sourceId);
    const account = getAccountForSource(editingEvent.sourceId);

    if (isGoogle && googleCalId && editingEvent.googleEventId && account) {
      try {
        const token = await getGoogleCalendarPassiveAccessTokenWithRefresh(account, '');
        const accessToken = token.accessToken;
        await googleDeleteEvent(accessToken, googleCalId, editingEvent.googleEventId);
        app.updateCalendarAccount(account.id, {
          authProvider: token.authProvider,
          authStatus: 'connected',
          authEmail: account.email,
          authExpiresAt: token.authExpiresAt,
          lastAuthCheckAt: new Date().toISOString(),
          lastAuthError: undefined,
          syncError: undefined,
        });
      } catch (err) {
        logError('CalendarSurface', err);
        appendGoogleCalendarDiagnosticEvent({
          operation: 'sync_account',
          phase: 'failure',
          outcome: err instanceof GoogleCalendarReconnectRequiredError ? 'needs_reconnect' : 'failure',
          triggerSource: 'user_action',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: account.authProvider,
          message: err instanceof Error ? `Google event delete failed: ${err.message}` : 'Google event delete failed.',
        });
        if (err instanceof GoogleCalendarReconnectRequiredError) {
          app.updateCalendarAccount(account.id, {
            authProvider: err.authProvider,
            authStatus: err.authStatus,
            authEmail: account.email,
            lastAuthCheckAt: new Date().toISOString(),
            lastAuthError: err.message,
            syncError: undefined,
          });
        }
      }
      app.removeCalendarEvent(editingEvent.id);
    } else {
      app.removeCalendarEvent(editingEvent.id);
    }
    setShowAddEvent(false);
    setDeletingEventId(null);
  };

  // ── Agenda ──
  const agendaEvents = useMemo(() => {
    const now = new Date().toISOString();
    return [...visibleEvents].filter(e => e.end >= now).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 30);
  }, [visibleEvents]);

  // ── Sync status ──
  const syncStatusText = () => {
    if (!hasGoogleAccounts) return null;
    const reconnectCount = googleAccounts.filter(account => account.authStatus === 'needs_reconnect' || account.authStatus === 'revoked').length;
    if (syncState === 'syncing') return <span className="sync-indicator syncing"><span className="spinner" /> Syncing...</span>;
    if (reconnectCount > 0) {
      return <span className="sync-indicator error">{reconnectCount} account{reconnectCount !== 1 ? 's' : ''} need reconnect</span>;
    }
    if (syncState === 'error') return <span className="sync-indicator error">{syncError || 'Sync error'}</span>;
    if (lastSyncTime) {
      const ago = Math.round((Date.now() - new Date(lastSyncTime).getTime()) / 60000);
      const timeText = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
      return <span className="sync-indicator synced">Synced {timeText}</span>;
    }
    return <span className="sync-indicator">Not yet synced</span>;
  };

  // ── Account color legend ──
  const accountLegend = app.calendarAccounts.length > 1 ? (
    <div className="account-legend" data-testid="account-legend">
      {app.calendarAccounts.map(acc => {
        const pal = accountPaletteMap.get(acc.id) || ACCOUNT_PALETTES[0];
        return (
          <div key={acc.id} className="account-legend-item">
            <span className="account-legend-dot" style={{ background: pal.border }} />
            <span className="account-legend-label">{acc.email}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  // ── Week view header ──
  const weekLabel = useMemo(() => {
    const start = weekDays[0];
    const end = weekDays[6];
    if (start.getMonth() === end.getMonth()) {
      return `${MONTHS[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()} \u2013 ${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
  }, [weekDays]);

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Calendar</h1>
          <div className="subtitle">
            {app.calendarAccounts.length === 0
              ? 'No accounts connected'
              : `${app.calendarAccounts.length} account${app.calendarAccounts.length > 1 ? 's' : ''} \u00b7 ${visibleEvents.length} event${visibleEvents.length !== 1 ? 's' : ''}`}
            {hasGoogleAccounts ? (
              <span style={{ marginLeft: 8 }}>{syncStatusText()}</span>
            ) : (
               <span className="mocked-indicator" style={{ marginLeft: 8 }} role="status">Local-only data &ndash; not synced</span>
             )}
          </div>
        </div>
        <div className="actions-row">
          {hasGoogleAccounts && (
            <button className="btn btn-secondary btn-sm" onClick={() => triggerSync(true)} disabled={syncState === 'syncing'} title="Sync cached Google data without opening Google sign-in">
              {syncState === 'syncing' ? <><span className="spinner" /> Syncing</> : '\u{21BB} Sync'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => openAddEvent()} disabled={app.calendarSources.length === 0}>+ Event</button>
          <button className="btn btn-primary" onClick={openAddAccount}>+ Account</button>
        </div>
      </div>
      <div className="surface-body">
        <div className="tabs">
          <button className={`tab ${tab === 'month' ? 'active' : ''}`} onClick={() => setTab('month')}>Month</button>
          <button className={`tab ${tab === 'week' ? 'active' : ''}`} onClick={() => setTab('week')}>Week</button>
          <button className={`tab ${tab === 'agenda' ? 'active' : ''}`} onClick={() => setTab('agenda')}>Agenda</button>
          <button className={`tab ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>Accounts & Sources</button>
        </div>

        {/* ── Month View ── */}
        {tab === 'month' && (
          <div className="calendar-sidebar-panel">
            <div className="calendar-main-panel">
              <div className="calendar-controls">
                <button className="btn-icon" onClick={prevMonth} aria-label="Previous month">&lsaquo;</button>
                <h2>{MONTHS[month]} {year}</h2>
                <button className="btn-icon" onClick={nextMonth} aria-label="Next month">&rsaquo;</button>
                <button className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
              </div>
              {app.calendarAccounts.length === 0 ? (
                <div className="empty-state" role="status">
                  <div className="empty-icon">&#128197;</div>
                  <h3>No calendar accounts</h3>
                  <p>Add a local calendar account or connect Google Calendar from Integrations.</p>
                  <div className="actions-row" style={{ gap: 8 }}>
                    <button className="btn btn-primary" onClick={openAddAccount}>+ Local Account</button>
                    <button className="btn btn-secondary" onClick={() => app.navigate('integrations')}>Connect Google</button>
                  </div>
                </div>
              ) : (
                <div className="calendar-grid">
                  {DAYS.map(d => <div key={d} className="calendar-day-header">{d}</div>)}
                  {calendarDays.map(({ date, isCurrentMonth }, i) => {
                    const dayEvents = getEventsForDate(date);
                    return (
                      <div
                        key={i}
                        className={`calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday(date) ? 'today' : ''} ${toLocalDateStr(date) === selectedDateStr ? 'selected' : ''}`}
                        onClick={() => setSelectedDateStr(toLocalDateStr(date))}
                      >
                        <div className="day-num">{date.getDate()}</div>
                        {dayEvents.slice(0, 3).map(evt => {
                          const pal = getEventPalette(evt.sourceId);
                          return (
                            <div
                              key={evt.id}
                              className="calendar-event-dot"
                              style={{ background: pal.bg, borderLeft: `2px solid ${pal.border}`, position: 'relative' }}
                              onClick={() => openEditEvent(evt)}
                              title={evt.title}
                            >
                              {evt.pendingSync && <span className="event-pending-badge" />}
                              {evt.title}
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 && <div style={{ fontSize: 10, color: '#9499b0' }}>+{dayEvents.length - 3} more</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {app.calendarAccounts.length > 0 && (
                <div className="calendar-mobile-selected-agenda">
                  <div className="calendar-mobile-selected-title">
                    {selectedDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  {selectedDateEvents.length === 0 ? (
                    <div className="calendar-mobile-empty">No events for this day.</div>
                  ) : (
                    selectedDateEvents.map(evt => {
                      const pal = getEventPalette(evt.sourceId);
                      return (
                        <button
                          key={evt.id}
                          className="calendar-mobile-event"
                          style={{ borderLeftColor: pal.border, background: pal.bg }}
                          onClick={() => openEditEvent(evt)}
                        >
                          <span style={{ color: pal.text }}>
                            {evt.allDay ? 'All day' : new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <strong>{evt.title}</strong>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            {app.calendarSources.length > 0 && (
              <div className="calendar-right-panel">
                <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#8b8fa3' }}>Calendars</h3>
                {app.calendarSources.map(source => (
                  <div key={source.id} className="source-toggle">
                    <label className="toggle">
                      <input type="checkbox" checked={source.visible} onChange={e => app.updateCalendarSource(source.id, { visible: e.target.checked })} aria-label={`Toggle ${source.name} calendar`} />
                      <span className="slider" />
                    </label>
                    <span className="dot" style={{ background: source.color }} />
                    <span style={{ fontSize: 12 }}>
                      {source.name}
                      {source.googleCalendarId && <span style={{ fontSize: 10, color: '#8b90a8', marginLeft: 4 }}>(Google)</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Week View (agenda columns) ── */}
        {tab === 'week' && (
          <div>
            <div className="calendar-controls">
              <button className="btn-icon" onClick={prevWeek} aria-label="Previous week">&lsaquo;</button>
              <h2 style={{ minWidth: 280 }}>{weekLabel}</h2>
              <button className="btn-icon" onClick={nextWeek} aria-label="Next week">&rsaquo;</button>
              <button className="btn btn-secondary btn-sm" onClick={goToday}>Today</button>
            </div>
            {accountLegend}
            {app.calendarAccounts.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon">&#128197;</div>
                <h3>No calendar accounts</h3>
                <p>Add a calendar account to see events here.</p>
                <div className="actions-row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={openAddAccount}>+ Local Account</button>
                  <button className="btn btn-secondary" onClick={() => app.navigate('integrations')}>Connect Google</button>
                </div>
              </div>
            ) : (
              <>
                <div className="calendar-mobile-day-strip" aria-label="Week days">
                  {weekDays.map((d, i) => {
                    const dateStr = toLocalDateStr(d);
                    const dayEvents = getEventsForDate(d);
                    return (
                      <button
                        key={i}
                        className={`calendar-mobile-day ${isToday(d) ? 'today' : ''} ${dateStr === selectedDateStr ? 'active' : ''}`}
                        onClick={() => setSelectedDateStr(dateStr)}
                      >
                        <span>{DAYS[d.getDay()]}</span>
                        <strong>{d.getDate()}</strong>
                        {dayEvents.length > 0 && <em>{dayEvents.length}</em>}
                      </button>
                    );
                  })}
                </div>
                <div className="calendar-mobile-selected-agenda">
                  <div className="calendar-mobile-selected-title">
                    {selectedDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                  </div>
                  {selectedDateEvents.length === 0 ? (
                    <div className="calendar-mobile-empty">No events for this day.</div>
                  ) : (
                    selectedDateEvents.map(evt => {
                      const pal = getEventPalette(evt.sourceId);
                      return (
                        <button
                          key={evt.id}
                          className="calendar-mobile-event"
                          style={{ borderLeftColor: pal.border, background: pal.bg }}
                          onClick={() => openEditEvent(evt)}
                        >
                          <span style={{ color: pal.text }}>
                            {evt.allDay ? 'All day' : new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <strong>{evt.title}</strong>
                          {evt.location && <small>{evt.location}</small>}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="week-columns">
                  {weekDays.map((d, i) => {
                    const dayEvents = getEventsForDate(d).sort((a, b) => {
                    if (a.allDay && !b.allDay) return -1;
                    if (!a.allDay && b.allDay) return 1;
                    return a.start.localeCompare(b.start);
                  });
                  return (
                    <div key={i} className={`week-col ${isToday(d) ? 'today' : ''}`}>
                      <div className="week-col-header">
                        <div className="week-col-dayname">{DAYS[d.getDay()]}</div>
                        <div className={`week-col-daynum ${isToday(d) ? 'today' : ''}`}>{d.getDate()}</div>
                      </div>
                      <div className="week-col-events">
                        {dayEvents.length === 0 && (
                          <div style={{ padding: '12px 4px', fontSize: 11, color: '#6b7088', textAlign: 'center' }}>No events</div>
                        )}
                        {dayEvents.map(evt => (
                          (() => {
                            const pal = getEventPalette(evt.sourceId);
                            return (
                              <div
                                key={evt.id}
                                className="week-col-event"
                                style={{
                                  borderLeftColor: pal.border,
                                  background: pal.bg,
                                }}
                                onClick={() => openEditEvent(evt)}
                              >
                                <div className="week-col-event-time" style={{ color: pal.text }}>
                                  {evt.allDay ? 'All day' : new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  {!evt.allDay && (
                                    <> &ndash; {new Date(evt.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                                  )}
                                </div>
                                <div className="week-col-event-title">{evt.title}</div>
                                {evt.location && <div className="week-col-event-loc">{evt.location}</div>}
                              </div>
                            );
                          })()
                        ))}
                      </div>
                    </div>
                  );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Agenda View ── */}
        {tab === 'agenda' && (
          <>
            {accountLegend}
            {agendaEvents.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon">&#128197;</div>
                <h3>No upcoming events</h3>
                <p>Your agenda will show upcoming events from visible calendars.{hasGoogleAccounts ? ' Try syncing to pull latest.' : ''}</p>
                {hasGoogleAccounts && (
                  <button className="btn btn-secondary" onClick={() => triggerSync(true)} disabled={syncState === 'syncing'}>
                    {syncState === 'syncing' ? 'Syncing...' : 'Sync Now'}
                  </button>
                )}
              </div>
            ) : (
              agendaEvents.map(evt => (
                <div key={evt.id} className="agenda-item" onClick={() => openEditEvent(evt)} style={{ cursor: 'pointer' }}>
                  <div className="agenda-time">
                    {evt.allDay ? 'All day' : new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="agenda-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="dot" style={{ width: 8, height: 8, borderRadius: '50%', background: getSourceColor(evt.sourceId), display: 'inline-block', flexShrink: 0 }} />
                      {evt.title}
                      {evt.pendingSync && <span className="tag tag-pending" style={{ fontSize: 9, padding: '1px 4px' }} role="status">pending</span>}
                      {evt.googleEventId && <span style={{ fontSize: 10, color: '#8b90a8' }}>(Google)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: '#9499b0' }}>
                      {new Date(evt.start).toLocaleDateString()}
                      {evt.location && <> &middot; {evt.location}</>}
                      {evt.description && <> &middot; {evt.description.slice(0, 60)}</>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ── Accounts & Sources ── */}
        {tab === 'accounts' && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Accounts</h3>
            {googleAccounts.length > 0 && (
              <div className="info-box" style={{ background: '#152d1a', borderColor: '#1e4d28' }}>
                {googleAccounts.length} Google account{googleAccounts.length > 1 ? 's' : ''} connected.
                {googleAccounts.some(account => account.authStatus === 'needs_reconnect' || account.authStatus === 'revoked')
                  ? ' Some accounts need reconnect before they can sync again.'
                  : ' Manage connections in '}
                <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 11, marginLeft: 6 }} onClick={() => app.navigate('integrations')}>Integrations</button>
              </div>
            )}
            {app.calendarAccounts.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="empty-icon">&#128231;</div>
                <h3>No calendar accounts</h3>
                <p>Add a local calendar account or connect Google Calendar from Integrations.</p>
                <div className="actions-row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={openAddAccount}>+ Local Account</button>
                  <button className="btn btn-secondary" onClick={() => app.navigate('integrations')}>Connect Google</button>
                </div>
              </div>
            ) : (
              app.calendarAccounts.map(acc => {
                const isGoogleAcc = isGoogleCalendarAccount(acc);
                return (
                  <div key={acc.id} className="card">
                    <div className="card-header">
                      <div>
                        <h3 className="card-title">
                          {acc.name}
                          {acc.isPrimary && <span className="tag tag-primary" role="status">Primary</span>}
                          {isGoogleAcc && <span className="tag tag-connected" style={{ marginLeft: 4 }} role="status">Google</span>}
                        </h3>
                        <div className="card-subtitle">
                          {acc.email} &middot; {acc.provider}
                          {acc.mocked && ' (local only)'}
                          {isGoogleAcc && acc.lastSyncTime && ` \u00b7 Synced ${new Date(acc.lastSyncTime).toLocaleString()}`}
                          {isGoogleAcc && acc.lastAuthCheckAt && ` \u00b7 Access checked ${new Date(acc.lastAuthCheckAt).toLocaleString()}`}
                          {isGoogleAcc && ` \u00b7 Credential status ${getGoogleCalendarCredentialStatusLabel(acc)}`}
                          {isGoogleAcc && acc.authProvider === 'profile-google' && ' \u00b7 Linked to HELM sign-in'}
                        </div>
                        {isGoogleAcc && (acc.lastAuthError || acc.syncError) && (
                          <div style={{ fontSize: 11, marginTop: 4, color: acc.authStatus === 'error' ? '#f0c040' : '#ff6b6b' }}>
                            {acc.lastAuthError || acc.syncError}
                          </div>
                        )}
                      </div>
                      <span className={`tag tag-${isGoogleAcc ? (acc.authStatus === 'needs_reconnect' ? 'needs-reconnect' : acc.authStatus || 'connected') : (acc.connected ? 'connected' : 'disconnected')}`} role="status">
                        {isGoogleAcc ? getGoogleCalendarStatusLabel(acc) : (acc.connected ? 'Connected' : 'Local')}
                      </span>
                    </div>
                    {/* Color picker */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 4px' }}>
                      <span style={{ fontSize: 11, color: '#9499b0' }}>Color:</span>
                      {ACCOUNT_PALETTES.map((pal, pi) => {
                        const isSelected = (acc.paletteIndex ?? app.calendarAccounts.indexOf(acc)) % ACCOUNT_PALETTES.length === pi;
                        return (
                          <button
                            key={pi}
                            onClick={() => app.updateCalendarAccount(acc.id, { paletteIndex: pi })}
                            aria-label={`Set color ${pi + 1}`}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              background: pal.bg,
                              border: isSelected ? `2px solid ${pal.border}` : '2px solid transparent',
                              cursor: 'pointer',
                              padding: 0,
                              boxShadow: isSelected ? `0 0 0 1px ${pal.border}` : 'none',
                            }}
                          >
                            <span style={{ display: 'block', width: 8, height: 8, borderRadius: 2, background: pal.border, margin: '4px auto' }} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="actions-row" style={{ marginTop: 6 }}>
                      {!acc.isPrimary && <button className="btn btn-secondary btn-sm" onClick={() => app.setPrimaryCalendarAccount(acc.id)}>Set Primary</button>}
                      {!isGoogleAcc && <button className="btn btn-secondary btn-sm" onClick={() => openEditAccount(acc)}>Edit</button>}
                      {isGoogleAcc
                        ? <button className="btn btn-secondary btn-sm" onClick={() => app.navigate('integrations')}>
                            {acc.authStatus === 'needs_reconnect' || acc.authStatus === 'revoked' ? 'Reconnect in Integrations' : 'Manage in Integrations'}
                          </button>
                        : deletingAccountId === acc.id
                          ? <div className="confirm-bar" style={{ margin: 0 }} role="alert">
                              Delete account?
                              <button className="btn btn-danger btn-sm" onClick={() => { app.removeCalendarAccount(acc.id); setDeletingAccountId(null); }}>Delete</button>
                              <button className="btn btn-secondary btn-sm" onClick={() => setDeletingAccountId(null)}>Cancel</button>
                            </div>
                          : <button className="btn btn-danger btn-sm" onClick={() => setDeletingAccountId(acc.id)}>Remove</button>
                      }
                    </div>
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e2030' }}>
                      <div style={{ fontSize: 12, color: '#9499b0', marginBottom: 6 }}>Calendars ({app.calendarSources.filter(s => s.accountId === acc.id).length})</div>
                      {app.calendarSources.filter(s => s.accountId === acc.id).map(source => {
                        const otherAccounts = app.calendarAccounts.filter(a => a.id !== acc.id);
                        return (
                          <div key={source.id} className="source-toggle" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label className="toggle">
                                <input type="checkbox" checked={source.visible} onChange={e => app.updateCalendarSource(source.id, { visible: e.target.checked })} aria-label={`Toggle ${source.name} calendar`} />
                                <span className="slider" />
                              </label>
                              <span className="dot" style={{ background: source.color }} />
                              <span>{source.name}</span>
                              {source.googleCalendarId && <span style={{ fontSize: 10, color: '#8b90a8' }}>(synced)</span>}
                            </div>
                            <div className="actions-row">
                              {otherAccounts.length > 0 && (
                                movingSourceId === source.id ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 11, color: '#9499b0' }}>Move to:</span>
                                    {otherAccounts.map(otherAcc => {
                                      const pal = accountPaletteMap.get(otherAcc.id) || ACCOUNT_PALETTES[0];
                                      return (
                                        <button
                                          key={otherAcc.id}
                                          className="btn btn-sm"
                                          style={{ background: pal.bg, borderColor: pal.border, color: pal.text, fontSize: 11 }}
                                          onClick={() => {
                                            app.updateCalendarSource(source.id, { accountId: otherAcc.id });
                                            setMovingSourceId(null);
                                          }}
                                        >
                                          {otherAcc.email.split('@')[0]}
                                        </button>
                                      );
                                    })}
                                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setMovingSourceId(null)}>Cancel</button>
                                  </div>
                                ) : (
                                  <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setMovingSourceId(source.id)}>Move</button>
                                )
                              )}
                              {!isGoogleAcc && <button className="btn btn-danger btn-sm" onClick={() => app.removeCalendarSource(source.id)}>Remove</button>}
                            </div>
                          </div>
                        );
                      })}
                      {!isGoogleAcc && (
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={() => app.addCalendarSource({ accountId: acc.id, name: 'New Calendar', color: randomColor(), visible: true })}>
                          + Add Calendar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* ── Add/Edit Account Modal ── */}
      {showAddAccount && (
        <div className="modal-overlay" onClick={() => setShowAddAccount(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingAccount ? 'Edit Account' : 'Add Local Calendar Account'}>
            <h2>{editingAccount ? 'Edit Account' : 'Add Local Calendar Account'}</h2>
            <div className="info-box">
              This creates a local calendar. To connect Google Calendar, go to{' '}
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => { setShowAddAccount(false); app.navigate('integrations'); }}>Integrations</button>.
            </div>
            <div className="form-group">
              <label htmlFor="cal-acc-name">Account Name</label>
              <input id="cal-acc-name" className="form-input" value={accName} onChange={e => setAccName(e.target.value)} placeholder="e.g., Personal" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="cal-acc-email">Email</label>
              <input id="cal-acc-email" className="form-input" value={accEmail} onChange={e => setAccEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="form-group">
              <label htmlFor="cal-acc-provider">Provider</label>
              <select id="cal-acc-provider" className="form-select" value={accProvider} onChange={e => setAccProvider(e.target.value as CalendarAccount['provider'])}>
                <option value="local">Local</option>
                <option value="caldav">CalDAV</option>
                <option value="outlook">Outlook</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddAccount(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAccount} disabled={!accName.trim() || !accEmail.trim()}>
                {editingAccount ? 'Save' : 'Add Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Event Modal ── */}
      {showAddEvent && (
        <div className="modal-overlay" onClick={() => setShowAddEvent(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingEvent ? 'Edit Event' : 'Add Event'}>
            <h2>{editingEvent ? 'Edit Event' : 'Add Event'}</h2>
            {isGoogleSource(evtSourceId) && (
              <div className="info-box" style={{ background: '#152d1a', borderColor: '#1e4d28', fontSize: 11 }}>
                This event will be {editingEvent ? 'updated on' : 'created on'} Google Calendar
                              </div>
            )}
            <div className="form-group">
              <label htmlFor="evt-title">Title</label>
              <input id="evt-title" className="form-input" value={evtTitle} onChange={e => setEvtTitle(e.target.value)} placeholder="Meeting title" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="evt-description">Description</label>
              <textarea id="evt-description" className="form-input" value={evtDesc} onChange={e => setEvtDesc(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="evt-location">Location</label>
              <input id="evt-location" className="form-input" value={evtLocation} onChange={e => setEvtLocation(e.target.value)} placeholder="Optional" />
            </div>
            <div className="form-group">
              <label htmlFor="evt-calendar">Calendar</label>
              <select id="evt-calendar" className="form-select" value={evtSourceId} onChange={e => setEvtSourceId(e.target.value)}>
                {app.calendarSources.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.googleCalendarId ? ' (Google)' : ''}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="evt-start">Start</label>
                <input id="evt-start" className="form-input" type="datetime-local" value={evtStart} onChange={e => setEvtStart(e.target.value)} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="evt-end">End</label>
                <input id="evt-end" className="form-input" type="datetime-local" value={evtEnd} onChange={e => setEvtEnd(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={evtAllDay} onChange={e => setEvtAllDay(e.target.checked)} />
                All day
              </label>
            </div>
            <div className="modal-actions">
              {editingEvent && (
                <button className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={() => {
                  if (deletingEventId === editingEvent.id) handleDeleteEvent();
                  else setDeletingEventId(editingEvent.id);
                }}>
                  {deletingEventId === editingEvent.id ? 'Confirm Delete' : 'Delete'}
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => { setShowAddEvent(false); setDeletingEventId(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEvent} disabled={!evtTitle.trim() || !evtSourceId || savingToGoogle}>
                {savingToGoogle ? <><span className="spinner" /> Saving...</> : editingEvent ? 'Save' : 'Add Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function randomColor(): string {
  const colors = ['#4f5bff', '#ff6b6b', '#3ab553', '#f0c040', '#c084fc', '#22d3ee', '#fb923c', '#ec4899'];
  return colors[Math.floor(Math.random() * colors.length)];
}

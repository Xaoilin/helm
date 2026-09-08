import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  FastFoodLogEntry,
  KnowledgeEntry,
  KnowledgeTopic,
} from '../types/domain';
import CalendarSurface from '../surfaces/CalendarSurface';
import HealthSurface from '../surfaces/HealthSurface';
import KnowledgeSurface from '../surfaces/KnowledgeSurface';

const mocks = vi.hoisted(() => ({
  shell: {
    navigate: vi.fn(),
  },
  settings: {
    settings: { defaultCalendarTab: 'month' },
    appTimeZone: { effectiveTimeZone: 'Europe/London' },
  },
  calendar: {
    calendarAccounts: [] as CalendarAccount[],
    calendarSources: [] as CalendarSource[],
    calendarEvents: [] as CalendarEvent[],
    addCalendarAccount: vi.fn(),
    updateCalendarAccount: vi.fn(),
    removeCalendarAccount: vi.fn(),
    setPrimaryCalendarAccount: vi.fn(),
    addCalendarSource: vi.fn(),
    updateCalendarSource: vi.fn(),
    removeCalendarSource: vi.fn(),
    addCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    removeCalendarEvent: vi.fn(),
    bulkUpsertCalendarSources: vi.fn(),
    bulkUpsertCalendarEvents: vi.fn(),
    bulkRemoveCalendarEvents: vi.fn(),
  },
  sync: {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
    triggerSync: vi.fn(),
  },
  knowledge: {
    knowledgeTopics: [] as KnowledgeTopic[],
    knowledgeEntries: [] as KnowledgeEntry[],
    lifestyleItems: [],
    addKnowledgeTopic: vi.fn(),
    updateKnowledgeTopic: vi.fn(),
    removeKnowledgeTopic: vi.fn(),
    addKnowledgeEntry: vi.fn(),
    updateKnowledgeEntry: vi.fn(),
    removeKnowledgeEntry: vi.fn(),
    addLifestyleItem: vi.fn(),
    updateLifestyleItem: vi.fn(),
    removeLifestyleItem: vi.fn(),
    reorderLifestyleItems: vi.fn(),
  },
  health: {
    fastFoodEntries: [] as FastFoodLogEntry[],
    loaded: true,
    addFastFoodEntry: vi.fn(),
    updateFastFoodEntry: vi.fn(),
    removeFastFoodEntry: vi.fn(),
  },
}));

vi.mock('../store/ShellContext', () => ({ useShell: () => mocks.shell }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => mocks.settings }));
vi.mock('../store/contexts/CalendarContext', () => ({ useCalendar: () => mocks.calendar }));
vi.mock('../store/contexts/KnowledgeContext', () => ({ useKnowledgeContext: () => mocks.knowledge }));
vi.mock('../store/contexts/HealthContext', () => ({ useHealthContext: () => mocks.health }));
vi.mock('../hooks/useGoogleSync', () => ({ useGoogleSync: () => mocks.sync }));
vi.mock('../components/knowledge/ElifBManualEvidence', () => ({ default: () => null }));
vi.mock('../components/AppleHealthMovementImport', () => ({ default: () => null }));
vi.mock('../services/googleCalendarApi', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  localEventToGooglePayload: vi.fn(),
}));
vi.mock('../services/googleCalendarDiagnosticEvents', () => ({ appendGoogleCalendarDiagnosticEvent: vi.fn() }));
vi.mock('../services/googleCalendarAuthManager', () => ({
  GoogleCalendarReconnectRequiredError: class GoogleCalendarReconnectRequiredError extends Error {},
  getGoogleCalendarCredentialStatusLabel: vi.fn(() => 'Connected'),
  getGoogleCalendarPassiveAccessTokenWithRefresh: vi.fn(),
  getGoogleCalendarStatusLabel: vi.fn(() => 'Connected'),
  isGoogleCalendarAccount: vi.fn(() => false),
}));
vi.mock('../services/logger', () => ({ logError: vi.fn() }));

function resetFixtures() {
  const today = new Date();
  const start = new Date(today.getTime() + 60 * 60 * 1000).toISOString();
  const end = new Date(today.getTime() + 2 * 60 * 60 * 1000).toISOString();
  mocks.calendar.calendarAccounts = [{
    id: 'account-1',
    name: 'Personal',
    email: 'personal@example.com',
    provider: 'local',
    isPrimary: true,
    connected: true,
    mocked: true,
  }];
  mocks.calendar.calendarSources = [{
    id: 'source-1',
    accountId: 'account-1',
    name: 'Personal',
    color: '#4f5bff',
    visible: true,
  }];
  mocks.calendar.calendarEvents = [{
    id: 'event-1',
    sourceId: 'source-1',
    title: 'Team sync',
    description: 'Discuss delivery.',
    start,
    end,
    allDay: false,
  }];
  mocks.knowledge.knowledgeTopics = [{
    id: 'topic-1',
    name: 'Prayer foundations',
    description: 'Core notes',
    icon: '\u{1F4D6}',
    color: '#3b82f6',
    sortOrder: 0,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  }];
  mocks.knowledge.knowledgeEntries = [];
  mocks.knowledge.lifestyleItems = [];
  mocks.health.fastFoodEntries = [{
    id: 'health-1',
    venue: 'Example Grill',
    date: today.toISOString().slice(0, 10),
    rating: 'bad',
    symptoms: [],
    notes: 'Felt heavy.',
    createdAt: '2026-09-08T10:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
  }];
  for (const group of [mocks.shell, mocks.calendar, mocks.sync, mocks.knowledge, mocks.health]) {
    for (const value of Object.values(group)) {
      if (typeof value === 'function' && 'mockClear' in value) value.mockClear();
    }
  }
}

describe('core card controls', () => {
  beforeEach(() => {
    resetFixtures();
  });

  it('exposes Calendar month, week, and agenda events as focusable open buttons', () => {
    render(<CalendarSurface />);

    const monthEvent = screen.getByRole('button', { name: 'Open Team sync' });
    monthEvent.focus();
    expect(monthEvent).toHaveFocus();
    fireEvent.click(monthEvent);
    expect(screen.getByRole('dialog', { name: 'Edit Event' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    const weekEvent = screen.getByRole('button', { name: 'Open Team sync' });
    weekEvent.focus();
    expect(weekEvent).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    const agendaEvent = screen.getByRole('button', { name: 'Open Team sync' });
    agendaEvent.focus();
    expect(agendaEvent).toHaveFocus();
  });

  it('exposes the Knowledge topic open action separately from Edit', () => {
    render(<KnowledgeSurface />);

    const openTopic = screen.getByRole('button', { name: 'Open Prayer foundations' });
    openTopic.focus();
    expect(openTopic).toHaveFocus();
    fireEvent.click(openTopic);

    expect(screen.getByRole('heading', { name: 'Prayer foundations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Topics/ })).toBeInTheDocument();
  });

  it('removes a Health entry only after native confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<HealthSurface />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith('Remove "Example Grill"?');
    expect(mocks.health.removeFastFoodEntry).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mocks.health.removeFastFoodEntry).toHaveBeenCalledWith('health-1');
    confirm.mockRestore();
  });
});

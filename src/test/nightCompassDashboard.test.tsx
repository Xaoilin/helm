import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultDailyMomentumState,
  getDailyMomentumDay,
  selectDailyMomentumPath,
} from '../services/dailyMomentum';
import type { DailyMomentumState, PrayerName, PrayerTrackingRecord } from '../types/domain';

const contextMocks = vi.hoisted(() => ({
  app: {} as Record<string, unknown>,
  prayer: {} as Record<string, unknown>,
  momentum: {} as Record<string, unknown>,
}));

vi.mock('../store/AppContext', () => ({ useApp: () => contextMocks.app }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => contextMocks.prayer }));
vi.mock('../store/contexts/DailyMomentumContext', () => ({ useDailyMomentumContext: () => contextMocks.momentum }));

import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';

const TODAY = '2026-08-28';
const LONG_TASK = 'Prepare the extraordinarily detailed launch readiness review without duplicating it anywhere else';
const PRAYERS = [
  { name: 'Fajr', nameArabic: 'الفجر', time: '05:00', type: 'prayer' as const },
  { name: 'Sunrise', nameArabic: 'الشروق', time: '06:45', type: 'event' as const },
  { name: 'Dhuhr', nameArabic: 'الظهر', time: '13:00', type: 'prayer' as const },
  { name: 'Asr', nameArabic: 'العصر', time: '16:30', type: 'prayer' as const },
  { name: 'Sunset', nameArabic: 'غروب', time: '20:00', type: 'event' as const },
  { name: 'Maghrib', nameArabic: 'المغرب', time: '20:15', type: 'prayer' as const },
  { name: 'Isha', nameArabic: 'العشاء', time: '21:45', type: 'prayer' as const },
  { name: 'Midnight', nameArabic: 'نصف الليل', time: '00:15', type: 'event' as const },
];

function makeTracking(records: Record<string, PrayerTrackingRecord>) {
  return {
    schemaVersion: 1,
    trackingStartedAt: '2026-08-27T00:00:00.000Z',
    records,
    reminderReceipts: {},
  };
}

function installPrayerMock() {
  const records = {
    [`${TODAY}::Fajr`]: { date: TODAY, prayerName: 'Fajr', status: 'on_time', recordedAt: '2026-08-28T05:10:00.000Z' },
    [`${TODAY}::Dhuhr`]: { date: TODAY, prayerName: 'Dhuhr', status: 'late', recordedAt: '2026-08-28T18:00:00.000Z' },
    [`${TODAY}::Asr`]: { date: TODAY, prayerName: 'Asr', status: 'missed', recordedAt: '2026-08-28T20:00:00.000Z' },
    [`${TODAY}::Maghrib`]: { date: TODAY, prayerName: 'Maghrib', status: 'unclassified', recordedAt: '2026-08-28T20:30:00.000Z' },
  } satisfies Record<string, PrayerTrackingRecord>;
  const tracking = makeTracking(records);
  contextMocks.prayer = {
    schedule: {
      prayers: PRAYERS,
      date: TODAY,
      hijriDate: '12 Safar 1448',
      city: 'Bedford',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      method: 'Shia Ithna-Ashari, Leva Institute, Qum',
      fetchedAt: '2026-08-28T04:00:00.000Z',
      source: 'cache',
    },
    scheduleStatus: 'ready',
    scheduleError: null,
    desktopTimezone: 'Europe/London',
    timezoneMatches: true,
    now: new Date(2026, 7, 28, 20, 30, 0),
    today: TODAY,
    tracking,
    scheduleDays: [],
    nextPrayer: { prayer: PRAYERS[6], minutesUntil: 75 },
    getOutcome: (_date: string, name: PrayerName) => records[`${TODAY}::${name}`],
    requestPrayerCompletion: vi.fn(),
    retrySchedule: vi.fn().mockResolvedValue(undefined),
  };
}

function installMomentumMock(state: DailyMomentumState, error: string | null = null) {
  contextMocks.momentum = {
    state,
    loaded: true,
    saving: false,
    error,
    getDay: () => getDailyMomentumDay(state, TODAY),
    selectPath: vi.fn().mockResolvedValue(state),
    recordProgress: vi.fn().mockResolvedValue(state),
    resetProgress: vi.fn().mockResolvedValue(state),
  };
}

describe('NightCompassDashboard focused component contract', () => {
  beforeEach(() => {
    contextMocks.app = {
      settings: { prayerEnabled: true, prayerCity: 'Bedford' },
      tasks: [{
        id: 'task-long',
        title: LONG_TASK,
        description: '',
        completed: false,
        priority: 'high',
        category: 'task',
        dueDate: TODAY,
        createdAt: '2026-08-28T08:00:00.000Z',
        updatedAt: '2026-08-28T08:00:00.000Z',
      }],
      navigate: vi.fn(),
      requestAssistantNavigation: vi.fn(),
    };
    installPrayerMock();
    installMomentumMock(createDefaultDailyMomentumState());
  });

  it('renders canonical outcomes, the active prayer window, and one compact long task', () => {
    render(<NightCompassDashboard />);

    const sequence = screen.getByLabelText('Five daily prayers');
    expect(screen.getByRole('region', { name: 'Night Compass daily dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(sequence).toHaveTextContent('On time');
    expect(sequence).toHaveTextContent('Late');
    expect(sequence).toHaveTextContent('Missed');
    expect(sequence).toHaveTextContent('Legacy — classify');
    expect(sequence).toHaveTextContent('Next');
    expect(screen.getByText('Current prayer')).toBeInTheDocument();
    expect(screen.getByText(/Current · .* left/)).toBeInTheDocument();
    const classify = screen.getByRole('button', { name: 'Classify Maghrib Prayer — Legacy record' });
    expect(classify).toBeEnabled();
    fireEvent.click(classify);
    expect(contextMocks.prayer.requestPrayerCompletion).toHaveBeenCalledWith('Maghrib', { source: 'dashboard' });
    expect(screen.getAllByText(LONG_TASK)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Tasks' }).closest('.nc-tasks-card')).toHaveTextContent('1 due or overdue');
  });

  it("marks tomorrow's Fajr as Next without reusing today's completed outcome", () => {
    contextMocks.prayer = {
      ...contextMocks.prayer,
      now: new Date(2026, 7, 28, 22, 0, 0),
      nextPrayer: { prayer: PRAYERS[0], minutesUntil: 420 },
    };
    render(<NightCompassDashboard />);

    const fajr = screen.getByRole('button', { name: 'Fajr Prayer — Next tomorrow' });
    expect(fajr).toBeDisabled();
    expect(fajr).toHaveTextContent('Next');
    expect(fajr).not.toHaveTextContent('On time');
    expect(screen.getByRole('button', { name: 'Complete Isha Prayer' })).toHaveTextContent('Current');
  });

  it('exposes Level 1 plus optional Levels 2-5, suppresses rapid input, and confirms reset', async () => {
    const selectedState = selectDailyMomentumPath(createDefaultDailyMomentumState(), {
      date: TODAY,
      pillar: 'learn',
      templateId: 'learn-reading',
    });
    installMomentumMock(selectedState);
    render(<NightCompassDashboard />);

    const learnCard = screen.getByRole('heading', { name: 'Learn' }).closest('.nc-momentum-card')!;
    expect(within(learnCard).getByText('L1')).toBeInTheDocument();
    expect(within(learnCard).getAllByText('optional')).toHaveLength(4);

    const recordProgress = contextMocks.momentum.recordProgress as ReturnType<typeof vi.fn>;
    const addPage = within(learnCard).getByRole('button', { name: 'Add 1 pages' });
    fireEvent.click(addPage);
    fireEvent.click(addPage);
    await waitFor(() => expect(recordProgress).toHaveBeenCalledTimes(1));

    fireEvent.click(within(learnCard).getByRole('button', { name: "Reset today's progress" }));
    expect(within(learnCard).getByText("Reset today's learn progress?")).toBeInTheDocument();
    fireEvent.click(within(learnCard).getByRole('button', { name: 'Confirm reset' }));
    await waitFor(() => expect(contextMocks.momentum.resetProgress).toHaveBeenCalledWith('learn', true));
  });

  it('keeps Prayer visible while malformed momentum data is surfaced locally', () => {
    installMomentumMock(createDefaultDailyMomentumState(), 'Daily momentum templates must be an array.');
    render(<NightCompassDashboard />);

    expect(screen.getByRole('heading', { name: 'Prayer' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Daily momentum templates must be an array.');
  });
});

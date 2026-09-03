import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';
import {
  createDefaultDailyMomentumState,
  getDailyMomentumDay,
  recordDailyMomentumProgress,
} from '../services/dailyMomentum';

const mocks = vi.hoisted(() => ({
  shell: {
    navigate: vi.fn(),
    requestAssistantNavigation: vi.fn(),
  },
  settings: {
    settings: { prayerEnabled: false, prayerCity: 'Bedford', lifeHeroEnabled: false },
    appTimeZone: { effectiveTimeZone: 'UTC' },
  },
  tasks: { tasks: [] },
  prayer: {
    tracking: { records: {} },
    schedule: null,
    scheduleStatus: 'unavailable',
    scheduleError: null,
    now: new Date('2026-08-29T12:00:00.000Z'),
    today: '2026-08-29',
    localTimezone: 'UTC',
    scheduleTimezoneValid: false,
    scheduleDays: [],
    getOutcome: vi.fn(),
    requestPrayerCompletion: vi.fn(),
    retrySchedule: vi.fn().mockResolvedValue(undefined),
  },
  momentum: {
    getDay: vi.fn(),
    loaded: true,
    error: null,
    recordProgress: vi.fn(),
    resetProgress: vi.fn(),
  },
  celebration: { celebrate: vi.fn() },
}));

vi.mock('../store/ShellContext', () => ({ useShell: () => mocks.shell }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => mocks.settings }));
vi.mock('../store/contexts/TaskContext', () => ({ useTaskContext: () => mocks.tasks }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => mocks.prayer }));
vi.mock('../store/contexts/DailyMomentumContext', () => ({
  useDailyMomentumContext: () => mocks.momentum,
}));
vi.mock('../store/contexts/MilestoneCelebrationContext', () => ({
  useMilestoneCelebration: () => mocks.celebration,
}));
vi.mock('../components/dashboard/PrayerStatsCard', () => ({ default: () => null }));
vi.mock('../components/dashboard/LifeHeroCompanion', () => ({
  default: () => <aside aria-label="Life Hero companion" />,
}));

describe('Night Compass activity title help', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.settings.lifeHeroEnabled = false;
    mocks.momentum.getDay.mockReturnValue(
      getDailyMomentumDay(createDefaultDailyMomentumState(), '2026-08-29'),
    );
  });

  it('does not mount the character companion by default', () => {
    render(<NightCompassDashboard />);

    expect(screen.queryByLabelText('Life Hero companion')).not.toBeInTheDocument();
  });

  it('mounts the character companion only after explicit opt-in', () => {
    mocks.settings.settings.lifeHeroEnabled = true;
    render(<NightCompassDashboard />);

    expect(screen.getByLabelText('Life Hero companion')).toBeInTheDocument();
  });

  it('gives every Learn and Move activity title pointer and keyboard help', () => {
    render(<NightCompassDashboard />);

    const activities = [
      ['Reading', 'learn', 'learn-reading', 'Read pages from a book, article, or other focused material.'],
      ['Course', 'learn', 'learn-course', 'Spend minutes on a structured course or lesson.'],
      ['Walk', 'move', 'move-walk', 'Try an outdoor walk, a treadmill walk, or a few purposeful indoor laps.'],
      ['Workout', 'move', 'move-workout', 'Try squats, wall push-ups, cycling, a gym session, or another planned workout.'],
      ['Stretching', 'move', 'move-stretching', 'Try gentle calf, hamstring, chest, or shoulder stretches.'],
    ] as const;

    for (const [label, pillar, templateId, helpText] of activities) {
      expect(screen.getByRole('heading', { name: label, level: 3 })).toBeInTheDocument();
      const trigger = screen.getByRole('button', { name: `About ${label}` });
      const tooltipId = `nc-${pillar}-${templateId}-help`;
      expect(trigger).not.toHaveTextContent('?');
      expect(trigger.querySelector('[data-icon="eye"]')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-controls', tooltipId);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger.closest('.nc-progress-controls')).toBeNull();

      act(() => {
        fireEvent.mouseEnter(trigger);
      });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-describedby', tooltipId);
      expect(screen.getByRole('tooltip')).toHaveTextContent(helpText);
      act(() => {
        fireEvent.mouseLeave(trigger);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      act(() => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);
      expect(screen.getByRole('tooltip')).toHaveTextContent(helpText);
      act(() => {
        fireEvent.blur(trigger);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    }
  });

  it('celebrates a real activity level transition', async () => {
    const date = '2026-08-29';
    const onePage = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date,
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 1,
      updatedAt: '2026-08-29T12:00:00.000Z',
    });
    const levelOne = recordDailyMomentumProgress(onePage, {
      date,
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 1,
      updatedAt: '2026-08-29T12:01:00.000Z',
    });
    mocks.momentum.getDay.mockReturnValue(getDailyMomentumDay(onePage, date));
    mocks.momentum.recordProgress.mockResolvedValue(levelOne);

    render(<NightCompassDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 pages' }));

    await waitFor(() => {
      expect(mocks.celebration.celebrate).toHaveBeenCalledWith({
        tone: 'learn',
        eyebrow: 'Learn milestone',
        title: 'Reading · Level 1',
        message: "Today's target is complete.",
        level: 1,
      });
    });
  });

  it('uses the stronger beyond-target receipt when Reading reaches Level 2', async () => {
    const date = '2026-08-29';
    let fourPages = createDefaultDailyMomentumState();
    for (let page = 1; page <= 4; page += 1) {
      fourPages = recordDailyMomentumProgress(fourPages, {
        date,
        pillar: 'learn',
        templateId: 'learn-reading',
        stepId: 'pages',
        amount: 1,
        updatedAt: `2026-08-29T12:0${page}:00.000Z`,
      });
    }
    const levelTwo = recordDailyMomentumProgress(fourPages, {
      date,
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 1,
      updatedAt: '2026-08-29T12:05:00.000Z',
    });
    mocks.momentum.getDay.mockReturnValue(getDailyMomentumDay(fourPages, date));
    mocks.momentum.recordProgress.mockResolvedValue(levelTwo);

    render(<NightCompassDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 pages' }));

    await waitFor(() => {
      expect(mocks.celebration.celebrate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Reading · Level 2',
        message: "You went beyond today's target.",
        level: 2,
      }));
    });
  });

  it('keeps a progress click quiet when no level is reached', async () => {
    const date = '2026-08-29';
    const nextState = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date,
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 1,
      updatedAt: '2026-08-29T12:00:00.000Z',
    });
    mocks.momentum.recordProgress.mockResolvedValue(nextState);

    render(<NightCompassDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 pages' }));

    await waitFor(() => expect(mocks.momentum.recordProgress).toHaveBeenCalledOnce());
    expect(mocks.celebration.celebrate).not.toHaveBeenCalled();
  });
});

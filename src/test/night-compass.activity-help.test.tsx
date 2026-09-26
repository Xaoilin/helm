import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('Night Compass activities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.momentum.loaded = true;
    mocks.settings.settings.lifeHeroEnabled = false;
    mocks.momentum.getDay.mockReturnValue(
      getDailyMomentumDay(createDefaultDailyMomentumState(), '2026-08-29'),
    );
  });

  it('does not mount the character companion by default', () => {
    render(<NightCompassDashboard />);

    expect(screen.queryByLabelText('Life Hero companion')).not.toBeInTheDocument();
  });

  it('does not mount the deprecated Life Hero companion even when the stored setting opts in', () => {
    // Life Hero is disabled by build flag (docs/deprecated-features.md); the old setting cannot revive it.
    mocks.settings.settings.lifeHeroEnabled = true;
    render(<NightCompassDashboard />);

    expect(screen.queryByLabelText('Life Hero companion')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 page' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 page' }));

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
    fireEvent.click(within(screen.getByRole('region', { name: 'Learn', exact: true }))
      .getByRole('switch', { name: 'Add individual steps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 page' }));

    await waitFor(() => expect(mocks.momentum.recordProgress).toHaveBeenCalledOnce());
    expect(mocks.celebration.celebrate).not.toHaveBeenCalled();
  });

  it('completes the remaining goal in one write and keeps section modes independent', async () => {
    const date = '2026-08-29';
    const partial = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date, pillar: 'learn', templateId: 'learn-course', stepId: 'course-minutes', amount: 2,
    });
    mocks.momentum.getDay.mockReturnValue(getDailyMomentumDay(partial, date));
    mocks.momentum.recordProgress.mockResolvedValue(recordDailyMomentumProgress(partial, {
      date, pillar: 'learn', templateId: 'learn-course', stepId: 'course-minutes', amount: 3,
    }));
    render(<NightCompassDashboard />);
    const learn = within(screen.getByRole('region', { name: 'Learn', exact: true }));
    const move = within(screen.getByRole('region', { name: 'Move', exact: true }));
    const learnMode = learn.getByRole('switch', { name: 'Add individual steps' });
    const moveMode = move.getByRole('switch', { name: 'Add individual steps' });
    expect(learnMode).not.toBeChecked();
    expect(moveMode).not.toBeChecked();
    expect(learn.getByRole('button', { name: 'Add 2 pages' })).toBeEnabled();
    expect(learn.getByRole('button', { name: 'Add 3 minutes' })).toBeEnabled();
    expect(move.getAllByRole('button', { name: 'Add 5 minutes' })).toHaveLength(3);

    fireEvent.click(learnMode);
    expect(learnMode).toBeChecked();
    expect(learn.getByRole('button', { name: 'Add 1 page' })).toBeEnabled();
    expect(learn.getByRole('button', { name: 'Add 1 minute' })).toBeEnabled();
    expect(moveMode).not.toBeChecked();
    expect(move.getAllByRole('button', { name: 'Add 5 minutes' })).toHaveLength(3);
    fireEvent.click(moveMode);
    expect(move.getAllByRole('button', { name: 'Add 1 minute' })).toHaveLength(3);
    expect(mocks.momentum.recordProgress).not.toHaveBeenCalled();

    fireEvent.click(learnMode);
    fireEvent.click(learn.getByRole('button', { name: 'Add 3 minutes' }));
    await waitFor(() => expect(mocks.momentum.recordProgress)
      .toHaveBeenCalledWith('learn', 'learn-course', 'course-minutes', 3));
    expect(mocks.momentum.recordProgress).toHaveBeenCalledOnce();
    expect(mocks.celebration.celebrate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Course · Level 1',
    }));
  });

  it('adds only the gap to the next optional level', async () => {
    const date = '2026-08-29';
    const levelOne = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date, pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 2,
    });
    mocks.momentum.getDay.mockReturnValue(getDailyMomentumDay(levelOne, date));
    mocks.momentum.recordProgress.mockResolvedValue(recordDailyMomentumProgress(levelOne, {
      date, pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 3,
    }));
    render(<NightCompassDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 pages' }));
    await waitFor(() => expect(mocks.momentum.recordProgress)
      .toHaveBeenCalledWith('learn', 'learn-reading', 'pages', 3));
    expect(mocks.celebration.celebrate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Reading · Level 2',
    }));
  });

  it('blocks duplicate writes while saving and recovers after an error', async () => {
    let rejectWrite!: (reason: Error) => void;
    mocks.momentum.recordProgress.mockReturnValue(new Promise((_, reject) => { rejectWrite = reject; }));
    render(<NightCompassDashboard />);
    const add = screen.getByRole('button', { name: 'Add 2 pages' });
    fireEvent.click(add);
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(mocks.momentum.recordProgress).toHaveBeenCalledOnce();
    await act(async () => rejectWrite(new Error('Progress could not be saved.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Progress could not be saved.');
    expect(add).toBeEnabled();
    expect(mocks.celebration.celebrate).not.toHaveBeenCalled();
  });

  it('keeps fully reached goals and unloaded progress disabled', () => {
    const date = '2026-08-29';
    const complete = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date, pillar: 'learn', templateId: 'learn-reading', stepId: 'pages', amount: 40,
    });
    mocks.momentum.getDay.mockReturnValue(getDailyMomentumDay(complete, date));
    mocks.momentum.loaded = false;
    render(<NightCompassDashboard />);
    expect(screen.getByRole('button', { name: 'Reached' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Add 5 minutes' }).every(button => button.hasAttribute('disabled'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reached' }));
    expect(mocks.momentum.recordProgress).not.toHaveBeenCalled();
  });
});

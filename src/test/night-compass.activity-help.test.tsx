import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';
import {
  createDefaultDailyMomentumState,
  getDailyMomentumDay,
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
}));

vi.mock('../store/ShellContext', () => ({ useShell: () => mocks.shell }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => mocks.settings }));
vi.mock('../store/contexts/TaskContext', () => ({ useTaskContext: () => mocks.tasks }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => mocks.prayer }));
vi.mock('../store/contexts/DailyMomentumContext', () => ({
  useDailyMomentumContext: () => mocks.momentum,
}));
vi.mock('../components/dashboard/PrayerStatsCard', () => ({ default: () => null }));
vi.mock('../components/dashboard/LifeHeroCompanion', () => ({
  default: () => <aside aria-label="Life Hero companion" />,
}));

describe('Night Compass activity title help', () => {
  beforeEach(() => {
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
});

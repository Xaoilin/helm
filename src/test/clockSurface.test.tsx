import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClockSurface from '../surfaces/ClockSurface';
import { AppProvider } from '../store/AppContext';
import { playTimerAlarm, primeTimerAlarmAudio } from '../services/clockAudio';

vi.mock('../services/clockAudio', () => ({
  TIMER_SOUND_OPTIONS: [
    { id: 'chime', label: 'Chime', description: 'Bright two-note chime.' },
    { id: 'bell', label: 'Bell', description: 'Warm bell-style strikes.' },
    { id: 'pulse', label: 'Pulse', description: 'Focused repeating pulses.' },
    { id: 'dawn', label: 'Dawn', description: 'Gentle rising melody.' },
  ],
  playTimerAlarm: vi.fn().mockResolvedValue(true),
  primeTimerAlarmAudio: vi.fn().mockResolvedValue(undefined),
  stopTimerAlarm: vi.fn(),
}));

function renderClockSurface() {
  return render(
    <AppProvider>
      <ClockSurface />
    </AppProvider>,
  );
}

describe('ClockSurface interactions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs, pauses, and resets the stopwatch', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start Stopwatch' }));

    await act(async () => {
      vi.advanceTimersByTime(6500);
    });

    expect(screen.getByLabelText('Stopwatch elapsed')).toHaveTextContent('00:06.50');

    fireEvent.click(screen.getByRole('button', { name: 'Pause Stopwatch' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Stopwatch' }));
    expect(screen.getByLabelText('Stopwatch elapsed')).toHaveTextContent('00:00.00');
  });

  it('restores an in-progress timer from persisted state', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: '1 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }));

    firstRender.unmount();

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByLabelText('Timer remaining')).toHaveTextContent('00:30');
  });

  it('marks the timer as finished when the countdown reaches zero', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: '1 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }));

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.getByText((content, node) => node?.textContent === 'Finished')).toBeInTheDocument();
    expect(screen.getByLabelText('Timer remaining')).toHaveTextContent('00:00');
  });

  it('persists the selected timer alarm sound across remounts', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Alarm sound'), {
      target: { value: 'bell' },
    });

    expect(screen.getByLabelText('Alarm sound')).toHaveValue('bell');

    firstRender.unmount();

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByLabelText('Alarm sound')).toHaveValue('bell');
    expect(screen.getByText('Warm bell-style strikes.')).toBeInTheDocument();
  });

  it('plays the selected timer alarm sound when the countdown completes', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Alarm sound'), {
      target: { value: 'pulse' },
    });
    fireEvent.click(screen.getByRole('button', { name: '1 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }));

    expect(primeTimerAlarmAudio).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(playTimerAlarm).toHaveBeenCalledWith('pulse');
  });
});

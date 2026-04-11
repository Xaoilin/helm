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

  it('runs, pauses, and resets the first stopwatch', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start Stopwatch 1' }));

    await act(async () => {
      vi.advanceTimersByTime(6500);
    });

    expect(screen.getByLabelText('Elapsed for Stopwatch 1')).toHaveTextContent('00:06.50');

    fireEvent.click(screen.getByRole('button', { name: 'Pause Stopwatch 1' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Stopwatch 1' }));
    expect(screen.getByLabelText('Elapsed for Stopwatch 1')).toHaveTextContent('00:00.00');
  });

  it('creates additional timers and stopwatches that persist across remounts', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Timer' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Stopwatch' }));

    expect(screen.getByRole('heading', { name: 'Timer 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatch 2' })).toBeInTheDocument();

    firstRender.unmount();

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByRole('heading', { name: 'Timer 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatch 2' })).toBeInTheDocument();
  });

  it('restores an in-progress timer from persisted state', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Set Timer 1 to 1 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer 1' }));

    firstRender.unmount();

    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByLabelText('Remaining for Timer 1')).toHaveTextContent('00:30');
  });

  it('marks the timer as finished when the countdown reaches zero', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Set Timer 1 to 1 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer 1' }));

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.getByText((content, node) => node?.textContent === 'Finished')).toBeInTheDocument();
    expect(screen.getByLabelText('Remaining for Timer 1')).toHaveTextContent('00:00');
  });

  it('persists the selected timer alarm sound across remounts', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Alarm sound for Timer 1'), {
      target: { value: 'bell' },
    });

    expect(screen.getByLabelText('Alarm sound for Timer 1')).toHaveValue('bell');

    firstRender.unmount();

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByLabelText('Alarm sound for Timer 1')).toHaveValue('bell');
    expect(screen.getByText('Warm bell-style strikes.')).toBeInTheDocument();
  });

  it('plays the selected timer alarm sound when the countdown completes', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Alarm sound for Timer 1'), {
      target: { value: 'pulse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set Timer 1 to 1 minutes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer 1' }));

    expect(primeTimerAlarmAudio).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(playTimerAlarm).toHaveBeenCalledWith('pulse');
  });
});

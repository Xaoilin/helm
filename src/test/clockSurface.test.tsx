import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClockSurface from '../surfaces/ClockSurface';
import { AppProvider } from '../store/AppContext';
import { playTimerAlarm, primeTimerAlarmAudio, stopTimerAlarm } from '../services/clockAudio';

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

  it('shows split times between recorded stopwatch laps', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start Stopwatch 1' }));

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add lap to Stopwatch 1' }));

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add lap to Stopwatch 1' }));

    const latestLapRow = screen.getByText('Lap 2').closest('.clock-lap-row');
    const firstLapRow = screen.getByText('Lap 1').closest('.clock-lap-row');

    expect(latestLapRow).toHaveTextContent('00:06.00');
    expect(latestLapRow).toHaveTextContent('Split 00:03.50');
    expect(firstLapRow).toHaveTextContent('00:02.50');
    expect(firstLapRow).toHaveTextContent('Split 00:02.50');
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

  it('persists custom timer and stopwatch names across remounts', async () => {
    let firstRender!: ReturnType<typeof renderClockSurface>;

    await act(async () => {
      firstRender = renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Name for Timer 1'), {
      target: { value: 'Tea break' },
    });
    fireEvent.blur(screen.getByDisplayValue('Tea break'));

    fireEvent.change(screen.getByLabelText('Name for Stopwatch 1'), {
      target: { value: 'Study sprint' },
    });
    fireEvent.blur(screen.getByDisplayValue('Study sprint'));

    expect(screen.getByRole('heading', { name: 'Tea break' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Study sprint' })).toBeInTheDocument();

    firstRender.unmount();

    await act(async () => {
      renderClockSurface();
    });

    expect(screen.getByRole('heading', { name: 'Tea break' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Study sprint' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tea break')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Study sprint')).toBeInTheDocument();
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

  it('keeps a completed timer alerting until it is acknowledged', async () => {
    await act(async () => {
      renderClockSurface();
    });

    fireEvent.change(screen.getByLabelText('Minutes for Timer 1'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Seconds for Timer 1'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set duration for Timer 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer 1' }));

    vi.mocked(stopTimerAlarm).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText((content, node) => node?.textContent === 'Alerting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge Timer 1' })).toBeInTheDocument();
    expect(screen.getByText('Timer 1 is finished.')).toBeInTheDocument();
    expect(screen.getByLabelText('Remaining for Timer 1')).toHaveTextContent('00:00');

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Timer 1' }));

    expect(stopTimerAlarm).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Acknowledge Timer 1' })).not.toBeInTheDocument();
    expect(screen.getByText((content, node) => node?.textContent === 'Finished')).toBeInTheDocument();
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

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import ClockSurface from '../surfaces/ClockSurface';

describe('ClockSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render the multi-clock workspace controls', async () => {
    await act(async () => { renderWithProvider(<ClockSurface />); });
    expect(screen.getByText('Multi-clock workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatches' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timer 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stopwatch 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name for Timer 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Name for Stopwatch 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Timer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Stopwatch' })).toBeInTheDocument();
    expect(screen.getByLabelText('Alarm sound for Timer 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview sound for Timer 1' })).toBeInTheDocument();
  });
});

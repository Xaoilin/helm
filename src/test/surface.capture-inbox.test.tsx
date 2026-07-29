import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import CaptureInboxSurface from '../surfaces/CaptureInboxSurface';

describe('CaptureInboxSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders the empty inbox state', async () => {
    await act(async () => { renderWithProvider(<CaptureInboxSurface />); });
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText('No captures here')).toBeInTheDocument();
  });

  it('captures and classifies inbox items', async () => {
    await act(async () => { renderWithProvider(<CaptureInboxSurface />); });

    fireEvent.change(screen.getByLabelText('New capture'), {
      target: { value: 'Research Lisbon day trips before booking flights.' },
    });
    fireEvent.change(screen.getByLabelText('New capture classification'), {
      target: { value: 'trip_item' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    });

    expect(screen.getByText('Research Lisbon day trips before booking flights.')).toBeInTheDocument();
    await waitFor(() => {
      const captures = JSON.parse(localStorage.getItem('helm:captureItems') || '[]');
      expect(captures[0]).toMatchObject({
        content: 'Research Lisbon day trips before booking flights.',
        classification: 'trip_item',
        status: 'classified',
        source: 'manual',
      });
    });

    fireEvent.change(screen.getByLabelText(/Classify Research Lisbon day trips/i), {
      target: { value: 'task' },
    });

    await waitFor(() => {
      const captures = JSON.parse(localStorage.getItem('helm:captureItems') || '[]');
      expect(captures[0]).toMatchObject({
        classification: 'task',
        status: 'classified',
      });
    });
  });
});

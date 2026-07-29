import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import HealthSurface from '../surfaces/HealthSurface';

describe('HealthSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('renders the quick-entry health log', async () => {
    await act(async () => { renderWithProvider(<HealthSurface />); });
    expect(screen.getByText('Fast food journal')).toBeInTheDocument();
    expect(screen.getByText('Save fast food log')).toBeInTheDocument();
  });

  it('creates a fast food log entry from the quick-entry form', async () => {
    await act(async () => { renderWithProvider(<HealthSurface />); });

    fireEvent.change(screen.getByPlaceholderText("McDonald's, KFC, Burger King..."), {
      target: { value: 'McDonald\'s' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bad' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nauseous' }));
    fireEvent.change(
      screen.getByPlaceholderText('Example: nauseous for the entire day, felt heavy, not worth the convenience.'),
      { target: { value: 'Nauseous for the entire day. Bad experience.' } },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save fast food log' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'McDonald\'s' })).toBeInTheDocument();
    });
    const entryCard = screen.getByRole('heading', { name: 'McDonald\'s' }).closest('.health-entry-card');
    expect(entryCard).not.toBeNull();
    expect(within(entryCard as HTMLElement).getByText('Nauseous for the entire day. Bad experience.')).toBeInTheDocument();
    expect(screen.getAllByText('Nauseous').length).toBeGreaterThan(0);
  });
});

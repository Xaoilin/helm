import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  flushPrayerFeatureUpdates,
  installPrayerFeatureHarness,
  renderPrayerFeatureApp,
} from './prayerFeatureHarness';

installPrayerFeatureHarness();

describe('prayer completion selectors', () => {
  it('uses the shared On time / Late selector while ordinary habits stay unchanged', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    renderPrayerFeatureApp();
    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    const prayerDialog = await screen.findByRole('dialog', { name: 'How was Fajr prayed?' });
    expect(prayerDialog).toHaveTextContent('On time');
    expect(prayerDialog).toHaveTextContent('Late');
    expect(prayerDialog).toHaveTextContent('Cancel');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'How was Fajr prayed?' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    fireEvent.click(await screen.findByRole('button', { name: /On time/ }));
    await flushPrayerFeatureUpdates();
    expect(screen.getByRole('button', {
      name: 'Fajr Prayer \u2014 completed, On time',
    })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Complete Drink water' }));
    expect(screen.getByText('Did you complete this?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Drink water/ })).not.toBeInTheDocument();
  });

  it('opens the shared selector from the Dashboard prayer habit card', async () => {
    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Good morning' });
    expect(screen.getByText('🙏 Prayer outcomes · Current month')).toBeInTheDocument();
    expect(screen.getByText(/Current month · Classified opportunities only/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });
});

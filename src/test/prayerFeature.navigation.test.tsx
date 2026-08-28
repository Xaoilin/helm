import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  installPrayerFeatureHarness,
  renderPrayerFeatureApp,
} from './prayerFeatureHarness';

installPrayerFeatureHarness();

describe('prayer completion navigation', () => {
  it('pauses deadline inference and clock suggestions on a timezone mismatch', async () => {
    localStorage.setItem('helm:prayer-times-cache', JSON.stringify({
      prayers: [
        { name: 'Fajr', nameArabic: 'Fajr', time: '05:00', type: 'prayer' },
        { name: 'Sunrise', nameArabic: 'Sunrise', time: '06:50', type: 'event' },
        { name: 'Dhuhr', nameArabic: 'Dhuhr', time: '13:00', type: 'prayer' },
        { name: 'Asr', nameArabic: 'Asr', time: '16:30', type: 'prayer' },
        { name: 'Sunset', nameArabic: 'Sunset', time: '20:00', type: 'event' },
        { name: 'Maghrib', nameArabic: 'Maghrib', time: '20:15', type: 'prayer' },
        { name: 'Isha', nameArabic: 'Isha', time: '21:45', type: 'prayer' },
        { name: 'Midnight', nameArabic: 'Midnight', time: '00:15', type: 'event' },
      ],
      date: '2026-07-28',
      hijriDate: '12 Safar 1448',
      city: 'Bedford',
      country: 'United Kingdom',
      timezone: 'America/New_York',
      method: 'Shia Ithna-Ashari, Leva Institute, Qum',
      fetchedAt: new Date().toISOString(),
      source: 'network',
    }));

    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Schedule timezone does not match this browser',
    );

    const fajrRow = screen.getByText('Fajr', { selector: '.nc-prayer-name' }).closest('.nc-prayer-item');
    expect(fajrRow).toHaveTextContent('Schedule pending');
    expect(fajrRow).not.toHaveTextContent('Before tracking');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Fajr Prayer' }));
    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
    expect(screen.queryByText('Likely from the clock')).not.toBeInTheDocument();
  });

  it('opens the shared selector from the prayer-first Dashboard', async () => {
    const tasks = JSON.parse(localStorage.getItem('helm:tasks') || '[]') as Array<{ category?: string }>;
    localStorage.setItem('helm:tasks', JSON.stringify(tasks.filter(task => task.category === 'prayer')));

    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Night Compass' });

    fireEvent.click(await screen.findByRole('button', { name: 'Complete Fajr Prayer' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });

  it('contains modal keyboard focus and returns it to the completion trigger', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Tasks' });

    const trigger = screen.getByRole('button', { name: 'Complete Fajr Prayer' });
    trigger.focus();
    fireEvent.click(trigger);

    const onTime = await screen.findByRole('button', { name: /On time/ });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(onTime).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(onTime).toHaveFocus();

    onTime.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'How was Fajr prayed?' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens the same selector from the All Tasks checkbox', async () => {
    sessionStorage.setItem('helm:shell-surface', 'tasks');
    renderPrayerFeatureApp();
    await screen.findByRole('heading', { name: 'Tasks' });

    fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark "Fajr Prayer" as complete' }));

    expect(await screen.findByRole('dialog', { name: 'How was Fajr prayed?' })).toBeInTheDocument();
  });
});

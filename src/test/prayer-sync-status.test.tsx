import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const prayer = vi.hoisted(() => ({ serviceSync: { status: 'disabled', error: null } as { status: string; error: string | null } }));
vi.mock('../store/contexts/PrayerContext', () => ({ usePrayerContext: () => prayer }));

import PrayerSyncStatus from '../components/dashboard/PrayerSyncStatus';

afterEach(() => { prayer.serviceSync = { status: 'disabled', error: null }; });

it('keeps a synced state off screen but available to assistive tech', () => {
  prayer.serviceSync = { status: 'synced', error: null };

  render(<PrayerSyncStatus />);

  const status = screen.getByRole('status', { name: 'Prayer data sync' });
  expect(status).toHaveTextContent('Prayer data: Synced');
  expect(status).toHaveClass('sr-only');
});

it('shows a sync failure on screen', () => {
  prayer.serviceSync = { status: 'error', error: 'The service could not be reached.' };

  render(<PrayerSyncStatus />);

  const status = screen.getByRole('status', { name: 'Prayer data sync' });
  expect(status).toHaveTextContent(
    'Prayer data: Not synced (The service could not be reached.). Retrying automatically; changes are kept on this device.');
  expect(status).not.toHaveClass('sr-only');
});

it('renders nothing when the prayer service is not configured', () => {
  const { container } = render(<PrayerSyncStatus />);

  expect(container).toBeEmptyDOMElement();
});

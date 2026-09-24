import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { checkPrayerBackendHealth, checkPrayerDatabaseHealth } = vi.hoisted(() => ({
  checkPrayerBackendHealth: vi.fn(),
  checkPrayerDatabaseHealth: vi.fn(),
}));
vi.mock('../services/prayerApi', () => ({ checkPrayerBackendHealth, checkPrayerDatabaseHealth }));

import PrayerBackendStatus from '../components/dashboard/PrayerBackendStatus';

afterEach(() => vi.resetAllMocks());

it('shows the Spring service connection result on the Prayer page', async () => {
  checkPrayerBackendHealth.mockResolvedValue({ status: 'connected' });
  checkPrayerDatabaseHealth.mockResolvedValue({ status: 'connected' });

  render(<PrayerBackendStatus />);

  expect(screen.getByRole('status', { name: 'Spring Boot prayer backend' })).toHaveTextContent('Checking…');
  expect(await screen.findByText('Spring Boot prayer backend: Connected')).toBeInTheDocument();
  expect(await screen.findByText('Spring Boot prayer database: Connected')).toBeInTheDocument();
  expect(checkPrayerBackendHealth).toHaveBeenCalledOnce();
  expect(checkPrayerDatabaseHealth).toHaveBeenCalledOnce();
});

it('makes an unconfigured service explicit without changing the existing Prayer path', async () => {
  checkPrayerBackendHealth.mockResolvedValue({ status: 'not_configured' });
  checkPrayerDatabaseHealth.mockResolvedValue({ status: 'not_configured' });

  render(<PrayerBackendStatus />);

  const status = await screen.findByRole('status', { name: 'Spring Boot prayer backend' });
  expect(status).toHaveTextContent('Not configured');
  expect(status).toHaveTextContent('Prayer features still use the current app path.');
  expect(await screen.findByRole('status', { name: 'Spring Boot prayer database' })).toHaveTextContent('Not configured');
});

it('shows why the health request failed and clarifies the current prayer fallback', async () => {
  checkPrayerBackendHealth.mockResolvedValue({ status: 'unavailable', detail: 'HTTP 503.' });
  checkPrayerDatabaseHealth.mockResolvedValue({ status: 'unavailable', detail: 'HTTP 503.' });

  render(<PrayerBackendStatus />);

  expect(await screen.findByText(/Spring Boot prayer backend: Unavailable \(HTTP 503\.\)/)).toHaveTextContent('Prayer features still use the current app path.');
  expect(await screen.findByText('Spring Boot prayer database: Unavailable (HTTP 503.)')).toBeInTheDocument();
});

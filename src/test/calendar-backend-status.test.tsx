import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { checkCalendarBackendHealth, checkCalendarDatabaseHealth } = vi.hoisted(() => ({
  checkCalendarBackendHealth: vi.fn(),
  checkCalendarDatabaseHealth: vi.fn(),
}));

vi.mock('../services/calendarApi', () => ({ checkCalendarBackendHealth, checkCalendarDatabaseHealth }));

import CalendarBackendStatus from '../components/dashboard/CalendarBackendStatus';

afterEach(() => {
  cleanup();
});

it('shows backend and database results from the Calendar service', async () => {
  checkCalendarBackendHealth.mockResolvedValue({ status: 'connected' });
  checkCalendarDatabaseHealth.mockResolvedValue({ status: 'connected' });

  render(<CalendarBackendStatus />);

  await waitFor(() => expect(screen.getByLabelText('Spring Boot calendar backend')).toHaveTextContent('Connected'));
  expect(screen.getByLabelText('Spring Boot calendar database')).toHaveTextContent('Connected');
  expect(checkCalendarBackendHealth).toHaveBeenCalledOnce();
  expect(checkCalendarDatabaseHealth).toHaveBeenCalledOnce();
});
it('shows unavailable status when the service probes fail', async () => {
  checkCalendarBackendHealth.mockResolvedValue({ status: 'unavailable', detail: 'HTTP 503.' });
  checkCalendarDatabaseHealth.mockResolvedValue({ status: 'unavailable', detail: 'HTTP 503.' });

  render(<CalendarBackendStatus />);

  await waitFor(() => expect(screen.getByLabelText('Spring Boot calendar backend')).toHaveTextContent('Unavailable (HTTP 503.)'));
  expect(screen.getByLabelText('Spring Boot calendar database')).toHaveTextContent('Unavailable (HTTP 503.)');
});

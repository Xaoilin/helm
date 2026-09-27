import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivitySurface from '../surfaces/ActivitySurface';
import type { ServiceActivityInsights } from '../services/backend/activityContracts';
import { DEFAULT_PRODUCT_USAGE_FILTERS } from '../services/productUsageInsights';

/** The contract example: the service's real response shape, with a recommendation and every list filled. */
const EXAMPLE = JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'profile-service', 'activity-insights.json'),
  'utf8')).body as ServiceActivityInsights;
const NO_MATCHES: ServiceActivityInsights = {
  ...EXAMPLE,
  summary: { eventCount: 0, sessionCount: 0, activeSurfaceCount: 0, errorCount: 0, failureRate: null },
  trends: [], funnel: [], errors: [], recommendations: [], coldStart: true,
};

const mocks = vi.hoisted(() => ({
  auth: {
    authUser: { id: 'user-1' } as { id: string } | null,
    bootstrapped: true,
    loading: false,
    supabaseReady: true,
  },
  getActivityInsights: vi.fn(),
  isProfileServiceEnabled: vi.fn(() => true),
}));

vi.mock('../store/AuthSessionContext', () => ({ useOptionalAuthSession: () => mocks.auth }));
vi.mock('../services/backend/profileServiceApi', () => ({
  getActivityInsights: mocks.getActivityInsights,
  isProfileServiceEnabled: mocks.isProfileServiceEnabled,
}));

describe('Activity surface', () => {
  beforeEach(() => {
    mocks.auth.authUser = { id: 'user-1' };
    mocks.auth.bootstrapped = true;
    mocks.auth.loading = false;
    mocks.auth.supabaseReady = true;
    mocks.isProfileServiceEnabled.mockReturnValue(true);
    mocks.getActivityInsights.mockReset();
    mocks.getActivityInsights.mockResolvedValue(EXAMPLE);
  });

  it('keeps analytics private when signed out', () => {
    mocks.auth.authUser = null;
    render(<ActivitySurface />);

    expect(screen.getByText('Sign in to view private usage activity.')).toBeInTheDocument();
    expect(mocks.getActivityInsights).not.toHaveBeenCalled();
  });

  it('shows no Lina audit trail', async () => {
    render(<ActivitySurface />);
    await waitFor(() => expect(screen.getByText('Most-used paths')).toBeInTheDocument());

    expect(screen.queryByRole('heading', { name: 'Assistant actions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Lina activity summary')).not.toBeInTheDocument();
  });

  it('shows the insights the service computed, without deriving any of its own', async () => {
    render(<ActivitySurface />);
    await waitFor(() => expect(screen.getByText('Most-used paths')).toBeInTheDocument());

    expect(mocks.getActivityInsights).toHaveBeenCalledWith(DEFAULT_PRODUCT_USAGE_FILTERS);
    expect(screen.getByText('Session progression')).toBeInTheDocument();
    expect(screen.getByText('Review the highest-frequency failure path')).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE.recommendations[0].evidence)).toBeInTheDocument();
    expect(screen.getByText('calendar render')).toBeInTheDocument();
    expect(screen.getByText('Private to this signed-in account. Analytics is content-free.')).toBeInTheDocument();
    expect(screen.queryByText(/XP/i)).not.toBeInTheDocument();
    const features = screen.getByLabelText('Usage feature');
    expect([...features.querySelectorAll('option')].map(option => option.value))
      .toEqual(['all', ...EXAMPLE.features]);
    expect(screen.getByLabelText('Usage surface')).toHaveValue('all');
  });

  it('asks the service again when a filter changes and offers to clear filters that match nothing', async () => {
    render(<ActivitySurface />);
    await waitFor(() => expect(screen.getByText('Most-used paths')).toBeInTheDocument());
    mocks.getActivityInsights.mockResolvedValueOnce(NO_MATCHES);

    fireEvent.change(screen.getByLabelText('Usage surface'), { target: { value: 'calendar' } });

    expect(await screen.findByText('No activity matches these filters.')).toBeInTheDocument();
    expect(mocks.getActivityInsights).toHaveBeenLastCalledWith({ ...DEFAULT_PRODUCT_USAGE_FILTERS, surface: 'calendar' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByText('Most-used paths')).toBeInTheDocument());
    expect(mocks.getActivityInsights).toHaveBeenLastCalledWith(DEFAULT_PRODUCT_USAGE_FILTERS);
  });

  it('says when the account has no activity yet', async () => {
    mocks.getActivityInsights.mockResolvedValue({ ...NO_MATCHES, totalEventCount: 0, features: [] });
    render(<ActivitySurface />);

    expect(await screen.findByText('No private usage activity yet.')).toBeInTheDocument();
  });

  it('stays hidden while the profile service is not configured', () => {
    mocks.isProfileServiceEnabled.mockReturnValue(false);
    render(<ActivitySurface />);

    expect(screen.getByRole('alert')).toHaveTextContent('Activity service unavailable.');
    expect(mocks.getActivityInsights).not.toHaveBeenCalled();
  });

  it('surfaces read errors with a retry action', async () => {
    mocks.getActivityInsights.mockRejectedValueOnce(new Error('read failed'));
    render(<ActivitySurface />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Private usage activity could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('Most-used paths')).toBeInTheDocument());
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import IntegrationsSurface from '../surfaces/IntegrationsSurface';
import { defaultIntegrations } from '../store/contexts/SettingsContext';

describe('IntegrationsSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should explain simulated provider connections', async () => {
    localStorage.setItem('helm:integrations', JSON.stringify(
      defaultIntegrations.map(integration =>
        integration.id === 'int-github'
          ? { ...integration, status: 'mocked', configuredAt: '2026-04-06T10:00:00.000Z' }
          : integration
      )
    ));

    await act(async () => { renderWithProvider(<IntegrationsSurface />); });
    expect(screen.getByText('This connection is simulated. No real data is being exchanged with GitHub.')).toBeInTheDocument();
  });

  it('should show reconnect-needed Google accounts per row', async () => {
    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastAuthError: 'Google access expired. Reconnect this account.',
      lastAuthCheckAt: '2026-04-07T10:00:00.000Z',
      authExpiresAt: '2026-04-07T09:45:00.000Z',
    }]));
    localStorage.setItem('helm:integrations', JSON.stringify(
      defaultIntegrations.map(integration =>
        integration.id === 'int-google'
          ? { ...integration, status: 'error', lastError: 'Google access expired. Reconnect this account.' }
          : integration
      )
    ));

    await act(async () => { renderWithProvider(<IntegrationsSurface />); });
    expect(screen.getByText('Needs reconnect')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByText(/Access checked/i)).toBeInTheDocument();
    expect(screen.getByText(/Credential status/i)).toBeInTheDocument();
    expect(screen.queryByText(/Token expires/i)).not.toBeInTheDocument();
  });
});

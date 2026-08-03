import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthConsentPage from '../surfaces/OAuthConsentPage';

const mocks = vi.hoisted(() => ({
  approveAuthorization: vi.fn(),
  approveInventoryClient: vi.fn(),
  denyAuthorization: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  revokeInventoryClient: vi.fn(),
  signInWithGoogle: vi.fn(),
  useAuthSession: vi.fn(),
}));

vi.mock('../store/AuthSessionContext', () => ({
  useAuthSession: mocks.useAuthSession,
}));

vi.mock('../store/supabase', () => ({
  approveInventoryOAuthClient: mocks.approveInventoryClient,
  getClient: () => ({
    auth: {
      oauth: {
        approveAuthorization: mocks.approveAuthorization,
        denyAuthorization: mocks.denyAuthorization,
        getAuthorizationDetails: mocks.getAuthorizationDetails,
      },
    },
  }),
  revokeInventoryOAuthClientAllowlist: mocks.revokeInventoryClient,
  signInWithGoogle: mocks.signInWithGoogle,
}));

const authorizationDetails = {
  authorization_id: 'authorization-1',
  redirect_uri: 'https://codex.example.test/oauth/callback',
  scope: 'openid',
  client: {
    id: 'codex-client-1',
    name: 'Codex Inventory',
    uri: 'https://codex.example.test',
    logo_uri: '',
  },
  user: { id: 'user-1', email: 'sabah@example.test' },
};

describe('OAuthConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/helm/oauth/consent?authorization_id=authorization-1');
    mocks.useAuthSession.mockReturnValue({
      authUser: { id: 'user-1', email: 'sabah@example.test' },
      bootstrapped: true,
      supabaseReady: true,
    });
    mocks.getAuthorizationDetails.mockResolvedValue({ data: authorizationDetails, error: null });
    mocks.approveInventoryClient.mockResolvedValue({});
    mocks.revokeInventoryClient.mockResolvedValue({});
  });

  it('shows the requested scope and the explicit Inventory-only boundary', async () => {
    render(<OAuthConsentPage />);

    expect(await screen.findByRole('heading', { name: 'Allow Inventory access?' })).toBeInTheDocument();
    expect(screen.getByText('openid', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Search owned tools, equipment, materials/i)).toBeInTheDocument();
    expect(screen.getByText(/Read chats, calendars, finance, secrets/i)).toBeInTheDocument();
    expect(screen.getByText('codex.example.test', { exact: true })).toBeInTheDocument();
  });

  it('rolls back the Inventory allowlist when OAuth approval fails', async () => {
    mocks.approveAuthorization.mockResolvedValue({
      data: null,
      error: new Error('OAuth grant failed'),
    });
    render(<OAuthConsentPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Allow Inventory' }));
    await waitFor(() => expect(mocks.revokeInventoryClient).toHaveBeenCalledWith('codex-client-1'));
    expect(mocks.approveInventoryClient).toHaveBeenCalledWith('codex-client-1', 'Codex Inventory');
    expect(mocks.approveInventoryClient.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.approveAuthorization.mock.invocationCallOrder[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('OAuth grant failed');
  });

  it('denies without adding the client to the Inventory allowlist', async () => {
    mocks.denyAuthorization.mockResolvedValue({
      data: null,
      error: new Error('Authorization denied'),
    });
    render(<OAuthConsentPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(mocks.denyAuthorization).toHaveBeenCalledWith(
      'authorization-1',
      { skipBrowserRedirect: true },
    ));
    expect(mocks.approveInventoryClient).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Authorization denied');
  });
});

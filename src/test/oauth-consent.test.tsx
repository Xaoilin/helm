import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthConsentPage from '../surfaces/OAuthConsentPage';

const mocks = vi.hoisted(() => ({
  approveInventoryOAuthClient: vi.fn(),
  approveEmploymentOAuthClient: vi.fn(),
  revokeInventoryOAuthClientAllowlist: vi.fn(),
  revokeEmploymentOAuthClient: vi.fn(),
  signInWithGoogle: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
  authUser: { id: 'account-id', email: 'account@example.test' },
}));

vi.mock('../store/AuthSessionContext', () => ({
  useAuthSession: () => ({ bootstrapped: true, authUser: mocks.authUser }),
}));
vi.mock('../store/supabase', () => ({
  ...mocks,
  getClient: () => ({ auth: { oauth: mocks } }),
}));

const details = {
  authorization_id: 'authorization-id',
  redirect_uri: 'https://client.example.test/callback',
  scope: 'openid',
  client: { id: 'client-id', name: 'Employment client', uri: '', logo_uri: '' },
  user: mocks.authUser,
};

describe('separate Employment OAuth consent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/oauth/consent?authorization_id=authorization-id');
    mocks.getAuthorizationDetails.mockResolvedValue({ data: details, error: null });
    mocks.approveAuthorization.mockResolvedValue({ data: { redirect_url: '#approved' }, error: null });
    mocks.denyAuthorization.mockResolvedValue({ data: { redirect_url: '#denied' }, error: null });
  });

  it('requires an explicit area selection even when the client name claims Employment', async () => {
    render(<OAuthConsentPage />);
    expect(await screen.findByRole('button', { name: 'Choose an area' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Employment/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Inventory/ })).not.toBeChecked();
    expect(mocks.approveEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveInventoryOAuthClient).not.toHaveBeenCalled();
  });

  it.each(['Employment', 'Inventory'] as const)('approves only the selected %s area', async area => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(area) }));
    fireEvent.click(screen.getByRole('button', { name: `Allow ${area}` }));
    await waitFor(() => expect(mocks.approveAuthorization).toHaveBeenCalledWith('authorization-id', { skipBrowserRedirect: true }));
    const selected = area === 'Employment' ? mocks.approveEmploymentOAuthClient : mocks.approveInventoryOAuthClient;
    const other = area === 'Employment' ? mocks.approveInventoryOAuthClient : mocks.approveEmploymentOAuthClient;
    expect(selected).toHaveBeenCalledWith('client-id', 'Employment client');
    expect(other).not.toHaveBeenCalled();
    expect(mocks.revokeEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.revokeInventoryOAuthClientAllowlist).not.toHaveBeenCalled();
  });

  it('rolls back Employment alone when OAuth approval fails', async () => {
    mocks.approveAuthorization.mockResolvedValue({ data: null, error: new Error('Authorization expired') });
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Employment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow Employment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Authorization expired');
    expect(mocks.revokeEmploymentOAuthClient).toHaveBeenCalledWith('client-id');
    expect(mocks.revokeInventoryOAuthClientAllowlist).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Allow Employment' })).toBeEnabled();
  });

  it('surfaces rollback failures with a concrete Settings recovery path', async () => {
    mocks.approveAuthorization.mockRejectedValue(new Error('Network unavailable'));
    mocks.revokeEmploymentOAuthClient.mockRejectedValue(new Error('Database unavailable'));
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Employment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Allow Employment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Revoke this client's Employment access in Settings");
    expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
  });

  it('denies without approving either area', async () => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(mocks.denyAuthorization).toHaveBeenCalled());
    expect(mocks.approveEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveInventoryOAuthClient).not.toHaveBeenCalled();
  });
});

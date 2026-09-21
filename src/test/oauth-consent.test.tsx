import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthConsentPage from '../surfaces/OAuthConsentPage';

const mocks = vi.hoisted(() => ({
  approveInventoryOAuthClient: vi.fn(),
  approveEmploymentOAuthClient: vi.fn(),
  approveEquityOAuthClient: vi.fn(),
  approveFinanceOAuthClient: vi.fn(),
  revokeInventoryOAuthClientAllowlist: vi.fn(),
  revokeEmploymentOAuthClient: vi.fn(),
  revokeEquityOAuthClient: vi.fn(),
  revokeFinanceOAuthClient: vi.fn(),
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

describe('separate domain OAuth consent', () => {
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
    expect(screen.getByRole('radio', { name: /Equity/ })).not.toBeChecked();
    expect(mocks.approveEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveInventoryOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveEquityOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveFinanceOAuthClient).not.toHaveBeenCalled();
  });

  it.each(['Employment', 'Inventory', 'Equity', 'Finance'] as const)('approves only the selected %s area', async area => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(area) }));
    fireEvent.click(screen.getByRole('button', { name: `Allow ${area}` }));
    await waitFor(() => expect(mocks.approveAuthorization).toHaveBeenCalledWith('authorization-id', { skipBrowserRedirect: true }));
    const approvals = { Employment: mocks.approveEmploymentOAuthClient, Inventory: mocks.approveInventoryOAuthClient, Equity: mocks.approveEquityOAuthClient, Finance: mocks.approveFinanceOAuthClient };
    expect(approvals[area]).toHaveBeenCalledWith('client-id', 'Employment client');
    for (const [domain, approve] of Object.entries(approvals)) {
      if (domain !== area) expect(approve).not.toHaveBeenCalled();
    }
    expect(mocks.revokeEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.revokeInventoryOAuthClientAllowlist).not.toHaveBeenCalled();
    expect(mocks.revokeEquityOAuthClient).not.toHaveBeenCalled();
  });

  it.each(['Employment', 'Equity', 'Finance'] as const)('rolls back %s alone when OAuth approval fails', async area => {
    mocks.approveAuthorization.mockResolvedValue({ data: null, error: new Error('Authorization expired') });
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(area) }));
    fireEvent.click(screen.getByRole('button', { name: `Allow ${area}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Authorization expired');
    const revocations = { Employment: mocks.revokeEmploymentOAuthClient, Equity: mocks.revokeEquityOAuthClient, Finance: mocks.revokeFinanceOAuthClient };
    expect(revocations[area]).toHaveBeenCalledWith('client-id');
    expect(revocations[area === 'Employment' ? 'Equity' : 'Employment']).not.toHaveBeenCalled();
    expect(mocks.revokeInventoryOAuthClientAllowlist).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: `Allow ${area}` })).toBeEnabled();
  });

  it.each(['Employment', 'Equity', 'Finance'] as const)('surfaces %s rollback failures with a concrete Settings recovery path', async area => {
    mocks.approveAuthorization.mockRejectedValue(new Error('Network unavailable'));
    const revoke = { Employment: mocks.revokeEmploymentOAuthClient, Equity: mocks.revokeEquityOAuthClient, Finance: mocks.revokeFinanceOAuthClient }[area];
    revoke.mockRejectedValue(new Error('Database unavailable'));
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(area) }));
    fireEvent.click(screen.getByRole('button', { name: `Allow ${area}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Revoke this client's ${area} access in Settings`);
    expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
  });

  it('shows Equity permissions without granting trading or banking access', async () => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Equity/ }));
    expect(screen.getByText('Read your stock holdings, option grants, plans, scenarios and supporting sources.')).toBeInTheDocument();
    expect(screen.getByText(/Trading shares, exercising options, moving money/)).toBeInTheDocument();
    expect(screen.getByText(/Access to Inventory, Employment, banking and other finance data/)).toBeInTheDocument();
  });

  it('describes Finance review access without bank payment permissions', async () => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Finance/ }));
    expect(screen.getByText(/Read your dated banking review/)).toBeInTheDocument();
    expect(screen.getByText(/Accessing banks directly, moving money/)).toBeInTheDocument();
    expect(screen.getByText(/Access to Inventory, Employment, Equity and other finance records/)).toBeInTheDocument();
  });

  it('denies without approving any area', async () => {
    render(<OAuthConsentPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(mocks.denyAuthorization).toHaveBeenCalled());
    expect(mocks.approveEmploymentOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveInventoryOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveEquityOAuthClient).not.toHaveBeenCalled();
    expect(mocks.approveFinanceOAuthClient).not.toHaveBeenCalled();
  });
});

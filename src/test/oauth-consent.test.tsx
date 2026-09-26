import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OAuthConsentPage from '../surfaces/OAuthConsentPage';
import { AuthSessionCtx } from '../store/AuthSessionContext';
import { provide, renderWithContexts } from './renderWithContexts';

const mocks = vi.hoisted(() => ({
  approveOAuthClientAccess: vi.fn(),
  revokeOAuthClientAllowlist: vi.fn(),
  getOAuthAuthorization: vi.fn(),
  approveOAuthAuthorization: vi.fn(),
  denyOAuthAuthorization: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock('../store/supabase/oauthClients', () => ({
  approveOAuthClientAccess: mocks.approveOAuthClientAccess,
  revokeOAuthClientAllowlist: mocks.revokeOAuthClientAllowlist,
}));
vi.mock('../store/supabase/oauthAuthorization', () => ({
  getOAuthAuthorization: mocks.getOAuthAuthorization,
  approveOAuthAuthorization: mocks.approveOAuthAuthorization,
  denyOAuthAuthorization: mocks.denyOAuthAuthorization,
}));
vi.mock('../store/supabase/auth', () => ({ signInWithGoogle: mocks.signInWithGoogle }));

const authUser = { id: 'account-id', email: 'account@example.test' } as unknown as User;

const details = {
  authorization_id: 'authorization-id',
  redirect_uri: 'https://client.example.test/callback',
  scope: 'openid',
  client: { id: 'client-id', name: 'Employment client', uri: '', logo_uri: '' },
  user: { id: 'account-id', email: 'account@example.test' },
};

function renderConsentPage() {
  return renderWithContexts(<OAuthConsentPage />, [
    provide(AuthSessionCtx, {
      authUser,
      bootstrapped: true,
      loading: false,
      supabaseReady: true,
      sessionKey: 'account-id:0',
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
    }),
  ]);
}

async function chooseAndAllow(area: string) {
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(area) }));
  fireEvent.click(screen.getByRole('button', { name: `Allow ${area}` }));
}

describe('separate domain OAuth consent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/oauth/consent?authorization_id=authorization-id');
    mocks.getOAuthAuthorization.mockResolvedValue({ kind: 'pending', details });
    mocks.approveOAuthClientAccess.mockResolvedValue({});
    mocks.revokeOAuthClientAllowlist.mockResolvedValue({});
    mocks.approveOAuthAuthorization.mockResolvedValue('#approved');
    mocks.denyOAuthAuthorization.mockResolvedValue('#denied');
  });

  it('requires an explicit area selection even when the client name claims Employment', async () => {
    renderConsentPage();
    expect(await screen.findByRole('button', { name: 'Choose an area' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Employment/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Inventory/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Equity/ })).not.toBeChecked();
    expect(mocks.approveOAuthClientAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['Employment', 'employment'],
    ['Inventory', 'inventory'],
    ['Equity', 'equity'],
    ['Finance', 'finance'],
  ] as const)('approves only the selected %s area', async (area, domain) => {
    renderConsentPage();
    await chooseAndAllow(area);
    await waitFor(() => expect(mocks.approveOAuthAuthorization).toHaveBeenCalledWith('authorization-id'));
    expect(mocks.approveOAuthClientAccess).toHaveBeenCalledTimes(1);
    expect(mocks.approveOAuthClientAccess).toHaveBeenCalledWith(domain, 'client-id', 'Employment client');
    expect(mocks.revokeOAuthClientAllowlist).not.toHaveBeenCalled();
  });

  it.each([
    ['Employment', 'employment'],
    ['Inventory', 'inventory'],
    ['Equity', 'equity'],
    ['Finance', 'finance'],
  ] as const)('rolls back %s alone when OAuth approval fails', async (area, domain) => {
    mocks.approveOAuthAuthorization.mockRejectedValue(new Error('Authorization expired'));
    renderConsentPage();
    await chooseAndAllow(area);
    expect(await screen.findByRole('alert')).toHaveTextContent('Authorization expired');
    expect(mocks.revokeOAuthClientAllowlist).toHaveBeenCalledTimes(1);
    expect(mocks.revokeOAuthClientAllowlist).toHaveBeenCalledWith(domain, 'client-id');
    expect(screen.getByRole('button', { name: `Allow ${area}` })).toBeEnabled();
  });

  it.each(['Employment', 'Equity', 'Finance'] as const)('surfaces %s rollback failures with a concrete Settings recovery path', async area => {
    mocks.approveOAuthAuthorization.mockRejectedValue(new Error('Network unavailable'));
    mocks.revokeOAuthClientAllowlist.mockRejectedValue(new Error('Database unavailable'));
    renderConsentPage();
    await chooseAndAllow(area);
    expect(await screen.findByRole('alert')).toHaveTextContent(`Revoke this client's ${area} access in Settings`);
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
  });

  it('redirects without approving when the request was already resolved', async () => {
    mocks.getOAuthAuthorization.mockResolvedValue({ kind: 'resolved', redirectUrl: '#resolved' });
    renderConsentPage();
    await waitFor(() => expect(window.location.hash).toBe('#resolved'));
    expect(mocks.approveOAuthClientAccess).not.toHaveBeenCalled();
  });

  it('shows why an authorization request cannot be loaded', async () => {
    mocks.getOAuthAuthorization.mockRejectedValue(new Error('This authorization request is unavailable or expired.'));
    renderConsentPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('This authorization request is unavailable or expired.');
  });

  it('shows Equity permissions without granting trading or banking access', async () => {
    renderConsentPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Equity/ }));
    expect(screen.getByText('Read your stock holdings, option grants, plans, scenarios and supporting sources.')).toBeInTheDocument();
    expect(screen.getByText(/Trading shares, exercising options, moving money/)).toBeInTheDocument();
    expect(screen.getByText(/Access to Inventory, Employment, banking and other finance data/)).toBeInTheDocument();
  });

  it('describes Finance review access without bank payment permissions', async () => {
    renderConsentPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Finance/ }));
    expect(screen.getByText(/Read your dated banking review/)).toBeInTheDocument();
    expect(screen.getByText(/Accessing banks directly, moving money/)).toBeInTheDocument();
    expect(screen.getByText(/Access to Inventory, Employment, Equity and other finance records/)).toBeInTheDocument();
  });

  it('denies without approving any area', async () => {
    renderConsentPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(mocks.denyOAuthAuthorization).toHaveBeenCalledWith('authorization-id'));
    expect(mocks.approveOAuthClientAccess).not.toHaveBeenCalled();
  });

  it('surfaces a failed denial and lets the user try again', async () => {
    mocks.denyOAuthAuthorization.mockRejectedValue(new Error('The authorization request could not be denied.'));
    renderConsentPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The authorization request could not be denied.');
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });
});

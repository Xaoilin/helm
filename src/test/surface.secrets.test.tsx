import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import { useState } from 'react';
import { SyncAvailabilityProvider } from '../store/SyncAvailabilityContext';

const secretMocks = vi.hoisted(() => ({
  list: vi.fn(),
  reveal: vi.fn(),
  save: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('../store/supabase', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/supabase')>();
  return {
    ...actual,
    listHelmSecrets: secretMocks.list,
    revealHelmSecret: secretMocks.reveal,
    saveHelmSecret: secretMocks.save,
    setHelmSecretArchived: secretMocks.archive,
  };
});

import SecretsSurface from '../surfaces/SecretsSurface';

function DegradedSecretsHarness() {
  const [readOnly, setReadOnly] = useState(false);
  return (
    <SyncAvailabilityProvider readOnly={readOnly} reason={readOnly ? 'offline' : null}>
      <button type="button" onClick={() => setReadOnly(true)}>Go offline</button>
      <SecretsSurface />
    </SyncAvailabilityProvider>
  );
}

const SUMMARY = {
  secretId: '33333333-3333-4333-8333-333333333333',
  label: 'Production database password',
  kind: 'database' as const,
  environment: 'production',
  projectCatalogKeys: ['catalog:helm'],
  sourceRef: null,
  revision: 1,
  accountVersion: 4,
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
  archivedAt: null,
};

describe('SecretsSurface', () => {
  beforeEach(() => {
    localStorage.clear();
    secretMocks.list.mockReset().mockResolvedValue({ accountVersion: 4, secrets: [SUMMARY] });
    secretMocks.reveal.mockReset().mockResolvedValue({
      secretId: SUMMARY.secretId,
      value: 'sensitive-test-value',
      username: 'postgres',
      url: null,
      notes: null,
    });
    secretMocks.save.mockReset().mockResolvedValue(SUMMARY);
    secretMocks.archive.mockReset().mockResolvedValue({
      ...SUMMARY,
      archivedAt: '2026-07-31T11:00:00.000Z',
    });
  });

  it('keeps values masked until one-click reveal and clears them on focus loss', async () => {
    await act(async () => { renderWithProvider(<SecretsSurface />); });

    expect(await screen.findByRole('heading', { name: SUMMARY.label })).toBeInTheDocument();
    expect(screen.queryByText('sensitive-test-value')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText('sensitive-test-value')).toBeInTheDocument();
    expect(secretMocks.reveal).toHaveBeenCalledWith(SUMMARY.secretId);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();

    fireEvent(window, new Event('blur'));
    await waitFor(() => expect(screen.queryByText('sensitive-test-value')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });

  it('copies lazily without displaying a hidden value', async () => {
    await act(async () => { renderWithProvider(<SecretsSurface />); });
    await screen.findByRole('heading', { name: SUMMARY.label });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sensitive-test-value'));
    expect(screen.queryByText('sensitive-test-value')).not.toBeInTheDocument();
    expect(screen.getByText(`${SUMMARY.label} copied.`)).toBeInTheDocument();
  });

  it('clears revealed plaintext immediately when sync becomes read-only', async () => {
    await act(async () => { renderWithProvider(<DegradedSecretsHarness />); });
    await screen.findByRole('heading', { name: SUMMARY.label });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText('sensitive-test-value')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go offline' }));

    await waitFor(() => expect(screen.queryByText('sensitive-test-value')).not.toBeInTheDocument());
  });

  it('creates through the RPC client and archives reversibly without a delete action', async () => {
    await act(async () => { renderWithProvider(<SecretsSurface />); });
    await screen.findByRole('heading', { name: SUMMARY.label });

    fireEvent.click(screen.getByRole('button', { name: '+ Add Secret' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'New API key' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'api_key' } });
    fireEvent.change(screen.getByLabelText('Secret value'), { target: { value: 'new-test-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Secret' }));

    await waitFor(() => expect(secretMocks.save).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        label: 'New API key',
        kind: 'api_key',
        value: 'new-test-value',
      }),
    ));
    expect(screen.queryByText('new-test-value')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(secretMocks.archive).toHaveBeenCalledWith(
      expect.any(String),
      SUMMARY.secretId,
      true,
    ));
  });
});

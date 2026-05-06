import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SyncDriftModal from '../components/settings/SyncDriftModal';
import type { SyncDriftCandidate } from '../store/persistence';

function makeCandidate(overrides: Partial<SyncDriftCandidate> = {}): SyncDriftCandidate {
  return {
    groupId: 'knowledge',
    label: 'Knowledge',
    description: 'Knowledge topics, notes, and lifestyle tracker items.',
    kind: 'conflict',
    requiresUserChoice: true,
    recommendedChoice: 'keep_database',
    conflictHash: 'abc123',
    canUseDevice: true,
    keys: [],
    local: {
      hasValue: true,
      source: 'localStorage',
      sizeBytes: 58,
      updatedAt: null,
      redactedJson: JSON.stringify([{ id: 'note-1', title: 'Local note' }], null, 2),
    },
    remote: {
      hasValue: true,
      source: 'database',
      sizeBytes: 60,
      updatedAt: '2026-05-01T10:00:00.000Z',
      redactedJson: JSON.stringify([{ id: 'note-1', title: 'Remote note' }], null, 2),
    },
    diff: {
      localOnly: [],
      remoteOnly: [],
      changed: [{
        key: 'knowledgeEntries',
        keyLabel: 'Knowledge entries',
        id: 'note-1',
        label: 'Local note',
        detail: 'Different fields in both places.',
      }],
      unchangedCount: 0,
    },
    ...overrides,
  };
}

describe('SyncDriftModal', () => {
  it('defaults each conflict to keeping the database', () => {
    render(
      <SyncDriftModal
        candidates={[makeCandidate()]}
        open
        resolvingGroupId={null}
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Keep database/i)).toBeChecked();
    expect(screen.getByLabelText(/Use this device/i)).not.toBeChecked();
    expect(screen.getByText('Local note')).toBeInTheDocument();
  });

  it('allows switching to this device and resolves the active group', () => {
    const onResolve = vi.fn();
    const candidate = makeCandidate();
    render(
      <SyncDriftModal
        candidates={[candidate]}
        open
        resolvingGroupId={null}
        onClose={vi.fn()}
        onResolve={onResolve}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Use this device/i));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve selected' }));

    expect(onResolve).toHaveBeenCalledWith(candidate, 'use_device');
  });

  it('renders expandable exact JSON for both sides', () => {
    render(
      <SyncDriftModal
        candidates={[makeCandidate()]}
        open
        resolvingGroupId={null}
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Exact JSON'));

    const jsonRegion = screen.getByText('Exact JSON').closest('details');
    expect(jsonRegion).not.toBeNull();
    expect(within(jsonRegion as HTMLElement).getByText(/Remote note/)).toBeInTheDocument();
    expect(within(jsonRegion as HTMLElement).getByText(/Local note/)).toBeInTheDocument();
  });

  it('prevents device overwrite when local JSON is unreadable', () => {
    render(
      <SyncDriftModal
        candidates={[makeCandidate({
          kind: 'unreadable',
          canUseDevice: false,
          diff: {
            localOnly: [],
            remoteOnly: [],
            changed: [{
              key: 'settings',
              keyLabel: 'Settings',
              id: 'settings',
              label: 'Settings',
              detail: 'This device has unreadable JSON.',
            }],
            unchangedCount: 0,
          },
        })]}
        open
        resolvingGroupId={null}
        onClose={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Use this device/i)).toBeDisabled();
  });
});

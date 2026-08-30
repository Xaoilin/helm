import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LifeHeroAdventure from '../components/dashboard/LifeHeroAdventure';
import type { GamificationProfile, LifeHeroSnapshot, LifeHeroStat } from '../types/domain';

const mocks = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStoreRecordFieldsCommitted: vi.fn(),
}));

vi.mock('../store/persistence', () => ({
  loadStore: mocks.loadStore,
  saveStoreRecordFieldsCommitted: mocks.saveStoreRecordFieldsCommitted,
}));

const STATS: LifeHeroStat[] = [
  'faith', 'vitality', 'knowledge', 'discipline', 'finances', 'craft', 'community',
];

function snapshot(): LifeHeroSnapshot {
  return {
    rulesetVersion: 'life-hero-v1',
    totalXp: 0,
    overallLevel: 1,
    updatedAt: '2026-08-30T07:00:00.000Z',
    recomputedAt: '2026-08-30T07:00:00.000Z',
    stats: STATS.map(stat => ({
      stat,
      totalXp: 0,
      level: 1,
      lastEvidenceLocalDate: null,
      condition: 'awaiting_first_step',
      attentionAfterDays: 2,
    })),
    recentActivity: [],
  };
}

beforeEach(() => {
  mocks.loadStore.mockReset().mockResolvedValue(null);
  mocks.saveStoreRecordFieldsCommitted.mockReset().mockResolvedValue(undefined);
});

describe('Life Hero daily adventure surface', () => {
  it('starts and completes a deterministic encounter with accessible keyboard moves', async () => {
    render(<LifeHeroAdventure localDate="2026-08-30" snapshot={snapshot()} />);
    const adventure = await screen.findByRole('region', { name: 'Daily adventure' });
    expect(adventure).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start today’s adventure' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start today’s adventure' }));
    const encounter = await screen.findByText('Continue today’s path');
    expect(encounter).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brave strike/ })).toHaveAttribute('aria-keyshortcuts', '1');
    expect(screen.getByRole('button', { name: /Guarded step/ })).toHaveAttribute('aria-keyshortcuts', '2');

    const panel = screen.getByText('Continue today’s path').closest('.life-hero-adventure')!;
    panel.focus();
    fireEvent.keyDown(panel, { key: '1' });
    await waitFor(() => expect(screen.getByText(/Round 2 of/)).toBeInTheDocument());

    for (let turn = 0; turn < 4; turn += 1) {
      const strike = screen.queryByRole('button', { name: /Brave strike|Steady strike/ });
      if (!strike) break;
      fireEvent.click(strike);
      await waitFor(() => expect(mocks.saveStoreRecordFieldsCommitted).toHaveBeenCalledTimes(turn + 3));
    }

    expect(await screen.findByText('Today’s path is complete')).toBeInTheDocument();
    expect(screen.getByText(/Permanent Life Hero progress is unchanged/)).toBeInTheDocument();
    expect(mocks.saveStoreRecordFieldsCommitted).toHaveBeenCalled();
  });

  it('resumes a same-day checkpoint and makes no write for inactivity', async () => {
    const stored: GamificationProfile = {
      totalXp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      totalTasksCompleted: 0,
      badges: [],
      lifeHeroAdventure: {
        schemaVersion: 1,
        localDate: '2026-08-30',
        status: 'in_progress',
        round: 2,
        heroHp: 3,
        foeHp: 2,
        focused: false,
        log: ['Checkpoint retained.'],
        updatedAt: '2026-08-30T07:00:00.000Z',
      },
    };
    mocks.loadStore.mockResolvedValue(stored);

    render(<LifeHeroAdventure localDate="2026-08-30" snapshot={snapshot()} />);
    expect(await screen.findByText('Continue today’s path')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint saved')).toBeInTheDocument();
    expect(mocks.saveStoreRecordFieldsCommitted).not.toHaveBeenCalled();
  });

  it('shows an actionable save failure without changing the visible checkpoint', async () => {
    mocks.saveStoreRecordFieldsCommitted.mockRejectedValue(new Error('database unavailable'));
    render(<LifeHeroAdventure localDate="2026-08-30" snapshot={snapshot()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start today’s adventure' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This move was not saved');
    expect(screen.getByRole('button', { name: 'Start today’s adventure' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Daily adventure' })).queryByText('Continue today’s path')).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LifeHeroCompanion from '../components/dashboard/LifeHeroCompanion';
import type { LifeHeroSnapshot, LifeHeroStat } from '../types/domain';

const mocks = vi.hoisted(() => ({ fetchSnapshot: vi.fn() }));

vi.mock('../store/supabase', () => ({
  fetchLifeHeroSnapshot: mocks.fetchSnapshot,
}));

const STAT_ORDER: LifeHeroStat[] = [
  'faith', 'vitality', 'knowledge', 'discipline', 'finances', 'craft', 'community',
];

function snapshot(): LifeHeroSnapshot {
  return {
    rulesetVersion: 'life-hero-v1',
    totalXp: 210,
    overallLevel: 2,
    updatedAt: '2026-08-30T07:00:00.000Z',
    recomputedAt: '2026-08-30T07:00:00.000Z',
    stats: STAT_ORDER.map((stat, index) => ({
      stat,
      totalXp: index * 10,
      level: 1,
      lastEvidenceLocalDate: index === 6 ? null : '2026-08-30',
      condition: index === 3 ? 'renewal_due' : index === 6 ? 'awaiting_first_step' : 'steady',
      attentionAfterDays: 2,
    })),
    recentActivity: [],
  };
}

beforeEach(() => {
  mocks.fetchSnapshot.mockReset();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe('Life Hero companion', () => {
  it('renders loading, summary, seven paths, conditions, and modular jacket control accessibly', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    expect(screen.getByRole('status')).toHaveTextContent('Preparing your hero');
    expect(await screen.findByText('Overall level')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    const details = screen.getByRole('button', { name: 'Open hero details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('Ready to renew')).toBeInTheDocument();

    const jacket = screen.getByRole('switch', { name: /Training jacket/ });
    expect(jacket).toHaveAttribute('aria-checked', 'true');
    expect(jacket).toBeDisabled();
    expect(jacket).toHaveTextContent('3D view required');
  });

  it('collapses to an unobtrusive keyboard-operable level button', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);
    await screen.findByText('Overall level');

    fireEvent.click(screen.getByRole('button', { name: 'Hide Life Hero companion' }));
    const collapsed = screen.getByRole('button', { name: /Show Life Hero companion, level 2/ });
    expect(collapsed).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(collapsed);
    expect(screen.getByRole('heading', { name: 'Life Hero' })).toBeInTheDocument();
  });

  it('shows a truthful first-step state when no progress has been earned yet', async () => {
    const emptySnapshot = snapshot();
    emptySnapshot.totalXp = 0;
    emptySnapshot.overallLevel = 1;
    emptySnapshot.stats = emptySnapshot.stats.map(stat => ({
      ...stat,
      totalXp: 0,
      level: 1,
      lastEvidenceLocalDate: null,
      condition: 'awaiting_first_step',
    }));
    mocks.fetchSnapshot.mockResolvedValue(emptySnapshot);
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    expect(await screen.findByText('Your hero is ready. Any verified first step can begin the journey.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open hero details' }));
    expect(screen.getAllByText('First step ready')).toHaveLength(7);
    expect(screen.getByText('No progress loss')).toBeInTheDocument();
  });

  it('fails closed with a retryable message and never invents progress', async () => {
    mocks.fetchSnapshot.mockRejectedValueOnce(new Error('database unavailable'));
    mocks.fetchSnapshot.mockResolvedValueOnce(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your stored progress is safe');
    expect(within(alert).queryByText(/Lv [0-9]/)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Overall level')).toBeInTheDocument();
  });
});

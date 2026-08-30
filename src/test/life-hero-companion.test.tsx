import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LifeHeroCompanion from '../components/dashboard/LifeHeroCompanion';
import type { LifeHeroSnapshot, LifeHeroStat } from '../types/domain';

const mocks = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  isSpeaking: false,
}));

vi.mock('../store/supabase', () => ({
  fetchLifeHeroSnapshot: mocks.fetchSnapshot,
}));

vi.mock('../hooks/useVoiceOutput', () => ({
  useVoiceOutput: () => ({
    speak: mocks.speak,
    stopSpeaking: mocks.stopSpeaking,
    isSpeaking: mocks.isSpeaking,
    audioRef: { current: null },
  }),
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
  mocks.speak.mockReset();
  mocks.speak.mockResolvedValue(undefined);
  mocks.stopSpeaking.mockReset();
  mocks.isSpeaking = false;
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
  it('renders loading, summary, seven paths, and conditions accessibly', async () => {
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

    expect(screen.queryByRole('switch', { name: /jacket|clothing|garment/iu }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mute Life Hero voice' })).toBeInTheDocument();
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

  it('never autoplays and supports a rate-limited text-only mute path', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);
    await screen.findByText('Overall level');

    expect(mocks.speak).not.toHaveBeenCalled();
    expect(screen.getByText('Voice never starts automatically.')).toBeInTheDocument();

    const mute = screen.getByRole('switch', { name: 'Mute Life Hero voice' });
    fireEvent.click(mute);
    expect(screen.getByRole('switch', { name: 'Unmute Life Hero voice' }))
      .toHaveAttribute('aria-checked', 'true');

    const request = screen.getByRole('button', { name: 'Show motivation' });
    fireEvent.click(request);
    fireEvent.click(request);

    expect(mocks.speak).not.toHaveBeenCalled();
    expect(screen.getByText(/Your progress is safe\. Take one gentle step when you are ready\./u))
      .toBeInTheDocument();
    expect(request).toBeDisabled();
    expect(screen.getByText('Voice is muted. Motivation is shown as text only.'))
      .toBeInTheDocument();
  });

  it('shows loading, speaking, and actionable playback failure states', async () => {
    let rejectPlayback: ((reason?: unknown) => void) | undefined;
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.speak.mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectPlayback = reject;
    }));
    const rendered = render(<LifeHeroCompanion localDate="2026-08-30" />);
    await screen.findByText('Overall level');

    fireEvent.click(screen.getByRole('button', { name: 'Hear motivation' }));
    expect(screen.getByText('Preparing voice…')).toBeInTheDocument();

    mocks.isSpeaking = true;
    rendered.rerender(<LifeHeroCompanion localDate="2026-08-30" />);
    expect(screen.getByText('Speaking…')).toBeInTheDocument();

    mocks.isSpeaking = false;
    rejectPlayback?.(new Error('playback unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check browser audio and try again; the message remains available as text.',
    );
    expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
});

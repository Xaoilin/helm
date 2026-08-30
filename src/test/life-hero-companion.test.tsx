import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LifeHeroCompanion from '../components/dashboard/LifeHeroCompanion';
import type { LifeHeroSnapshot, LifeHeroStat } from '../types/domain';

const mocks = vi.hoisted(() => ({
  fetchSnapshot: vi.fn(),
  browserSpeak: vi.fn(),
  elevenLabsSpeak: vi.fn(),
  speechCancel: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  fetchLifeHeroSnapshot: mocks.fetchSnapshot,
}));

vi.mock('../services/voiceAssistant', () => ({
  speakWithBrowserTTS: mocks.browserSpeak,
  speakWithElevenLabs: mocks.elevenLabsSpeak,
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
  mocks.browserSpeak.mockReset().mockResolvedValue('played');
  mocks.elevenLabsSpeak.mockReset();
  mocks.speechCancel.mockReset();
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { cancel: mocks.speechCancel },
  });
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

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('uses the rendered base-only hero for reduced-motion and loading fallbacks', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    const image = screen.getByRole('img', { name: 'Original Life Hero standing in a ready pose' });
    expect(image).toHaveAttribute('src', expect.stringContaining('life-hero-jacket-off'));
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

  it('never autoplays and exposes loading, speaking, text, and rate-limit states', async () => {
    let startSpeech: (() => void) | undefined;
    let resolveSpeech: ((result: 'played') => void) | undefined;
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.browserSpeak.mockImplementation((
      _text: string,
      _lang: string,
      options: { onStart?: () => void },
    ) => new Promise(resolve => {
      startSpeech = options.onStart;
      resolveSpeech = resolve as (result: 'played') => void;
    }));
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    const panel = await screen.findByRole('region', { name: 'Hero voice' });
    expect(within(panel).getByText(/Your progress is safe/)).toBeInTheDocument();
    expect(mocks.browserSpeak).not.toHaveBeenCalled();

    const play = within(panel).getByRole('button', { name: 'Hear encouragement' });
    fireEvent.click(play);
    expect(within(panel).getByText('Preparing the motivational voice…')).toBeInTheDocument();
    expect(mocks.browserSpeak).toHaveBeenCalledTimes(1);

    act(() => startSpeech?.());
    expect(within(panel).getByText('Speaking encouragement…')).toBeInTheDocument();
    expect(play).toBeDisabled();
    fireEvent.click(play);
    expect(mocks.browserSpeak).toHaveBeenCalledTimes(1);

    await act(async () => resolveSpeech?.('played'));
    await waitFor(() => expect(within(panel).getByText(/resting briefly/)).toBeInTheDocument());
    expect(within(panel).getByRole('button', { name: 'Ready shortly' })).toBeDisabled();
  });

  it('supports mute and an always-visible text-only fallback', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    const panel = await screen.findByRole('region', { name: 'Hero voice' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mute Life Hero voice' }));
    expect(within(panel).getByRole('button', { name: 'Turn Life Hero voice on' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('button', { name: 'Text only' })).toBeDisabled();
    expect(within(panel).getByText('Muted. Encouragement remains available as text.'))
      .toBeInTheDocument();
    expect(within(panel).getByText(/Your progress is safe/)).toBeInTheDocument();
    expect(mocks.browserSpeak).not.toHaveBeenCalled();
    expect(mocks.speechCancel).not.toHaveBeenCalled();
  });

  it('shows an actionable failure when no speech path can play', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.browserSpeak.mockResolvedValue('unavailable');
    render(<LifeHeroCompanion localDate="2026-08-30" />);

    const panel = await screen.findByRole('region', { name: 'Hero voice' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Hear encouragement' }));
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('unavailable in this browser');
    expect(alert).toHaveTextContent('text');
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

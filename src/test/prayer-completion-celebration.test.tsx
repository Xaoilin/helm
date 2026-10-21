import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrayerCompletionDialog from '../components/prayer/PrayerCompletionDialog';

const mocks = vi.hoisted(() => ({
  celebration: { celebrate: vi.fn() },
  prayer: {
    pendingCompletion: {
      prayerName: 'Dhuhr' as const,
      prayerDate: '2026-08-29',
      source: 'dashboard' as const,
      suggestedStatus: 'on_time' as const,
    },
    schedule: null,
    today: '2026-08-29',
    cancelPrayerCompletion: vi.fn(),
    confirmPrayerCompletion: vi.fn(),
  },
}));

vi.mock('../store/contexts/MilestoneCelebrationContext', () => ({
  useMilestoneCelebration: () => mocks.celebration,
}));
vi.mock('../store/contexts/PrayerContext', () => ({
  usePrayerContext: () => mocks.prayer,
}));

describe('prayer completion celebration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resolves once the planner has rewarded the recorded prayer.
    mocks.prayer.confirmPrayerCompletion.mockReturnValue(Promise.resolve({
      prayerName: 'Dhuhr',
      prayerDate: '2026-08-29',
      status: 'on_time',
      xpEarned: 15,
      undo: {},
    }));
  });

  it('turns a confirmed prayer click into a dignified visible achievement with the planner\'s XP', async () => {
    render(<PrayerCompletionDialog />);

    fireEvent.click(screen.getByRole('button', { name: /On time/i }));

    expect(mocks.prayer.confirmPrayerCompletion).toHaveBeenCalledWith('on_time');
    await waitFor(() => expect(mocks.celebration.celebrate).toHaveBeenCalledWith({
      tone: 'prayer',
      eyebrow: 'Prayer kept on time',
      title: 'Dhuhr complete',
      message: 'A meaningful daily win · +15 XP',
    }));
  });

  it('shows immediate progress until the planner responds, without inventing XP', async () => {
    let resolveReward!: (result: { prayerName: string; xpEarned: number }) => void;
    mocks.prayer.confirmPrayerCompletion.mockReturnValue(new Promise(resolve => { resolveReward = resolve; }));
    render(<PrayerCompletionDialog />);

    fireEvent.click(screen.getByRole('button', { name: /On time/i }));
    expect(screen.getByRole('status', { name: 'Prayer completion progress' })).toHaveTextContent('Saving Dhuhr…');
    expect(mocks.celebration.celebrate).not.toHaveBeenCalled();
    // A repeated input during the same request must not submit again.
    fireEvent.click(screen.getByRole('button', { name: /On time/i }));
    expect(mocks.prayer.confirmPrayerCompletion).toHaveBeenCalledTimes(1);

    await act(async () => { resolveReward({ prayerName: 'Dhuhr', xpEarned: 15 }); });
    expect(screen.queryByRole('status', { name: 'Prayer completion progress' })).not.toBeInTheDocument();
    expect(mocks.celebration.celebrate).toHaveBeenCalledWith(expect.objectContaining({ message: 'A meaningful daily win · +15 XP' }));
  });

  it('clears progress without celebrating when there is no confirmed reward', async () => {
    mocks.prayer.confirmPrayerCompletion.mockReturnValue(Promise.resolve({ prayerName: 'Dhuhr', xpEarned: 0 }));
    render(<PrayerCompletionDialog />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /On time/i })); });
    expect(screen.queryByRole('status', { name: 'Prayer completion progress' })).not.toBeInTheDocument();
    expect(mocks.celebration.celebrate).not.toHaveBeenCalled();
  });
});

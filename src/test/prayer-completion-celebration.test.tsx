import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});

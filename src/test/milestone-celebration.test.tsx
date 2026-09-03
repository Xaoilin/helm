import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MILESTONE_CELEBRATION_DURATION_MS,
  MilestoneCelebrationProvider,
  useMilestoneCelebration,
} from '../store/contexts/MilestoneCelebrationContext';

function CelebrationTrigger() {
  const { celebrate } = useMilestoneCelebration();
  return (
    <button
      type="button"
      onClick={() => celebrate({
        tone: 'learn',
        eyebrow: 'Learn milestone',
        title: 'Reading · Level 2',
        message: "You went beyond today's target.",
        level: 2,
      })}
    >
      Celebrate
    </button>
  );
}

describe('milestone celebration layer', () => {
  it('shows an accessible non-modal level receipt and dismisses it automatically', () => {
    vi.useFakeTimers();
    render(
      <MilestoneCelebrationProvider>
        <CelebrationTrigger />
      </MilestoneCelebrationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Celebrate' }));

    const celebration = screen.getByRole('status');
    expect(celebration).toHaveAttribute('data-celebration-tone', 'learn');
    expect(celebration).toHaveTextContent('Reading · Level 2');
    expect(celebration).toHaveTextContent("You went beyond today's target.");
    expect(screen.getByLabelText('Level 2 of 5')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(MILESTONE_CELEBRATION_DURATION_MS));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

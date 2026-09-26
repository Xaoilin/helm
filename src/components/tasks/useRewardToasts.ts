import { useCallback, useState } from 'react';
import { TIMING } from '../../config/constants';
import type { CompletionResult } from '../../services/gamification';

export interface RewardToast {
  id: string;
  type: 'xp' | 'levelup' | 'badge' | 'streak';
  text: string;
  emoji?: string;
}

const LEVEL_FLASH_MS = 1000;

/** Toasts and the level-up flash that celebrate an XP reward. */
export function useRewardToasts() {
  const [toasts, setToasts] = useState<RewardToast[]>([]);
  const [showLevelFlash, setShowLevelFlash] = useState(false);

  const addToast = useCallback((toast: Omit<RewardToast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), TIMING.TOAST_LIFETIME);
  }, []);

  const celebrate = useCallback((xpEarned: number, result: CompletionResult | undefined) => {
    if (xpEarned > 0) addToast({ type: 'xp', text: `+${xpEarned} XP`, emoji: '✨' });
    if (result?.leveledUp) {
      addToast({ type: 'levelup', text: `Level ${result.newLevel}! ${result.newTitle}`, emoji: '\u{1F31F}' });
      setShowLevelFlash(true);
      setTimeout(() => setShowLevelFlash(false), LEVEL_FLASH_MS);
    }
    if (result?.isStreakMilestone) {
      addToast({ type: 'streak', text: `${result.streakUpdate.currentStreak}-day streak!`, emoji: '\u{1F525}' });
    }
    for (const badge of result?.newBadges || []) {
      addToast({ type: 'badge', text: `${badge.name} unlocked!`, emoji: badge.emoji });
    }
  }, [addToast]);

  return { toasts, showLevelFlash, celebrate };
}

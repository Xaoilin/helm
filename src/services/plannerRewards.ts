import type { PlannerReward } from './backend/plannerContracts';
import { getBadgeDef, type BadgeDef, type CompletionResult } from './gamification';

/**
 * What the celebration shows for a reward the planner service granted. Badge names and pictures come
 * from the app's catalogue; the service only names the badges earned.
 */
export function toCompletionResult(reward: PlannerReward): CompletionResult {
  return {
    xpEarned: reward.xpEarned,
    newLevel: reward.level,
    leveledUp: reward.leveledUp,
    newTitle: reward.title,
    newBadges: reward.newBadges.map(getBadgeDef).filter((badge): badge is BadgeDef => Boolean(badge)),
    streakCurrent: reward.currentStreak,
    isStreakMilestone: reward.streakMilestone,
  };
}

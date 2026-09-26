import { getBadgeDef, isStreakMilestone, titleForLevel, xpToNextLevel } from '../../services/gamification';
import type { GamificationProfile } from '../../types/domain';

/** Level, XP progress, streak, and recent badges shown above the Today list. */
export default function GamificationPanel({ profile }: { profile: GamificationProfile }) {
  const xp = xpToNextLevel(profile.totalXp);
  return (
    <div className="gam-panel">
      <div className="gam-level">
        <div className="gam-level-num">{profile.level}</div>
        <div className="gam-level-label">{titleForLevel(profile.level)}</div>
      </div>
      <div className="gam-xp-section">
        <div className="gam-xp-title">
          <span>{profile.totalXp} XP total</span>
          <span>{xp.current} / {xp.needed} to level {profile.level + 1}</span>
        </div>
        <div className="gam-xp-bar">
          <div className="gam-xp-fill" style={{ width: `${xp.progress * 100}%` }} />
        </div>
      </div>
      <div className="gam-stats">
        {profile.currentStreak > 0 && (
          <div className={`gam-streak ${isStreakMilestone(profile.currentStreak) ? 'milestone' : ''}`}>
            <span className="gam-streak-fire">{'\u{1F525}'}</span>
            {profile.currentStreak}d
          </div>
        )}
        {profile.badges.length > 0 && (
          <div className="gam-badges-row">
            {profile.badges.slice(-5).map(id => {
              const badge = getBadgeDef(id);
              return badge ? (
                <span key={id} className={`gam-badge ${badge.rarity}`} title={`${badge.name}: ${badge.description}`}>{badge.emoji}</span>
              ) : null;
            })}
            {profile.badges.length > 5 && <span style={{ fontSize: 11, color: '#6b6f85', alignSelf: 'center' }}>+{profile.badges.length - 5}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

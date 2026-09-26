import type { RewardToast } from './useRewardToasts';

/** Reward toasts and the level-up flash. */
export function RewardToasts({ toasts, showLevelFlash }: { toasts: RewardToast[]; showLevelFlash: boolean }) {
  return (
    <>
      {toasts.length > 0 && (
        <div className="gam-toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`gam-toast ${t.type}`}>
              {t.emoji && <span>{t.emoji}</span>}
              {t.text}
            </div>
          ))}
        </div>
      )}
      {showLevelFlash && <div className="gam-levelup-flash" />}
    </>
  );
}

import { useState } from 'react';
import type { PrayerOutcomeStatus, Task } from '../types/domain';
import { getHabitEmoji } from '../services/habitEmoji';
import { isPrayerTask } from '../services/prayerTasks';

interface HabitCardsProps {
  habits: Task[];
  onComplete: (task: Task) => void; // called only once, when confirmed
  xpPerHabit?: number;
  getPrayerOutcome?: (task: Task) => PrayerOutcomeStatus | undefined;
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? done / total : 0;
  const offset = circumference * (1 - progress);
  const allDone = total > 0 && done === total;

  return (
    <div className="habit-ring-container">
      <svg className="habit-ring" viewBox="0 0 56 56">
        <defs>
          <linearGradient id="habitGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4f5bff" />
            <stop offset="50%" stopColor="#7c8aff" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <circle className="habit-ring-track" cx="28" cy="28" r={radius} />
        <circle
          className={`habit-ring-fill ${allDone ? 'complete' : ''}`}
          cx="28" cy="28" r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <text className="habit-ring-text" x="28" y="28">
          {done}/{total}
        </text>
      </svg>
      <div className="habit-ring-info">
        <div className="habit-ring-label">
          {allDone ? 'All done! \u{1F389}' : `${total - done} remaining`}
        </div>
        <div className="habit-ring-sub">
          {allDone ? 'Perfect day \u2014 keep the streak alive' : 'Complete your daily habits'}
        </div>
      </div>
    </div>
  );
}

export default function HabitCards({
  habits,
  onComplete,
  xpPerHabit = 15,
  getPrayerOutcome,
}: HabitCardsProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const done = habits.filter(h => h.completed).length;
  const total = habits.length;

  if (total === 0) return null;

  const handleClick = (h: Task) => {
    // If already completed today, do nothing (locked)
    if (h.completed) return;
    if (isPrayerTask(h)) {
      onComplete(h);
      return;
    }
    // Show confirmation
    setConfirmingId(h.id);
  };

  const handleConfirm = (h: Task) => {
    setConfirmingId(null);
    onComplete(h);
  };

  return (
    <>
      <ProgressRing done={done} total={total} />
      <div className="habit-grid">
        {habits.map(h => {
          const emoji = getHabitEmoji(h.title, h.emoji);
          const isConfirming = confirmingId === h.id;
          const prayerOutcome = isPrayerTask(h) ? getPrayerOutcome?.(h) : undefined;
          const prayerOutcomeLabel = prayerOutcome === 'on_time'
            ? 'On time'
            : prayerOutcome === 'late'
              ? 'Late'
              : prayerOutcome === 'unclassified'
                ? 'Legacy — classify'
                : prayerOutcome === 'missed'
                  ? 'Missed'
                  : null;
          return (
            <div
              key={h.id}
              className={`habit-card ${h.completed ? 'done locked' : ''} ${isConfirming ? 'confirming' : ''}`}
              onClick={() => !isConfirming && handleClick(h)}
              role="button"
              tabIndex={0}
              aria-disabled={h.completed || undefined}
              aria-label={h.completed
                ? `${h.title} \u2014 completed${prayerOutcomeLabel ? `, ${prayerOutcomeLabel}` : ''}`
                : `Complete ${h.title}`}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !isConfirming) { e.preventDefault(); handleClick(h); } }}
            >
              <div className="habit-card-check">{h.completed ? '\u2713' : ''}</div>
              <div className="habit-card-emoji">{emoji}</div>
              <div className="habit-card-name">{h.title}</div>
              {!isConfirming && (
                <div className="habit-card-freq">
                  {prayerOutcomeLabel || (h.completed ? 'Done \u2713' : (h.recurring?.frequency || 'daily'))}
                </div>
              )}
              {h.completed && <div className="habit-card-xp">+{xpPerHabit} XP</div>}

              {/* Confirmation overlay */}
              {isConfirming && (
                <div className="habit-confirm-overlay" onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Did you complete this?</div>
                  <div className="actions-row" style={{ justifyContent: 'center', gap: 6 }}>
                    <button className="btn btn-success btn-sm" onClick={e => { e.stopPropagation(); handleConfirm(h); }}>Yes</button>
                    <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setConfirmingId(null); }}>No</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {done === total && total > 0 && (
        <div className="habit-complete-msg">
          All habits complete! Keep the momentum going.
        </div>
      )}
    </>
  );
}

import type { Task } from '../types/domain';
import { getHabitEmoji } from '../services/habitEmoji';

interface HabitCardsProps {
  habits: Task[];
  onToggle: (task: Task) => void;
  xpPerHabit?: number;
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

export default function HabitCards({ habits, onToggle, xpPerHabit = 15 }: HabitCardsProps) {
  const done = habits.filter(h => h.completed).length;
  const total = habits.length;

  if (total === 0) return null;

  return (
    <>
      <ProgressRing done={done} total={total} />
      <div className="habit-grid">
        {habits.map(h => {
          const emoji = getHabitEmoji(h.title, h.emoji);
          return (
            <div
              key={h.id}
              className={`habit-card ${h.completed ? 'done' : ''}`}
              onClick={() => onToggle(h)}
              role="button"
              tabIndex={0}
              aria-label={`${h.completed ? 'Uncheck' : 'Complete'} ${h.title}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(h); } }}
            >
              <div className="habit-card-check">{h.completed ? '\u2713' : ''}</div>
              <div className="habit-card-emoji">{emoji}</div>
              <div className="habit-card-name">{h.title}</div>
              <div className="habit-card-freq">{h.recurring?.frequency || 'daily'}</div>
              {h.completed && <div className="habit-card-xp">+{xpPerHabit} XP</div>}
            </div>
          );
        })}
      </div>
      {done === total && (
        <div className="habit-complete-msg">
          All habits complete! Keep the momentum going.
        </div>
      )}
    </>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type MilestoneCelebrationTone = 'prayer' | 'learn' | 'move' | 'achievement';

export interface MilestoneCelebrationInput {
  tone: MilestoneCelebrationTone;
  eyebrow: string;
  title: string;
  message: string;
  level?: 1 | 2 | 3 | 4 | 5;
}

interface ActiveMilestoneCelebration extends MilestoneCelebrationInput {
  celebrationId: number;
}

interface MilestoneCelebrationContextValue {
  celebrate: (celebration: MilestoneCelebrationInput) => void;
}

export const MILESTONE_CELEBRATION_DURATION_MS = 3200;

const MilestoneCelebrationContext = createContext<MilestoneCelebrationContextValue | null>(null);

export function useMilestoneCelebration(): MilestoneCelebrationContextValue {
  const context = useContext(MilestoneCelebrationContext);
  if (!context) {
    throw new Error('useMilestoneCelebration must be used within MilestoneCelebrationProvider');
  }
  return context;
}

function MilestoneCelebration({ celebration }: { celebration: ActiveMilestoneCelebration }) {
  const level = celebration.level;

  return (
    <div
      className={`milestone-celebration tone-${celebration.tone}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-celebration-tone={celebration.tone}
    >
      <div className="milestone-celebration-glow" aria-hidden="true" />
      <div className="milestone-celebration-card">
        <div className="milestone-celebration-mark" aria-hidden="true">
          <span>{level ? `L${level}` : '✓'}</span>
          <i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <div className="milestone-celebration-copy">
          <span>{celebration.eyebrow}</span>
          <strong>{celebration.title}</strong>
          <p>{celebration.message}</p>
        </div>
        {level && (
          <div className="milestone-celebration-progress" aria-label={`Level ${level} of 5`}>
            <span>Daily path</span>
            <div aria-hidden="true">
              {[1, 2, 3, 4, 5].map(candidate => (
                <i
                  key={candidate}
                  className={candidate <= level ? 'reached' : ''}
                />
              ))}
            </div>
            <strong>{level} / 5</strong>
          </div>
        )}
        <div className="milestone-celebration-sweep" aria-hidden="true" />
      </div>
    </div>
  );
}

export function MilestoneCelebrationProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveMilestoneCelebration | null>(null);
  const nextIdRef = useRef(0);

  const celebrate = useCallback((celebration: MilestoneCelebrationInput) => {
    nextIdRef.current += 1;
    setActive({ ...celebration, celebrationId: nextIdRef.current });
  }, []);

  useEffect(() => {
    if (!active) return;
    const celebrationId = active.celebrationId;
    const timeout = window.setTimeout(() => {
      setActive(current => current?.celebrationId === celebrationId ? null : current);
    }, MILESTONE_CELEBRATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [active]);

  const value = useMemo(() => ({ celebrate }), [celebrate]);

  return (
    <MilestoneCelebrationContext.Provider value={value}>
      {children}
      {active && (
        <MilestoneCelebration
          key={active.celebrationId}
          celebration={active}
        />
      )}
    </MilestoneCelebrationContext.Provider>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GamificationProfile,
  LifeHeroAdventureAction,
  LifeHeroAdventureState,
  LifeHeroSnapshot,
} from '../../types/domain';
import {
  createLifeHeroAdventure,
  deriveLifeHeroAdventureProfile,
  LIFE_HERO_ADVENTURE_MAX_ROUNDS,
  parseLifeHeroAdventureState,
  resetLifeHeroAdventure,
  startLifeHeroAdventure,
  takeLifeHeroAdventureTurn,
  type LifeHeroAdventureAbility,
} from '../../services/lifeHeroAdventure';
import { DEFAULT_PROFILE } from '../../services/gamification';
import { loadStore, saveStoreRecordFieldsCommitted } from '../../store/persistence';

interface LifeHeroAdventureProps {
  localDate: string;
  snapshot: LifeHeroSnapshot;
}

type AdventureLoadState = 'loading' | 'ready' | 'error';

export default function LifeHeroAdventure({ localDate, snapshot }: LifeHeroAdventureProps) {
  const [state, setState] = useState<LifeHeroAdventureState | null>(null);
  const [loadState, setLoadState] = useState<AdventureLoadState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useMemo(
    () => deriveLifeHeroAdventureProfile(snapshot, localDate),
    [localDate, snapshot],
  );

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setError(null);
    void loadStore<GamificationProfile>('gamification').then(storedProfile => {
      if (!active) return;
      const stored = parseLifeHeroAdventureState(storedProfile?.lifeHeroAdventure, localDate);
      setState(stored ?? createLifeHeroAdventure(snapshot, localDate));
      setLoadState('ready');
    }).catch(() => {
      if (!active) return;
      setState(createLifeHeroAdventure(snapshot, localDate));
      setLoadState('error');
      setError('The daily checkpoint could not be read. You can still play, but saving may need a retry.');
    });
    return () => { active = false; };
  }, [localDate, snapshot]);

  const commit = useCallback(async (next: LifeHeroAdventureState) => {
    setBusy(true);
    setError(null);
    try {
      const profileValue = await loadStore<GamificationProfile>('gamification') ?? DEFAULT_PROFILE;
      await saveStoreRecordFieldsCommitted(
        'gamification',
        'profile',
        { lifeHeroAdventure: next },
        { ...profileValue, lifeHeroAdventure: next },
      );
      setState(next);
      setLoadState('ready');
    } catch {
      setError('This move was not saved. Your permanent progress is safe; try the move again.');
    } finally {
      setBusy(false);
    }
  }, []);

  const begin = useCallback(() => {
    if (!state) return;
    void commit(startLifeHeroAdventure(state));
  }, [commit, state]);

  const reset = useCallback(() => {
    void commit(resetLifeHeroAdventure(snapshot, localDate));
  }, [commit, localDate, snapshot]);

  const takeTurn = useCallback((action: LifeHeroAdventureAction) => {
    if (!state || state.status !== 'in_progress' || busy) return;
    const result = takeLifeHeroAdventureTurn(state, snapshot, action);
    void commit(result.state);
  }, [busy, commit, snapshot, state]);

  if (loadState === 'loading' || !state) {
    return (
      <section className="life-hero-adventure" aria-labelledby="life-hero-adventure-title" aria-busy="true">
        <div className="life-hero-adventure-heading">
          <div>
            <span className="life-hero-eyebrow">Daily loop</span>
            <h3 id="life-hero-adventure-title">Daily adventure</h3>
          </div>
        </div>
        <p className="life-hero-adventure-status" role="status">Loading today’s checkpoint…</p>
      </section>
    );
  }

  return (
    <section
      className="life-hero-adventure"
      aria-labelledby="life-hero-adventure-title"
      onKeyDown={event => {
        if (event.target !== event.currentTarget || state.status !== 'in_progress' || busy) return;
        const action = event.key === '1' ? 'strike' : event.key === '2' ? 'guard' : event.key === '3' ? 'focus' : null;
        if (action) {
          event.preventDefault();
          takeTurn(action);
        }
      }}
      tabIndex={0}
    >
      <div className="life-hero-adventure-heading">
        <div>
          <span className="life-hero-eyebrow">Daily loop · {localDate}</span>
          <h3 id="life-hero-adventure-title">Daily adventure</h3>
        </div>
        <span className="life-hero-adventure-power">Power {profile.heroPower}</span>
      </div>

      {error && <div className="life-hero-adventure-error" role="alert">{error}</div>}
      {loadState === 'error' && !error && (
        <p className="life-hero-adventure-status" role="status">Checkpoint unavailable; this session is not saved yet.</p>
      )}

      {state.status === 'ready' && (
        <div className="life-hero-adventure-intro">
          <p>Take a few calm, deterministic turns against {profile.foeName}. This is practice only: no XP, levels, trophies, or permanent stats are at risk.</p>
          <p className="life-hero-adventure-meta">{profile.momentumDays > 0 ? `${profile.momentumDays} days of momentum inform your capability.` : 'Your current permanent stats inform your capability.'}</p>
          <button type="button" className="life-hero-adventure-primary" onClick={begin} disabled={busy}>
            {busy ? 'Saving checkpoint…' : 'Start today’s adventure'}
          </button>
        </div>
      )}

      {state.status === 'in_progress' && (
        <EncounterView
          state={state}
          profile={profile}
          busy={busy}
          onAction={takeTurn}
        />
      )}

      {state.status === 'complete' && (
        <div className="life-hero-adventure-outcome" role="status" aria-live="polite">
          <span className="life-hero-adventure-outcome-mark" aria-hidden="true">✓</span>
          <strong>Today’s path is complete</strong>
          <p>Deterministic practice reward: a clear mind and a recorded checkpoint. Permanent Life Hero progress is unchanged.</p>
          <p className="life-hero-adventure-meta">Come back tomorrow for a fresh path.</p>
        </div>
      )}

      {state.status === 'defeated' && (
        <div className="life-hero-adventure-outcome" role="status" aria-live="polite">
          <span className="life-hero-adventure-outcome-mark is-safe" aria-hidden="true">↻</span>
          <strong>The path pauses safely</strong>
          <p>No progress is lost. Retry the same deterministic encounter whenever you’re ready.</p>
          <button type="button" className="life-hero-adventure-primary" onClick={reset} disabled={busy}>
            {busy ? 'Saving…' : 'Try again'}
          </button>
        </div>
      )}

      {state.status !== 'complete' && (
        <p className="life-hero-adventure-safety">Permanent stats come only from verified real-world progress.</p>
      )}
    </section>
  );
}

function EncounterView({
  state,
  profile,
  busy,
  onAction,
}: {
  state: LifeHeroAdventureState;
  profile: ReturnType<typeof deriveLifeHeroAdventureProfile>;
  busy: boolean;
  onAction: (action: LifeHeroAdventureAction) => void;
}) {
  return (
    <div className="life-hero-encounter">
      <div className="life-hero-encounter-header">
        <strong>Continue today’s path</strong>
        <span>Round {state.round} of {LIFE_HERO_ADVENTURE_MAX_ROUNDS}</span>
        <span>Checkpoint saved</span>
      </div>
      <div className="life-hero-health-grid">
        <HealthBar label="Your hearts" value={state.heroHp} maximum={profile.maxHeroHp} />
        <HealthBar label={profile.foeName} value={state.foeHp} maximum={profile.foeMaxHp} />
      </div>
      <div className="life-hero-adventure-conditions" aria-label="Current hero conditions">
        <span>Conditions</span>
        {profile.conditions.filter(condition => condition.state !== 'steady').slice(0, 3).map(condition => (
          <span key={condition.stat}>{condition.stat.replace(/^[a-z]/u, letter => letter.toUpperCase())}: {condition.state === 'renewal_due' ? 'renewal' : 'first step'}</span>
        ))}
        {profile.conditions.every(condition => condition.state === 'steady') && <span>Steady</span>}
      </div>
      <div className="life-hero-abilities" role="group" aria-label="Adventure moves">
        {profile.abilities.map(ability => (
          <AbilityButton key={ability.action} ability={ability} disabled={busy} onClick={onAction} />
        ))}
      </div>
      <div className="life-hero-adventure-log" role="log" aria-live="polite" aria-label="Adventure events">
        {state.log.slice(-3).map((entry, index) => <span key={`${state.updatedAt}-${index}`}>{entry}</span>)}
      </div>
    </div>
  );
}

function HealthBar({ label, value, maximum }: { label: string; value: number; maximum: number }) {
  return (
    <div className="life-hero-health-bar">
      <div><span>{label}</span><strong>{value}/{maximum}</strong></div>
      <div className="life-hero-health-track" role="progressbar" aria-label={`${label} health`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value}>
        <span style={{ width: `${(value / maximum) * 100}%` }} />
      </div>
    </div>
  );
}

function AbilityButton({
  ability,
  disabled,
  onClick,
}: {
  ability: LifeHeroAdventureAbility;
  disabled: boolean;
  onClick: (action: LifeHeroAdventureAction) => void;
}) {
  return (
    <button
      type="button"
      className="life-hero-ability"
      aria-keyshortcuts={ability.key}
      onClick={() => onClick(ability.action)}
      disabled={disabled}
    >
      <span><kbd>{ability.key}</kbd> {ability.label}</span>
      <small>{ability.detail}</small>
    </button>
  );
}

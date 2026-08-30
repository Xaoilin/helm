import type {
  LifeHeroAdventureAction,
  LifeHeroAdventureState,
  LifeHeroConditionState,
  LifeHeroSnapshot,
  LifeHeroStat,
} from '../types/domain';
import { deriveLifeHeroDashboardView } from './lifeHeroPresentation';

export const LIFE_HERO_ADVENTURE_SCHEMA_VERSION = 1 as const;
export const LIFE_HERO_ADVENTURE_MAX_ROUNDS = 4;

export interface LifeHeroAdventureAbility {
  action: LifeHeroAdventureAction;
  label: string;
  detail: string;
  key: string;
}

export interface LifeHeroAdventureProfile {
  heroPower: number;
  maxHeroHp: number;
  foeName: string;
  foeMaxHp: number;
  momentumDays: number;
  conditions: Array<{ stat: LifeHeroStat; state: LifeHeroConditionState }>;
  abilities: LifeHeroAdventureAbility[];
}

export interface LifeHeroAdventureResult {
  state: LifeHeroAdventureState;
  message: string;
}

const ADVENTURE_FOE_NAMES = ['The Tangled Path', 'The Heavy Weather', 'The Long Detour'];
const VALID_ACTIONS = new Set<LifeHeroAdventureAction>(['strike', 'guard', 'focus']);

export function deriveLifeHeroAdventureProfile(
  snapshot: LifeHeroSnapshot,
  localDate: string,
): LifeHeroAdventureProfile {
  const view = deriveLifeHeroDashboardView(snapshot);
  const highestStatLevel = Math.max(...snapshot.stats.map(stat => stat.level));
  const heroPower = clamp(
    1 + Math.floor(snapshot.overallLevel / 2) + Math.floor(highestStatLevel / 3) + Math.floor(view.momentumDays / 5),
    1,
    9,
  );
  const daySeed = dateSeed(localDate);
  const foeMaxHp = 4 + (daySeed % 3);

  return {
    heroPower,
    maxHeroHp: 5 + Math.min(4, Math.floor(snapshot.overallLevel / 3)),
    foeName: ADVENTURE_FOE_NAMES[daySeed % ADVENTURE_FOE_NAMES.length],
    foeMaxHp,
    momentumDays: view.momentumDays,
    conditions: snapshot.stats.map(stat => ({ stat: stat.stat, state: stat.condition })),
    abilities: [
      {
        action: 'strike',
        label: heroPower >= 4 ? 'Steady strike' : 'Brave strike',
        detail: `Deal ${Math.min(strikeDamage(heroPower, false, 1), strikeDamage(heroPower, false, 2))}–${Math.max(strikeDamage(heroPower, false, 1), strikeDamage(heroPower, false, 2))} reliable damage.`,
        key: '1',
      },
      {
        action: 'guard',
        label: 'Guarded step',
        detail: 'Take no encounter damage this turn and recover 1 heart.',
        key: '2',
      },
      {
        action: 'focus',
        label: 'Renewing focus',
        detail: 'Prepare a stronger next strike while taking only 1 damage.',
        key: '3',
      },
    ],
  };
}

export function createLifeHeroAdventure(
  snapshot: LifeHeroSnapshot,
  localDate: string,
): LifeHeroAdventureState {
  const profile = deriveLifeHeroAdventureProfile(snapshot, localDate);
  return {
    schemaVersion: LIFE_HERO_ADVENTURE_SCHEMA_VERSION,
    localDate,
    status: 'ready',
    round: 0,
    heroHp: profile.maxHeroHp,
    foeHp: profile.foeMaxHp,
    focused: false,
    log: ['A short, deterministic encounter is ready. Your permanent progress is never at risk.'],
    updatedAt: new Date().toISOString(),
  };
}

export function startLifeHeroAdventure(state: LifeHeroAdventureState): LifeHeroAdventureState {
  if (state.status !== 'ready' && state.status !== 'defeated') return state;
  return {
    ...state,
    status: 'in_progress',
    round: 1,
    log: [...state.log, 'The path is open. Choose a move.'],
    updatedAt: new Date().toISOString(),
  };
}

export function resetLifeHeroAdventure(
  snapshot: LifeHeroSnapshot,
  localDate: string,
): LifeHeroAdventureState {
  return createLifeHeroAdventure(snapshot, localDate);
}

export function takeLifeHeroAdventureTurn(
  state: LifeHeroAdventureState,
  snapshot: LifeHeroSnapshot,
  action: LifeHeroAdventureAction,
): LifeHeroAdventureResult {
  if (!VALID_ACTIONS.has(action)) throw new Error('Unknown Life Hero adventure action.');
  if (state.status !== 'in_progress') return { state, message: 'The encounter is not active.' };

  const profile = deriveLifeHeroAdventureProfile(snapshot, state.localDate);
  const damage = action === 'strike'
    ? strikeDamage(profile.heroPower, state.focused, state.round)
    : 0;
  const foeHp = Math.max(0, state.foeHp - damage);
  const actionMessage = action === 'strike'
    ? `${profile.abilities[0].label} lands for ${damage}.`
    : action === 'guard'
      ? 'Guarded step steadies the hero and restores 1 heart.'
      : 'Renewing focus is ready for the next strike.';

  if (foeHp === 0) {
    return {
      state: {
        ...state,
        status: 'complete',
        foeHp,
        focused: false,
        log: [...state.log, actionMessage, `${profile.foeName} clears. Daily adventure complete—permanent stats are unchanged.`],
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      message: 'Daily adventure complete.',
    };
  }

  const incomingDamage = action === 'guard' ? 0 : action === 'focus' ? 1 : 1 + ((dateSeed(state.localDate) + state.round) % 2);
  const recoveredHp = action === 'guard' ? 1 : 0;
  const heroHp = Math.min(profile.maxHeroHp, Math.max(0, state.heroHp - incomingDamage + recoveredHp));
  if (heroHp === 0) {
    return {
      state: {
        ...state,
        status: 'defeated',
        heroHp,
        foeHp,
        focused: false,
        log: [...state.log, actionMessage, 'The path pauses here. No progress is lost; the same encounter can be tried again.'],
        updatedAt: new Date().toISOString(),
      },
      message: 'The path pauses safely.',
    };
  }

  if (state.round >= LIFE_HERO_ADVENTURE_MAX_ROUNDS) {
    return {
      state: {
        ...state,
        status: 'complete',
        heroHp,
        foeHp,
        focused: false,
        log: [...state.log, actionMessage, 'You reach the marker. Daily adventure complete—permanent stats are unchanged.'],
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      message: 'Daily adventure complete.',
    };
  }

  return {
    state: {
      ...state,
      round: state.round + 1,
      heroHp,
      foeHp,
      focused: action === 'focus',
      log: [...state.log, actionMessage, incomingDamage === 0 ? 'The path stays calm.' : `The path answers for ${incomingDamage}.`],
      updatedAt: new Date().toISOString(),
    },
    message: 'Move resolved.',
  };
}

export function parseLifeHeroAdventureState(value: unknown, localDate: string): LifeHeroAdventureState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<LifeHeroAdventureState>;
  if (
    candidate.schemaVersion !== LIFE_HERO_ADVENTURE_SCHEMA_VERSION
    || candidate.localDate !== localDate
    || !['ready', 'in_progress', 'complete', 'defeated'].includes(candidate.status ?? '')
    || !Number.isInteger(candidate.round) || (candidate.round ?? 0) < 0
    || !Number.isInteger(candidate.heroHp) || (candidate.heroHp ?? -1) < 0
    || !Number.isInteger(candidate.foeHp) || (candidate.foeHp ?? -1) < 0
    || typeof candidate.focused !== 'boolean'
    || !Array.isArray(candidate.log) || candidate.log.some(line => typeof line !== 'string')
    || typeof candidate.updatedAt !== 'string'
  ) return null;
  return candidate as LifeHeroAdventureState;
}

function strikeDamage(heroPower: number, focused: boolean, round: number): number {
  return 1 + Math.min(3, Math.floor(heroPower / 3)) + (focused ? 1 : 0) + (round % 2);
}

function dateSeed(localDate: string): number {
  return [...localDate].reduce((seed, character) => ((seed * 31) + character.charCodeAt(0)) % 997, 7);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

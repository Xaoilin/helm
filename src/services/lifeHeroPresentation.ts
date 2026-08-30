import { LIFE_HERO_STATS, lifeHeroMomentumMultiplier } from './lifeHeroProgression';
import type {
  LifeHeroConditionState,
  LifeHeroSnapshot,
  LifeHeroStat,
  LifeHeroStatProgress,
} from '../types/domain';

export const LIFE_HERO_STAT_PRESENTATION = {
  faith: { label: 'Faith', shortLabel: 'Faith', symbol: '◒' },
  vitality: { label: 'Vitality', shortLabel: 'Vitality', symbol: '△' },
  knowledge: { label: 'Knowledge', shortLabel: 'Knowledge', symbol: '◇' },
  discipline: { label: 'Discipline', shortLabel: 'Discipline', symbol: '◆' },
  finances: { label: 'Finances', shortLabel: 'Finances', symbol: '◈' },
  craft: { label: 'Craft', shortLabel: 'Craft', symbol: '⬡' },
  community: { label: 'Community', shortLabel: 'Community', symbol: '◎' },
} as const satisfies Record<LifeHeroStat, { label: string; shortLabel: string; symbol: string }>;

export const LIFE_HERO_CONDITION_PRESENTATION = {
  awaiting_first_step: {
    label: 'First step ready',
    detail: 'No progress is lost. One verified real-world step will begin this path.',
  },
  steady: {
    label: 'Steady',
    detail: 'Recent real-world progress is keeping this path active.',
  },
  renewal_due: {
    label: 'Ready to renew',
    detail: 'This path is ready for a fresh real-world step. Existing progress remains safe.',
  },
} as const satisfies Record<LifeHeroConditionState, { label: string; detail: string }>;

export type LifeHeroMotionState = 'idle' | 'celebrate' | 'focus' | 'train' | 'tired';

export const LIFE_HERO_AVATAR_CONTRACT = {
  version: 'life-hero-avatar/v1',
  bodyVariant: 'athletic-male-v1',
  skeleton: {
    identity: 'Armature:24:v1',
    name: 'Armature',
    joints: [
      'Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
      'Spine02', 'Spine01', 'Spine', 'LeftShoulder', 'LeftArm',
      'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm',
      'RightForeArm', 'RightHand', 'neck', 'Head', 'head_end', 'headfront',
    ],
  },
  nodes: {
    body: 'LifeHero_BaseBody',
    trainingJacket: 'LifeHero_Jacket',
  },
  slots: ['head', 'torso', 'legs', 'feet', 'back', 'mainHand', 'offHand', 'accessory'],
  bodyRegions: [
    'scalp', 'upperTorso', 'lowerTorso', 'upperArms', 'lowerArms',
    'upperLegs', 'lowerLegs', 'feet',
  ],
  loadout: {
    body: {
      assetKind: 'body',
      node: 'LifeHero_BaseBody',
      compatibleBodyVariants: ['athletic-male-v1'],
    },
    trainingJacket: {
      assetKind: 'skinned-clothing',
      node: 'LifeHero_Jacket',
      occupiedSlot: 'torso',
      bodyVisibilityMask: ['upperTorso', 'upperArms'],
      requiredSkeleton: 'Armature:24:v1',
      compatibleBodyVariants: ['athletic-male-v1'],
    },
  },
  clips: {
    idle: 'Idle_02',
    celebrate: 'Motivational_Cheer',
    focus: 'Walking',
    train: 'Running',
    tired: 'Idle_02',
  },
  assets: {
    primary: {
      path: 'concepts/life-hero/assets/life-hero-modular.glb',
      sha256: 'dad158c26e7d926ad898c78d019898536b7776ac3625b145ddd8aa0c88a0ac66',
      qualityTier: 'max-quality-primary',
    },
    fallback: {
      path: 'concepts/life-hero/assets/life-hero-modular-fallback.glb',
      sha256: '3f507f356a5aa59ad2cff06be2bcfb4d9cec5a43fbd25721127e2407d6e7542e',
      qualityTier: 'constrained-capability-fallback',
    },
    static: {
      path: 'docs/design/evidence/life-hero-jacket-off.png',
      assetKind: 'rendered-base-only-fallback',
    },
  },
} as const;

export interface LifeHeroDashboardView {
  snapshot: LifeHeroSnapshot;
  stats: LifeHeroStatProgress[];
  momentumDays: number;
  momentumMultiplier: number;
  renewalDueCount: number;
  awaitingFirstStepCount: number;
  evolution: {
    name: string;
    baseName: string;
    tier: number;
  };
  nextLevelXp: number;
  currentLevelXp: number;
  levelProgress: number;
  encouragement: string;
  empty: boolean;
}

export interface LifeHeroMotivationalLine {
  category: 'first-step' | 'renewal' | 'momentum' | 'steady';
  text: string;
}

export function selectLifeHeroAsset(capability: {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}): 'primary' | 'fallback' {
  if (
    (typeof capability.deviceMemory === 'number' && capability.deviceMemory <= 4)
    || (typeof capability.hardwareConcurrency === 'number' && capability.hardwareConcurrency <= 4)
  ) {
    return 'fallback';
  }
  return 'primary';
}

export function lifeHeroLevelBounds(level: number): { current: number; next: number } {
  if (!Number.isInteger(level) || level < 1) throw new Error('Life Hero level must be a positive integer.');
  return {
    current: (level - 1) ** 2 * 100,
    next: level ** 2 * 100,
  };
}

export function deriveLifeHeroDashboardView(snapshot: LifeHeroSnapshot): LifeHeroDashboardView {
  const statByName = new Map(snapshot.stats.map(stat => [stat.stat, stat]));
  const stats = LIFE_HERO_STATS.map(stat => {
    const progress = statByName.get(stat);
    if (!progress) throw new Error(`Life Hero snapshot is missing ${stat}.`);
    return progress;
  });
  const steadyStats = new Set(
    stats.filter(stat => stat.condition === 'steady').map(stat => stat.stat),
  );
  const momentumDays = snapshot.recentActivity.reduce((highest, entry) => (
    steadyStats.has(entry.award.stat) ? Math.max(highest, entry.award.momentumDays) : highest
  ), 0);
  const renewalDueCount = stats.filter(stat => stat.condition === 'renewal_due').length;
  const awaitingFirstStepCount = stats.filter(stat => stat.condition === 'awaiting_first_step').length;
  const { current, next } = lifeHeroLevelBounds(snapshot.overallLevel);
  const levelRange = Math.max(1, next - current);
  const empty = snapshot.totalXp === 0;

  return {
    snapshot,
    stats,
    momentumDays,
    momentumMultiplier: momentumDays > 0 ? lifeHeroMomentumMultiplier(momentumDays) : 1,
    renewalDueCount,
    awaitingFirstStepCount,
    evolution: evolutionForLevel(snapshot.overallLevel),
    currentLevelXp: current,
    nextLevelXp: next,
    levelProgress: Math.max(0, Math.min(1, (snapshot.totalXp - current) / levelRange)),
    encouragement: empty
      ? 'Your hero is ready. Any verified first step can begin the journey.'
      : renewalDueCount > 0
        ? `${renewalDueCount} ${renewalDueCount === 1 ? 'path is' : 'paths are'} ready for a fresh step. Your earned progress is safe.`
        : momentumDays >= 7
          ? `${momentumDays} days of momentum are strengthening your path. Keep choosing the next good step.`
          : 'Real-world progress is shaping your hero. Keep building one steady step at a time.',
    empty,
  };
}

export function deriveLifeHeroMotivationalLine(
  view: LifeHeroDashboardView,
): LifeHeroMotivationalLine {
  if (view.empty) {
    return {
      category: 'first-step',
      text: 'One small real-world step is enough to begin. I’m ready when you are.',
    };
  }
  if (view.renewalDueCount > 0) {
    return {
      category: 'renewal',
      text: 'Your progress is safe. Choose one gentle step when you’re ready.',
    };
  }
  if (view.momentumDays >= 7) {
    return {
      category: 'momentum',
      text: `${view.momentumDays} days of steady momentum—you’re building something real. Keep going, one good step at a time.`,
    };
  }
  return {
    category: 'steady',
    text: `Level ${view.snapshot.overallLevel} reflects real effort. Keep shaping your path, one steady step at a time.`,
  };
}

function evolutionForLevel(level: number): LifeHeroDashboardView['evolution'] {
  if (level >= 20) return { name: 'Steadfast Guide', baseName: 'Summit training hall', tier: 4 };
  if (level >= 10) return { name: 'Pathfinder', baseName: 'Advanced training hall', tier: 3 };
  if (level >= 5) return { name: 'Apprentice', baseName: 'Equipped training room', tier: 2 };
  return { name: 'New Recruit', baseName: 'Quiet training corner', tier: 1 };
}

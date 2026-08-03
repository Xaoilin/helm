import type { Surface } from '../types/domain';
import type {
  AssistantDialogPlanReference,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantPendingConfirmation,
  AssistantPendingPrayerCompletion,
} from './shared';
import type { ActionPlan } from './plannerSchema';
import { isKnownCapabilityId } from './capabilities';

const MAX_RECENT_ENTITIES = 10;
const MAX_RECENT_PLANS = 6;
const ACTIVE_SURFACES = new Set<Surface>([
  'dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory',
  'secrets', 'tasks', 'finance', 'health', 'knowledge', 'profile',
  'integrations', 'activity', 'settings', 'debug',
]);

function activeSurface(value: unknown): Surface | undefined {
  return typeof value === 'string' && ACTIVE_SURFACES.has(value as Surface)
    ? value as Surface
    : undefined;
}

function activeEntity(entity: AssistantEntityReference): AssistantEntityReference | null {
  const raw = entity as AssistantEntityReference & { kind?: string; surface?: string };
  if (String(raw.kind) === 'capture_item') return null;
  const surface = activeSurface(raw.surface);
  return { ...entity, ...(surface ? { surface } : { surface: undefined }) };
}

function activePendingConfirmation(
  pending: AssistantPendingConfirmation | undefined,
): AssistantPendingConfirmation | undefined {
  if (!pending || pending.toolCalls.some(call => !isKnownCapabilityId(String(call.capability)))) {
    return undefined;
  }
  return {
    ...pending,
    referencedEntities: pending.referencedEntities
      .map(activeEntity)
      .filter((entity): entity is AssistantEntityReference => Boolean(entity)),
  };
}

function activePendingPrayer(
  pending: AssistantPendingPrayerCompletion | undefined,
): AssistantPendingPrayerCompletion | undefined {
  if (!pending || !isKnownCapabilityId(String(pending.toolCall.capability))) return undefined;
  return {
    ...pending,
    referencedEntities: pending.referencedEntities
      .map(activeEntity)
      .filter((entity): entity is AssistantEntityReference => Boolean(entity)),
  };
}

export function createDialogState(currentSurface?: Surface): AssistantDialogState {
  return {
    currentSurface,
    recentEntities: [],
    recentPlans: [],
  };
}

export function normaliseDialogState(
  state: AssistantDialogState | undefined,
  currentSurface?: Surface,
): AssistantDialogState {
  const recentEntities = (state?.recentEntities ?? [])
    .map(activeEntity)
    .filter((entity): entity is AssistantEntityReference => Boolean(entity));
  const recentPlans = (state?.recentPlans ?? [])
    .map(plan => ({
      ...plan,
      capabilityIds: plan.capabilityIds.filter(isKnownCapabilityId),
    }))
    .filter(plan => plan.capabilityIds.length > 0);
  return {
    currentSurface: activeSurface(currentSurface) || activeSurface(state?.currentSurface),
    recentEntities,
    recentPlans,
    pendingConfirmation: activePendingConfirmation(state?.pendingConfirmation),
    pendingPrayerCompletion: activePendingPrayer(state?.pendingPrayerCompletion),
  };
}

export function rememberEntities(
  state: AssistantDialogState,
  entities: AssistantEntityReference[] | undefined,
): AssistantDialogState {
  if (!entities || entities.length === 0) return state;

  const deduped = new Map<string, AssistantEntityReference>();
  for (const entity of [...entities, ...state.recentEntities]) {
    deduped.set(`${entity.kind}:${entity.id}`, entity);
  }

  return {
    ...state,
    recentEntities: Array.from(deduped.values()).slice(0, MAX_RECENT_ENTITIES),
  };
}

export function rememberPlan(state: AssistantDialogState, plan: ActionPlan): AssistantDialogState {
  const reference: AssistantDialogPlanReference = {
    mode: plan.mode,
    capabilityIds: plan.steps.map(step => step.capability),
    response: plan.response,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    recentPlans: [reference, ...state.recentPlans].slice(0, MAX_RECENT_PLANS),
  };
}

export function withPendingConfirmation(
  state: AssistantDialogState,
  plan: AssistantPendingConfirmation | undefined,
): AssistantDialogState {
  return {
    ...state,
    pendingConfirmation: plan,
  };
}

export function withPendingPrayerCompletion(
  state: AssistantDialogState,
  pending: AssistantPendingPrayerCompletion | undefined,
): AssistantDialogState {
  return {
    ...state,
    pendingPrayerCompletion: pending,
  };
}

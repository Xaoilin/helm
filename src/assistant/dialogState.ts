import type { Surface } from '../types/domain';
import type { AssistantDialogPlanReference, AssistantDialogState, AssistantEntityReference } from './shared';
import type { ActionPlan } from './plannerSchema';

const MAX_RECENT_ENTITIES = 10;
const MAX_RECENT_PLANS = 6;

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
  return {
    currentSurface: currentSurface || state?.currentSurface,
    recentEntities: state?.recentEntities ?? [],
    recentPlans: state?.recentPlans ?? [],
    pendingConfirmation: state?.pendingConfirmation,
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
  plan: ActionPlan | undefined,
): AssistantDialogState {
  return {
    ...state,
    pendingConfirmation: plan,
  };
}

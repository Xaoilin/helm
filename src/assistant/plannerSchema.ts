export const CAPABILITY_IDS = [
  'navigation.go_to_surface',
  'tasks.create_task',
  'tasks.complete_matching',
  'calendar.create_event',
  'calendar.reschedule_event',
  'finance.record_transaction',
  'knowledge.create_entry',
] as const;

export type CapabilityId = typeof CAPABILITY_IDS[number];

export type ActionPlanMode = 'answer' | 'clarify' | 'confirm' | 'act';

export interface ActionPlanStep {
  capability: CapabilityId;
  args: Record<string, unknown>;
  unresolved?: string[];
  requiresConfirmation?: boolean;
}

export interface ActionPlan {
  mode: ActionPlanMode;
  response: string;
  confidence: number;
  steps: ActionPlanStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActionPlanMode(value: unknown): value is ActionPlanMode {
  return value === 'answer' || value === 'clarify' || value === 'confirm' || value === 'act';
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && CAPABILITY_IDS.includes(value as CapabilityId);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function parseActionPlan(value: unknown): ActionPlan | null {
  if (!isPlainObject(value)) return null;
  if (!isActionPlanMode(value.mode) || typeof value.response !== 'string') return null;

  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const steps = rawSteps
    .filter(isPlainObject)
    .map<ActionPlanStep | null>(step => {
      if (!isCapabilityId(step.capability) || !isPlainObject(step.args)) return null;
      return {
        capability: step.capability,
        args: step.args,
        unresolved: Array.isArray(step.unresolved)
          ? step.unresolved.filter((item): item is string => typeof item === 'string')
          : undefined,
        requiresConfirmation: typeof step.requiresConfirmation === 'boolean' ? step.requiresConfirmation : undefined,
      };
    })
    .filter((step): step is ActionPlanStep => step !== null);

  if (value.mode === 'act' && steps.length === 0) {
    return null;
  }

  return {
    mode: value.mode,
    response: value.response.trim(),
    confidence: clampConfidence(value.confidence),
    steps,
  };
}

export const actionPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'response', 'confidence', 'steps'],
  properties: {
    mode: {
      type: 'string',
      enum: ['answer', 'clarify', 'confirm', 'act'],
    },
    response: {
      type: 'string',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['capability', 'args'],
        properties: {
          capability: {
            type: 'string',
            enum: [...CAPABILITY_IDS],
          },
          args: {
            type: 'object',
            additionalProperties: true,
          },
          unresolved: {
            type: 'array',
            items: { type: 'string' },
          },
          requiresConfirmation: {
            type: 'boolean',
          },
        },
      },
    },
  },
} as const;

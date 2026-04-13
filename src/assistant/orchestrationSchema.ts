import {
  getLiveCapabilityDefinitions,
  isKnownCapabilityId,
  type CapabilityId,
} from './capabilities';
import {
  buildActionPlanStepJsonSchema,
  type ActionPlanArgValue,
  type ActionPlanStepArgs,
  type ActionPlanStep,
} from './plannerSchema';

export type AssistantModelTurnMode = 'reply' | 'clarify' | 'confirm' | 'tool_calls';

export interface AssistantModelTextTurn {
  mode: AssistantModelTurnMode;
  assistantMessage: string;
  toolCalls: ActionPlanStep[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildStrictObjectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  } as const;
}

const nullableToolCallsSchema = (capabilityIds: CapabilityId[]) => ({
  type: ['array', 'null'],
  items: {
    anyOf: capabilityIds.map(capabilityId => buildActionPlanStepJsonSchema(capabilityId)),
  },
} as const);

export function buildAssistantModelTurnJsonSchema(capabilityIds?: CapabilityId[]) {
  const resolvedCapabilityIds = capabilityIds && capabilityIds.length > 0
    ? capabilityIds
    : getLiveCapabilityDefinitions().map(capability => capability.id as CapabilityId);

  return buildStrictObjectSchema({
    mode: {
      type: 'string',
      enum: ['reply', 'clarify', 'confirm', 'tool_calls'],
    },
    assistantMessage: {
      type: 'string',
    },
    toolCalls: nullableToolCallsSchema(resolvedCapabilityIds),
  });
}

export function buildAssistantNarrationJsonSchema() {
  return buildStrictObjectSchema({
    assistantMessage: {
      type: 'string',
    },
  });
}

function normalizeStep(step: unknown): ActionPlanStep | null {
  if (!isPlainObject(step) || typeof step.capability !== 'string' || !isKnownCapabilityId(step.capability)) {
    return null;
  }

  const rawArgs = isPlainObject(step.args) ? step.args : null;
  const args = rawArgs ? Object.entries(rawArgs).reduce<ActionPlanStepArgs | null>((acc, [key, value]) => {
    if (!acc) return null;
    if (
      typeof value === 'string'
      || typeof value === 'boolean'
      || (Array.isArray(value) && value.every(item => typeof item === 'string'))
    ) {
      acc[key] = value as ActionPlanArgValue;
      return acc;
    }
    return null;
  }, {}) : null;
  if (!args) return null;

  return {
    capability: step.capability,
    args,
    unresolved: Array.isArray(step.unresolved)
      ? step.unresolved.filter((item): item is string => typeof item === 'string')
      : undefined,
    requiresConfirmation: typeof step.requiresConfirmation === 'boolean'
      ? step.requiresConfirmation
      : undefined,
  };
}

export function parseAssistantModelTextTurn(value: unknown): AssistantModelTextTurn | null {
  if (!isPlainObject(value)) return null;
  if (
    value.mode !== 'reply'
    && value.mode !== 'clarify'
    && value.mode !== 'confirm'
    && value.mode !== 'tool_calls'
  ) {
    return null;
  }
  if (typeof value.assistantMessage !== 'string') return null;

  const rawToolCalls = value.toolCalls;
  const toolCalls = rawToolCalls === null || rawToolCalls === undefined
    ? []
    : Array.isArray(rawToolCalls)
      ? rawToolCalls.map(normalizeStep).filter((step): step is ActionPlanStep => step !== null)
      : null;

  if (toolCalls === null) return null;
  if (value.mode === 'tool_calls' && toolCalls.length === 0) return null;

  return {
    mode: value.mode,
    assistantMessage: value.assistantMessage.trim(),
    toolCalls,
  };
}

export function parseAssistantNarration(value: unknown): { assistantMessage: string } | null {
  if (!isPlainObject(value) || typeof value.assistantMessage !== 'string') return null;
  return { assistantMessage: value.assistantMessage.trim() };
}

import {
  getCapabilityDefinition,
  getLiveCapabilityDefinitions,
  type CapabilityId,
} from './capabilities';
import { buildActionArgsJsonSchema } from './plannerSchema';

export interface AssistantToolDefinition {
  type: 'function';
  name: CapabilityId;
  description: string;
  parameters: ReturnType<typeof buildActionArgsJsonSchema>;
  strict: true;
  confirmationRule: string;
  debugSummary: string;
}

export function buildAssistantToolDefinitions(capabilityIds?: CapabilityId[]): AssistantToolDefinition[] {
  const resolvedCapabilityIds = capabilityIds && capabilityIds.length > 0
    ? capabilityIds
    : getLiveCapabilityDefinitions().map(capability => capability.id as CapabilityId);

  return resolvedCapabilityIds.map(capabilityId => {
    const capability = getCapabilityDefinition(capabilityId);
    return {
      type: 'function',
      name: capability.id as CapabilityId,
      description: capability.description,
      parameters: buildActionArgsJsonSchema(capabilityId),
      strict: true,
      confirmationRule: capability.confirmationRule,
      debugSummary: capability.debugSummary,
    };
  });
}

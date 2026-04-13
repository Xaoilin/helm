import {
  getAllCapabilityDefinitions,
  getCapabilityDefinition,
  getLiveCapabilityDefinitions,
  type CapabilityId,
} from './capabilities';
import { buildActionArgsJsonSchema } from './plannerSchema';

const TOOL_NAME_PREFIX = 'helm_';

export interface AssistantToolDefinition {
  type: 'function';
  name: string;
  capabilityId: CapabilityId;
  description: string;
  parameters: ReturnType<typeof buildActionArgsJsonSchema>;
  strict: true;
  confirmationRule: string;
  debugSummary: string;
}

function encodeCapabilityId(capabilityId: CapabilityId): string {
  return `${TOOL_NAME_PREFIX}${Array.from(capabilityId)
    .map(character => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')}`;
}

const capabilityIdToToolName = new Map<CapabilityId, string>();
const toolNameToCapabilityId = new Map<string, CapabilityId>();

for (const capability of getAllCapabilityDefinitions()) {
  const capabilityId = capability.id as CapabilityId;
  const toolName = encodeCapabilityId(capabilityId);
  const existingCapabilityId = toolNameToCapabilityId.get(toolName);

  if (existingCapabilityId && existingCapabilityId !== capabilityId) {
    throw new Error(`Assistant tool name collision: ${existingCapabilityId} and ${capabilityId} both map to ${toolName}.`);
  }

  capabilityIdToToolName.set(capabilityId, toolName);
  toolNameToCapabilityId.set(toolName, capabilityId);
}

export function toAssistantToolName(capabilityId: CapabilityId): string {
  const toolName = capabilityIdToToolName.get(capabilityId);
  if (!toolName) {
    throw new Error(`Unknown capability id for assistant tool name: ${capabilityId}`);
  }
  return toolName;
}

export function fromAssistantToolName(toolName: string): CapabilityId | null {
  return toolNameToCapabilityId.get(toolName) || null;
}

export function buildAssistantToolDefinitions(capabilityIds?: CapabilityId[]): AssistantToolDefinition[] {
  const resolvedCapabilityIds = capabilityIds && capabilityIds.length > 0
    ? capabilityIds
    : getLiveCapabilityDefinitions().map(capability => capability.id as CapabilityId);

  return resolvedCapabilityIds.map(capabilityId => {
    const capability = getCapabilityDefinition(capabilityId);
    return {
      type: 'function',
      name: toAssistantToolName(capability.id as CapabilityId),
      capabilityId: capability.id as CapabilityId,
      description: capability.description,
      parameters: buildActionArgsJsonSchema(capabilityId),
      strict: true,
      confirmationRule: capability.confirmationRule,
      debugSummary: capability.debugSummary,
    };
  });
}

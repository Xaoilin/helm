import { describe, expect, it } from 'vitest';
import { getAllCapabilityDefinitions, type CapabilityId } from '../assistant/capabilities';
import {
  buildAssistantToolDefinitions,
  fromAssistantToolName,
  toAssistantToolName,
} from '../assistant/toolSchemas';

describe('assistant tool schemas', () => {
  it('maps every capability id to a unique OpenAI-safe tool name', () => {
    const toolNames = getAllCapabilityDefinitions().map(capability =>
      toAssistantToolName(capability.id as CapabilityId),
    );

    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(toolNames.every(toolName => /^[a-zA-Z0-9_-]+$/.test(toolName))).toBe(true);
    expect(toolNames.every(toolName => !toolName.includes('.'))).toBe(true);
  });

  it('round-trips tool names back to capability ids', () => {
    for (const capability of getAllCapabilityDefinitions()) {
      const capabilityId = capability.id as CapabilityId;
      expect(fromAssistantToolName(toAssistantToolName(capabilityId))).toBe(capabilityId);
    }
  });

  it('builds tool definitions with OpenAI-safe names while preserving capability ids', () => {
    const definitions = buildAssistantToolDefinitions(['tasks.open_view']);

    expect(definitions).toEqual([
      expect.objectContaining({
        type: 'function',
        capabilityId: 'tasks.open_view',
        name: toAssistantToolName('tasks.open_view'),
        strict: true,
      }),
    ]);
  });

  it('rejects unknown tool names', () => {
    expect(fromAssistantToolName('helm_not_a_real_tool')).toBeNull();
  });
});

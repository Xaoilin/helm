// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAssistantModelTextTurn } from '../assistant/orchestrationSchema';

describe('orchestrationSchema', () => {
  it('drops null optional args from model text turns instead of rejecting the whole turn', () => {
    const parsed = parseAssistantModelTextTurn({
      mode: 'tool_calls',
      assistantMessage: "I'll add that task.",
      toolCalls: [
        {
          capability: 'tasks.create_task',
          args: {
            title: 'renew passport',
            priority: 'medium',
            category: 'task',
            dueDate: null,
            duePhrase: null,
          },
          unresolved: [],
          requiresConfirmation: false,
        },
      ],
    });

    expect(parsed).toEqual({
      mode: 'tool_calls',
      assistantMessage: "I'll add that task.",
      toolCalls: [
        {
          capability: 'tasks.create_task',
          args: {
            title: 'renew passport',
            priority: 'medium',
            category: 'task',
          },
          unresolved: [],
          requiresConfirmation: false,
        },
      ],
    });
  });
});

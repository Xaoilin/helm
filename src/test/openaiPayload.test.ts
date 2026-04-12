import { describe, expect, it } from 'vitest';
import {
  buildOpenAIResponsesPayload,
  toOpenAIInputMessage,
} from '../../supabase/functions/assistant-openai/openaiPayload';

describe('openaiPayload', () => {
  it('serializes user messages as input_text', () => {
    expect(toOpenAIInputMessage({
      role: 'user',
      content: 'How are you?',
    })).toEqual({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'How are you?',
        },
      ],
    });
  });

  it('serializes assistant history as output_text', () => {
    expect(toOpenAIInputMessage({
      role: 'assistant',
      content: 'I am ready.',
    })).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'I am ready.',
        },
      ],
    });
  });

  it('keeps system content in instructions instead of duplicating it into input messages', () => {
    const payload = buildOpenAIResponsesPayload({
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: 'Be concise.',
        },
        {
          role: 'user',
          content: 'Say hello.',
        },
      ],
      format: {
        type: 'object',
      },
    });

    expect(payload.instructions).toBe('Be concise.');
    expect(payload.input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Say hello.',
          },
        ],
      },
    ]);
  });

  it('builds a mixed multi-turn payload with assistant history encoded as output_text', () => {
    const format = {
      type: 'object',
      additionalProperties: false,
      properties: {
        reply: {
          type: 'string',
        },
      },
      required: ['reply'],
    };

    const payload = buildOpenAIResponsesPayload({
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: 'Return JSON with reply set to READY.',
        },
        {
          role: 'user',
          content: 'Say READY.',
        },
        {
          role: 'assistant',
          content: '{"reply":"READY"}',
        },
        {
          role: 'user',
          content: 'Return READY again.',
        },
      ],
      format,
    });

    expect(payload).toEqual({
      model: 'gpt-5.4',
      store: false,
      temperature: 0.2,
      max_output_tokens: 600,
      instructions: 'Return JSON with reply set to READY.',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Say READY.',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '{"reply":"READY"}',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Return READY again.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'helm_action_plan',
          description: 'Structured action plan for HELM assistant turns.',
          schema: format,
          strict: true,
        },
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { extractOutputText } from '../../supabase/functions/assistant-openai/openaiResponse';

describe('extractOutputText', () => {
  it('returns the legacy top-level output_text when present', () => {
    expect(extractOutputText({
      output_text: '{"answer":"hello"}',
    })).toBe('{"answer":"hello"}');
  });

  it('returns nested output_text content from structured OpenAI responses', () => {
    expect(extractOutputText({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: '{"answer":"hello"}',
            },
          ],
        },
      ],
    })).toBe('{"answer":"hello"}');
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { classifyConfirmationReply } from '../assistant/confirmation';

describe('assistant confirmation parsing', () => {
  it('accepts short affirmative replies with punctuation and clauses', () => {
    expect(classifyConfirmationReply('Yes.')).toBe('confirm');
    expect(classifyConfirmationReply('Okay.')).toBe('confirm');
    expect(classifyConfirmationReply("Yeah, that's the one.")).toBe('confirm');
    expect(classifyConfirmationReply('Do that.')).toBe('confirm');
  });

  it('accepts conversational denials and cancellations', () => {
    expect(classifyConfirmationReply('No, not that one.')).toBe('deny');
    expect(classifyConfirmationReply('Cancel that.')).toBe('deny');
    expect(classifyConfirmationReply("Don't do that.")).toBe('deny');
  });

  it('treats clarification replies as unknown instead of forcing yes or no', () => {
    expect(classifyConfirmationReply('The router one.')).toBe('unknown');
    expect(classifyConfirmationReply('Delete the other task.')).toBe('unknown');
  });
});

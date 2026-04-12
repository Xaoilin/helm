import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_BENCHMARK_CASES,
  retrieveBenchmarkExamples,
} from '../assistant/evals/benchmarkCorpus';

describe('assistant benchmark corpus', () => {
  it('contains at least 200 grounded command cases', () => {
    expect(ASSISTANT_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(200);
  });

  it('keeps destructive task-delete cases confirm-first', () => {
    const destructiveCases = ASSISTANT_BENCHMARK_CASES.filter(example => example.tags.includes('destructive'));

    expect(destructiveCases.length).toBeGreaterThan(0);
    expect(destructiveCases.every(example =>
      example.expectedMode === 'confirm'
      && example.expectedCapabilities.includes('tasks.delete_matching'),
    )).toBe(true);
  });

  it('keeps unsupported cases on truthful clarify instead of approximation', () => {
    const unsupportedCases = ASSISTANT_BENCHMARK_CASES.filter(example => example.tags.includes('unsupported'));

    expect(unsupportedCases.length).toBeGreaterThan(0);
    expect(unsupportedCases.every(example =>
      example.expectedMode === 'clarify'
      && example.expectedCapabilities.length === 0,
    )).toBe(true);
  });

  it('retrieves relevant examples for task deletion prompts', () => {
    const examples = retrieveBenchmarkExamples('Delete my Internet task.', ['tasks.delete_matching'], 4);

    expect(examples.length).toBeGreaterThan(0);
    expect(examples.every(example => example.expectedCapabilities.includes('tasks.delete_matching'))).toBe(true);
  });

  it('includes dialog seeds and grounded entity expectations for pronoun-heavy and destructive cases', () => {
    const seededCases = ASSISTANT_BENCHMARK_CASES.filter(example => example.dialogStateSeed);
    const groundedCases = ASSISTANT_BENCHMARK_CASES.filter(example => example.expectedReferencedEntityIds?.length);

    expect(seededCases.length).toBeGreaterThan(0);
    expect(groundedCases.length).toBeGreaterThan(20);
  });
});

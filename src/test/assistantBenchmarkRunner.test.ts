import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_BENCHMARK_CASES,
  type AssistantBenchmarkCase,
} from '../assistant/evals/benchmarkCorpus';
import {
  getAssistantBenchmarkThresholdFailures,
  runAssistantBenchmark,
} from '../assistant/evals/benchmarkRunner';

function findCase(id: string): AssistantBenchmarkCase {
  const benchmarkCase = ASSISTANT_BENCHMARK_CASES.find(entry => entry.id === id);
  if (!benchmarkCase) {
    throw new Error(`Missing benchmark case ${id}`);
  }
  return benchmarkCase;
}

function makePlanForCase(benchmarkCase: AssistantBenchmarkCase) {
  switch (benchmarkCase.id) {
    case 'task-view-1':
      return {
        mode: 'tool_calls',
        assistantMessage: '',
        toolCalls: [{
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: true,
          },
        }],
      };
    case 'task-delete-1':
      return {
        mode: 'confirm',
        assistantMessage: 'I can delete that task. Do you want me to do it?',
        toolCalls: [{
          capability: 'tasks.delete_matching',
          args: {
            taskIds: ['task-internet'],
          },
        }],
      };
    case 'unsupported-1':
      return {
        mode: 'clarify',
        assistantMessage: 'Email actions are not available in HELM yet.',
        toolCalls: [],
      };
    default:
      throw new Error(`Unhandled benchmark case ${benchmarkCase.id}`);
  }
}

describe('assistant benchmark runner', () => {
  it('scores benchmark cases and preserves entity checks for grounded mutations', async () => {
    const cases = [
      findCase('task-view-1'),
      findCase('task-delete-1'),
      findCase('unsupported-1'),
    ];

    const report = await runAssistantBenchmark({
      provider: 'hosted',
      cases,
      planner: async ({ benchmarkCase }) => ({
        rawResponse: JSON.stringify(makePlanForCase(benchmarkCase)),
        turnType: 'text',
        text: JSON.stringify(makePlanForCase(benchmarkCase)),
        planningSource: 'openai',
        planningModel: 'gpt-5.4',
      }),
    });

    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(3);
    expect(report.summary.passRate).toBe(1);
    expect(report.summary.destructive.passRate).toBe(1);
    expect(report.summary.unsupported.passRate).toBe(1);
    expect(report.summary.entitySelection.passRate).toBe(1);
    expect(getAssistantBenchmarkThresholdFailures(report.summary)).toEqual([]);
  });

  it('reports threshold failures when destructive or unsupported cases regress', async () => {
    const cases = [
      findCase('task-delete-1'),
      findCase('unsupported-1'),
    ];

    const report = await runAssistantBenchmark({
      provider: 'hosted',
      cases,
      planner: async ({ benchmarkCase }) => ({
        rawResponse: benchmarkCase.id === 'task-delete-1'
          ? JSON.stringify({
              mode: 'tool_calls',
              assistantMessage: '',
              toolCalls: [{
                capability: 'navigation.go_to_surface',
                args: {
                  surface: 'tasks',
                },
              }],
            })
          : JSON.stringify({
              mode: 'tool_calls',
              assistantMessage: '',
              toolCalls: [{
                capability: 'navigation.go_to_surface',
                args: {
                  surface: 'chat',
                },
              }],
            }),
        turnType: 'text',
        text: benchmarkCase.id === 'task-delete-1'
          ? JSON.stringify({
              mode: 'tool_calls',
              assistantMessage: '',
              toolCalls: [{
                capability: 'navigation.go_to_surface',
                args: {
                  surface: 'tasks',
                },
              }],
            })
          : JSON.stringify({
              mode: 'tool_calls',
              assistantMessage: '',
              toolCalls: [{
                capability: 'navigation.go_to_surface',
                args: {
                  surface: 'chat',
                },
              }],
            }),
        planningSource: 'openai',
        planningModel: 'gpt-5.4',
      }),
    });

    const failures = getAssistantBenchmarkThresholdFailures(report.summary);

    expect(report.summary.passRate).toBe(0);
    expect(report.summary.destructive.passRate).toBe(0);
    expect(report.summary.unsupported.passRate).toBe(0);
    expect(failures.length).toBe(3);
    expect(failures.join(' ')).toContain('Overall assistant benchmark pass rate');
    expect(failures.join(' ')).toContain('Destructive assistant benchmark pass rate');
    expect(failures.join(' ')).toContain('Unsupported-intent benchmark pass rate');
  });
});

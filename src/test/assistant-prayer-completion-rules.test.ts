import { beforeEach, expect, it, vi } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import type { AssistantActionHandlers } from '../assistant/shared';
import { PrayerCompletionRejectedError } from '../services/prayerCompletionRules';
import { makeAssistantContext, makeTask, TEST_NOW_ISO } from './fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(TEST_NOW_ISO));
});

const fajrTask = makeTask({ id: 'task-fajr', title: 'Fajr Prayer', category: 'prayer', prayerName: 'Fajr' });

function completeFajr(completePrayer: AssistantActionHandlers['completePrayer']) {
  const updateTask = vi.fn();
  const execution = executeActionPlan({
    mode: 'act',
    response: 'Marked Fajr as prayed.',
    confidence: 1,
    steps: [{ capability: 'tasks.complete_matching', args: { taskId: fajrTask.id, prayerStatus: 'on_time' } }],
  }, makeAssistantContext({ tasks: [fajrTask] }), { addTask: vi.fn(() => 'unused'), updateTask, completePrayer }, 'en');
  return { execution, updateTask };
}

it('tells the user why chat or voice cannot complete a prayer that has not started', () => {
  const completePrayer = vi.fn(() => { throw new PrayerCompletionRejectedError('Fajr has not started yet.'); });

  const { execution, updateTask } = completeFajr(completePrayer);

  expect(completePrayer).toHaveBeenCalledOnce();
  expect(JSON.stringify(execution)).toContain('Fajr has not started yet.');
  expect(JSON.stringify(execution)).not.toContain('Marked Fajr as prayed');
  expect(updateTask).not.toHaveBeenCalled();
});

it('still surfaces unexpected completion failures instead of hiding them', () => {
  const completePrayer = vi.fn(() => { throw new Error('storage failed'); });

  expect(() => completeFajr(completePrayer)).toThrow('storage failed');
});

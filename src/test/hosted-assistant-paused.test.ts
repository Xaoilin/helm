import { expect, it, vi } from 'vitest';
import { getAssistantRuntimeStatus } from '../services/assistantAvailability';
import { runAssistantInitialModelTurn } from '../assistant/orchestrator';
import { makeAssistantContext } from './fixtures';
import { runHostedAssistantTurn, testHostedAssistantConnection } from '../services/hostedAssistantApi';
import { HostedAssistantPausedError } from '../services/hostedAssistantAccess';
import { chatWithOllama, testOllamaConnection } from '../services/ollamaApi';

vi.mock('../services/hostedAssistantApi', () => ({
  testHostedAssistantConnection: vi.fn(async () => ({ status: 'paused', message: 'Hosted AI is paused. Use the app controls directly.' })),
  runHostedAssistantTurn: vi.fn(),
  chatWithHostedAssistant: vi.fn(),
  chatWithHostedAssistantDetailed: vi.fn(),
}));
vi.mock('../services/ollamaApi', () => ({ testOllamaConnection: vi.fn(), chatWithOllama: vi.fn() }));

it('keeps auto mode paused without selecting another provider or starting a model turn', async () => {
  expect(await getAssistantRuntimeStatus({ assistantProvider: 'auto' })).toMatchObject({ state: 'paused', headline: 'Hosted AI paused' });
  const turn = await runAssistantInitialModelTurn('Help me plan my week', makeAssistantContext(), { lang: 'en', provider: 'auto' });
  expect(turn).toMatchObject({ source: 'degraded', degradedReason: 'hosted_paused', planningSource: 'none', assistantMessage: expect.stringContaining('paused') });
  expect(runHostedAssistantTurn).not.toHaveBeenCalled();
  expect(chatWithOllama).not.toHaveBeenCalled();
  expect(testOllamaConnection).not.toHaveBeenCalled();
});

it('preserves a pause applied between health and the user request without provider fallback', async () => {
  vi.mocked(testHostedAssistantConnection).mockResolvedValueOnce({ status: 'available' });
  vi.mocked(runHostedAssistantTurn).mockRejectedValueOnce(new HostedAssistantPausedError('Hosted AI is paused. Use the app controls directly.'));
  const turn = await runAssistantInitialModelTurn('Help me plan my week', makeAssistantContext(), { lang: 'en', provider: 'auto' });
  expect(turn).toMatchObject({ source: 'degraded', degradedReason: 'hosted_paused', planningSource: 'none' });
  expect(chatWithOllama).not.toHaveBeenCalled();
  expect(testOllamaConnection).not.toHaveBeenCalled();
});

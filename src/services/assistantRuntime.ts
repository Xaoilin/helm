import { isOllamaAvailable, resetOllamaAvailability, runAssistantTurn } from '../assistant/runtime';
import type {
  AssistantCommandContext,
  AssistantCommandOptions,
  AssistantCommandResult,
} from './assistantTypes';

export { isOllamaAvailable };

export function resetOllamaCache(): void {
  resetOllamaAvailability();
}

export async function processAssistantCommand(
  transcript: string,
  context: AssistantCommandContext,
  options: AssistantCommandOptions = {},
): Promise<AssistantCommandResult> {
  return runAssistantTurn(transcript, context, options);
}

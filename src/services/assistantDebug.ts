import type { AssistantNavigationRequest } from './assistantNavigation';
import type {
  AssistantCommandResult,
  AssistantEntityReference,
  AssistantModelTurn,
  AssistantPendingConfirmation,
  AssistantPlannerValidation,
  AssistantPlanningBundle,
} from '../assistant/shared';
import type { ActionPlan } from '../assistant/plannerSchema';

export interface AssistantDebugTrace {
  recordedAt: string;
  transcript: string;
  effectiveTranscript: string;
  assistantMessage: string;
  source: AssistantCommandResult['source'];
  planningSource: AssistantCommandResult['planningSource'];
  planningStatus: AssistantCommandResult['planningStatus'];
  planningModel?: AssistantCommandResult['planningModel'];
  degradedReason?: AssistantCommandResult['degradedReason'];
  planningBundle?: AssistantPlanningBundle;
  rawPlannerResponse?: string;
  rawNarrationResponse?: string;
  modelTurn?: AssistantModelTurn | null;
  parsedPlan?: ActionPlan | null;
  validatedPlan?: ActionPlan | null;
  plannerValidation?: AssistantPlannerValidation;
  plan: ActionPlan;
  toolCalls?: AssistantCommandResult['toolCalls'];
  pendingConfirmation?: AssistantPendingConfirmation;
  execution?: AssistantCommandResult['execution'];
  referencedEntities?: AssistantEntityReference[];
  navigationRequests?: AssistantNavigationRequest[];
}

type TraceListener = (trace: AssistantDebugTrace | null) => void;

let latestTrace: AssistantDebugTrace | null = null;
const listeners = new Set<TraceListener>();

export function getAssistantDebugTrace(): AssistantDebugTrace | null {
  return latestTrace;
}

export function recordAssistantDebugTrace(trace: AssistantDebugTrace): void {
  latestTrace = trace;
  listeners.forEach(listener => listener(latestTrace));
}

export function clearAssistantDebugTrace(): void {
  latestTrace = null;
  listeners.forEach(listener => listener(latestTrace));
}

export function subscribeAssistantDebugTrace(listener: TraceListener): () => void {
  listeners.add(listener);
  listener(latestTrace);
  return () => {
    listeners.delete(listener);
  };
}

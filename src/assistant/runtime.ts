import { getCapabilityDefinition } from './capabilities';
import { applyStoredCorrections, parseCorrectionIntent } from './correctionMemory';
import { classifyConfirmationReply } from './confirmation';
import { normaliseDialogState, rememberEntities, rememberPlan, withPendingConfirmation } from './dialogState';
import { executeActionPlan } from './executor';
import {
  buildExecutionFacts,
  buildExecutionFallbackMessage,
  buildPendingConfirmation,
  buildToolResultFacts,
  narrateAssistantOutcome,
  needsConfirmation,
  runAssistantInitialModelTurn,
} from './orchestrator';
import { resetOllamaAvailability, isOllamaAvailable } from './planner';
import type { ActionPlan } from './plannerSchema';
import { recordAssistantDebugTrace } from '../services/assistantDebug';
import type {
  AssistantCommandContext,
  AssistantCommandOptions,
  AssistantCommandResult,
  AssistantEntityReference,
  AssistantLang,
  AssistantModelTurn,
  AssistantToolCall,
} from './shared';

function buildReplyPlan(
  mode: ActionPlan['mode'],
  response: string,
  toolCalls: AssistantToolCall[] = [],
): ActionPlan {
  return {
    mode,
    response,
    confidence: 1,
    steps: toolCalls.map(toolCall => ({
      capability: toolCall.capability,
      args: toolCall.args,
      unresolved: toolCall.unresolved,
      requiresConfirmation: toolCall.requiresConfirmation,
    })),
  };
}

function buildModelTurnPlan(
  modelTurn: AssistantModelTurn | null | undefined,
  fallbackResponse: string,
  fallbackMode: ActionPlan['mode'] = 'answer',
): ActionPlan {
  if (!modelTurn) {
    return buildReplyPlan(fallbackMode, fallbackResponse);
  }

  return buildReplyPlan(
    modelTurn.mode === 'reply'
      ? 'answer'
      : modelTurn.mode === 'clarify'
        ? 'clarify'
        : modelTurn.mode === 'confirm'
          ? 'confirm'
          : 'act',
    modelTurn.assistantMessage || fallbackResponse,
    modelTurn.toolCalls,
  );
}

function buildLocalConfirmationFallback(toolCalls: AssistantToolCall[], lang: AssistantLang): string {
  if (toolCalls.length === 0) {
    return lang === 'ar' ? 'هل تريدين أن أتابع؟' : 'Do you want me to continue?';
  }

  if (toolCalls.length === 1) {
    const capability = getCapabilityDefinition(toolCalls[0].capability);
    return lang === 'ar'
      ? `هل تريدين أن أنفذ ${capability.title}؟`
      : `Do you want me to ${capability.title.toLowerCase()}?`;
  }

  return lang === 'ar'
    ? `هل تريدين أن أنفذ هذه الإجراءات وعددها ${toolCalls.length}؟`
    : `Do you want me to carry out these ${toolCalls.length} actions?`;
}

function mergeReferencedEntities(
  ...groups: Array<AssistantEntityReference[] | undefined>
): AssistantEntityReference[] {
  const merged = new Map<string, AssistantEntityReference>();
  for (const group of groups) {
    for (const entity of group || []) {
      merged.set(`${entity.kind}:${entity.id}`, entity);
    }
  }
  return [...merged.values()];
}

function resolveTurnSource(
  preferred: AssistantCommandResult['source'],
  fallback: AssistantCommandResult['source'],
): AssistantCommandResult['source'] {
  return preferred === 'local' && fallback !== 'degraded'
    ? fallback
    : preferred;
}

function toToolCallSummary(toolCalls: AssistantToolCall[]) {
  return toolCalls.map(toolCall => ({
    callId: toolCall.callId,
    capability: toolCall.capability,
    args: toolCall.args,
  }));
}

export async function runAssistantTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: AssistantCommandOptions = {},
): Promise<AssistantCommandResult> {
  const lang = options.lang || 'en';
  const dialogState = normaliseDialogState(options.dialogState, context.currentSurface);
  const correctionIntent = parseCorrectionIntent(transcript, lang, options.conversationHistory);
  const correctionDrafts = correctionIntent?.learnedCorrections || [];

  for (const correction of correctionDrafts) {
    options.handlers?.upsertAssistantCorrection?.(correction);
  }

  const correctedTranscript = correctionIntent?.correctedTranscript || transcript;
  const correctionApplication = applyStoredCorrections(correctedTranscript, options.corrections, lang);
  const effectiveTranscript = correctionApplication.transcript;
  for (const id of correctionApplication.appliedCorrectionIds) {
    options.handlers?.noteAssistantCorrectionApplied?.(id);
  }

  const finalize = (result: AssistantCommandResult): AssistantCommandResult => {
    recordAssistantDebugTrace({
      recordedAt: new Date().toISOString(),
      transcript,
      effectiveTranscript,
      assistantMessage: result.assistantMessage,
      source: result.source,
      planningSource: result.planningSource,
      planningStatus: result.planningStatus,
      planningModel: result.planningModel,
      degradedReason: result.degradedReason,
      planningBundle: result.planningBundle,
      rawPlannerResponse: result.rawPlannerResponse,
      rawNarrationResponse: result.rawNarrationResponse,
      modelTurn: result.modelTurn,
      parsedPlan: result.parsedPlan,
      validatedPlan: result.validatedPlan,
      plannerValidation: result.plannerValidation,
      plan: result.plan,
      toolCalls: result.toolCalls,
      pendingConfirmation: result.dialogState.pendingConfirmation,
      execution: result.execution,
      referencedEntities: result.referencedEntities,
      navigationRequests: result.execution?.navigationRequests,
    });
    return result;
  };

  async function narrateFromFacts(
    planningSource: AssistantCommandResult['planningSource'],
    payload: Record<string, unknown>,
    localFallback: string,
  ) {
    return narrateAssistantOutcome({
      lang,
      conversationHistory: options.conversationHistory,
      planningSource,
      hostedModel: options.hostedModel,
      endpoint: options.endpoint,
      ollamaModel: options.ollamaModel || options.model,
    }, payload, localFallback);
  }

  if (dialogState.pendingConfirmation) {
    const pending = dialogState.pendingConfirmation;
    const confirmationIntent = classifyConfirmationReply(effectiveTranscript, lang);

    if (confirmationIntent === 'confirm') {
      const pendingPlan = buildReplyPlan('act', pending.assistantMessage, pending.toolCalls);
      const clearedDialogState = withPendingConfirmation(dialogState, undefined);

      if (!options.handlers) {
        const narration = await narrateFromFacts(
          pending.source,
          {
            transcript: effectiveTranscript,
            turnState: 'blocked',
            reason: 'Execution handlers are unavailable.',
            pendingToolCalls: toToolCallSummary(pending.toolCalls),
          },
          lang === 'ar'
            ? 'أحتاج إلى معالجات التنفيذ قبل أن أتمكن من المتابعة.'
            : 'I need execution handlers before I can continue.',
        );
        const plan = buildReplyPlan('answer', narration.assistantMessage);
        const updatedDialogState = rememberPlan(clearedDialogState, plan);
        return finalize({
          assistantMessage: narration.assistantMessage,
          message: narration.assistantMessage,
          plan,
          dialogState: updatedDialogState,
          source: resolveTurnSource(narration.source, 'local'),
          planningSource: pending.source,
          planningStatus: 'local_confirmation',
          planningModel: pending.planningModel,
          rawNarrationResponse: narration.rawNarrationResponse,
        });
      }

      const execution = executeActionPlan(
        pendingPlan,
        context,
        options.handlers,
        lang,
        clearedDialogState,
        pending.toolCalls,
      );

      if (execution.kind === 'clarify') {
        const narration = await narrateFromFacts(
          pending.source,
          {
            transcript: effectiveTranscript,
            turnState: 'clarify',
            clarifyReason: execution.reason,
            pendingToolCalls: toToolCallSummary(pending.toolCalls),
            pendingReferencedEntities: pending.referencedEntities,
          },
          execution.reason,
        );
        const plan = buildReplyPlan('clarify', narration.assistantMessage);
        const updatedDialogState = rememberPlan(clearedDialogState, plan);
        return finalize({
          assistantMessage: narration.assistantMessage,
          message: narration.assistantMessage,
          plan,
          dialogState: updatedDialogState,
          referencedEntities: pending.referencedEntities,
          source: resolveTurnSource(narration.source, 'local'),
          planningSource: pending.source,
          planningStatus: 'local_confirmation',
          planningModel: pending.planningModel,
          rawNarrationResponse: narration.rawNarrationResponse,
          toolCalls: pending.toolCalls,
        });
      }

      const toolResults = buildToolResultFacts(execution.execution.toolResults);
      const executionResult = {
        ...execution.execution,
        toolResults,
      };
      const referencedEntities = mergeReferencedEntities(
        pending.referencedEntities,
        execution.referencedEntities,
      );
      const narration = await narrateFromFacts(
        pending.source,
        {
          transcript: effectiveTranscript,
          turnState: 'executed',
          confirmationReply: effectiveTranscript,
          requestedToolCalls: toToolCallSummary(pending.toolCalls),
          referencedEntities,
          ...buildExecutionFacts(toolResults),
        },
        buildExecutionFallbackMessage(toolResults, executionResult.steps.at(-1)?.summary || 'Done.'),
      );
      const updatedDialogState = rememberEntities(
        rememberPlan(clearedDialogState, pendingPlan),
        referencedEntities,
      );

      return finalize({
        assistantMessage: narration.assistantMessage,
        message: narration.assistantMessage,
        plan: pendingPlan,
        dialogState: updatedDialogState,
        execution: executionResult,
        referencedEntities,
        source: resolveTurnSource(narration.source, pending.source === 'openai' ? 'openai' : 'ollama'),
        planningSource: pending.source,
        planningStatus: 'local_confirmation',
        planningModel: pending.planningModel,
        rawNarrationResponse: narration.rawNarrationResponse,
        toolCalls: pending.toolCalls,
      });
    }

    if (confirmationIntent === 'deny') {
      const clearedDialogState = withPendingConfirmation(dialogState, undefined);
      const narration = await narrateFromFacts(
        pending.source,
        {
          transcript: effectiveTranscript,
          turnState: 'cancelled',
          cancellationReply: effectiveTranscript,
          pendingToolCalls: toToolCallSummary(pending.toolCalls),
          pendingReferencedEntities: pending.referencedEntities,
        },
        lang === 'ar' ? 'حسناً، لن أفعل ذلك.' : "Okay, I won't do that.",
      );
      const plan = buildReplyPlan('answer', narration.assistantMessage);
      const updatedDialogState = rememberPlan(clearedDialogState, plan);
      return finalize({
        assistantMessage: narration.assistantMessage,
        message: narration.assistantMessage,
        plan,
        dialogState: updatedDialogState,
        referencedEntities: pending.referencedEntities,
        source: resolveTurnSource(narration.source, 'local'),
        planningSource: pending.source,
        planningStatus: 'local_confirmation',
        planningModel: pending.planningModel,
        rawNarrationResponse: narration.rawNarrationResponse,
        toolCalls: pending.toolCalls,
      });
    }
  }

  const planning = await runAssistantInitialModelTurn(effectiveTranscript, context, {
    lang,
    conversationHistory: options.conversationHistory,
    provider: options.provider,
    hostedModel: options.hostedModel,
    endpoint: options.endpoint,
    ollamaModel: options.ollamaModel || options.model,
    dialogState,
    pendingConfirmation: dialogState.pendingConfirmation,
  });

  const resolvedToolCalls = planning.toolCalls || planning.modelTurn?.toolCalls || [];
  const resultPlan = planning.validatedPlan
    || planning.parsedPlan
    || buildModelTurnPlan(planning.modelTurn, planning.assistantMessage, 'clarify');

  if (planning.planningStatus !== 'planned') {
    const nextDialogState = rememberEntities(
      rememberPlan(withPendingConfirmation(dialogState, undefined), resultPlan),
      planning.referencedEntities,
    );
    return finalize({
      assistantMessage: planning.assistantMessage,
      message: planning.assistantMessage,
      plan: resultPlan,
      modelTurn: planning.modelTurn,
      toolCalls: resolvedToolCalls,
      dialogState: nextDialogState,
      referencedEntities: planning.referencedEntities,
      degradedReason: planning.degradedReason,
      source: planning.source,
      planningSource: planning.planningSource,
      planningStatus: planning.planningStatus,
      planningModel: planning.planningModel,
      planningBundle: planning.planningBundle,
      rawPlannerResponse: planning.rawPlannerResponse,
      parsedPlan: planning.parsedPlan,
      validatedPlan: planning.validatedPlan,
      plannerValidation: planning.plannerValidation,
    });
  }

  if (planning.modelTurn?.mode === 'reply' || planning.modelTurn?.mode === 'clarify' || resolvedToolCalls.length === 0) {
    const nextDialogState = rememberEntities(
      rememberPlan(withPendingConfirmation(dialogState, undefined), resultPlan),
      planning.referencedEntities,
    );
    return finalize({
      assistantMessage: planning.assistantMessage,
      message: planning.assistantMessage,
      plan: resultPlan,
      modelTurn: planning.modelTurn,
      toolCalls: resolvedToolCalls,
      dialogState: nextDialogState,
      referencedEntities: planning.referencedEntities,
      degradedReason: planning.degradedReason,
      source: planning.source,
      planningSource: planning.planningSource,
      planningStatus: planning.planningStatus,
      planningModel: planning.planningModel,
      planningBundle: planning.planningBundle,
      rawPlannerResponse: planning.rawPlannerResponse,
      parsedPlan: planning.parsedPlan,
      validatedPlan: planning.validatedPlan,
      plannerValidation: planning.plannerValidation,
    });
  }

  if (planning.modelTurn?.mode === 'confirm' || needsConfirmation(resolvedToolCalls)) {
    const confirmationNarration = !planning.assistantMessage
      ? await narrateFromFacts(
          planning.planningSource,
          {
            transcript: effectiveTranscript,
            turnState: 'awaiting_confirmation',
            requestedToolCalls: toToolCallSummary(resolvedToolCalls),
            referencedEntities: planning.referencedEntities,
          },
          buildLocalConfirmationFallback(resolvedToolCalls, lang),
        )
      : null;
    const confirmationMessage = planning.assistantMessage || confirmationNarration?.assistantMessage || buildLocalConfirmationFallback(resolvedToolCalls, lang);
    const pendingConfirmation = buildPendingConfirmation(
      confirmationMessage,
      resolvedToolCalls,
      planning.referencedEntities || [],
      planning.planningSource,
      planning.planningModel,
    );
    const confirmationPlan = buildReplyPlan('confirm', confirmationMessage, resolvedToolCalls);
    const nextDialogState = withPendingConfirmation(
      rememberEntities(rememberPlan(dialogState, confirmationPlan), planning.referencedEntities),
      pendingConfirmation,
    );

    return finalize({
      assistantMessage: confirmationMessage,
      message: confirmationMessage,
      plan: confirmationPlan,
      modelTurn: planning.modelTurn,
      toolCalls: resolvedToolCalls,
      dialogState: nextDialogState,
      referencedEntities: planning.referencedEntities,
      degradedReason: planning.degradedReason,
      source: confirmationNarration
        ? resolveTurnSource(confirmationNarration.source, planning.source)
        : planning.source,
      planningSource: planning.planningSource,
      planningStatus: planning.planningStatus,
      planningModel: planning.planningModel,
      planningBundle: planning.planningBundle,
      rawPlannerResponse: planning.rawPlannerResponse,
      rawNarrationResponse: confirmationNarration?.rawNarrationResponse,
      parsedPlan: planning.parsedPlan,
      validatedPlan: planning.validatedPlan,
      plannerValidation: planning.plannerValidation,
    });
  }

  if (!options.handlers) {
    const narration = await narrateFromFacts(
      planning.planningSource,
      {
        transcript: effectiveTranscript,
        turnState: 'blocked',
        reason: 'Execution handlers are unavailable.',
        requestedToolCalls: toToolCallSummary(resolvedToolCalls),
      },
      lang === 'ar'
        ? 'أحتاج إلى معالجات التنفيذ قبل أن أتمكن من المتابعة.'
        : 'I need execution handlers before I can continue.',
    );
    const blockedPlan = buildReplyPlan('answer', narration.assistantMessage);
    const nextDialogState = rememberPlan(withPendingConfirmation(dialogState, undefined), blockedPlan);
    return finalize({
      assistantMessage: narration.assistantMessage,
      message: narration.assistantMessage,
      plan: blockedPlan,
      modelTurn: planning.modelTurn,
      toolCalls: resolvedToolCalls,
      dialogState: nextDialogState,
      referencedEntities: planning.referencedEntities,
      degradedReason: planning.degradedReason,
      source: resolveTurnSource(narration.source, 'local'),
      planningSource: planning.planningSource,
      planningStatus: planning.planningStatus,
      planningModel: planning.planningModel,
      planningBundle: planning.planningBundle,
      rawPlannerResponse: planning.rawPlannerResponse,
      rawNarrationResponse: narration.rawNarrationResponse,
      parsedPlan: planning.parsedPlan,
      validatedPlan: planning.validatedPlan,
      plannerValidation: planning.plannerValidation,
    });
  }

  const execution = executeActionPlan(
    resultPlan,
    context,
    options.handlers,
    lang,
    dialogState,
    resolvedToolCalls,
  );

  if (execution.kind === 'clarify') {
    const narration = await narrateFromFacts(
      planning.planningSource,
      {
        transcript: effectiveTranscript,
        turnState: 'clarify',
        clarifyReason: execution.reason,
        requestedToolCalls: toToolCallSummary(resolvedToolCalls),
        referencedEntities: planning.referencedEntities,
      },
      execution.reason,
    );
    const clarifyPlan = buildReplyPlan('clarify', narration.assistantMessage);
    const nextDialogState = rememberPlan(withPendingConfirmation(dialogState, undefined), clarifyPlan);
    return finalize({
      assistantMessage: narration.assistantMessage,
      message: narration.assistantMessage,
      plan: clarifyPlan,
      modelTurn: planning.modelTurn,
      toolCalls: resolvedToolCalls,
      dialogState: nextDialogState,
      referencedEntities: planning.referencedEntities,
      degradedReason: planning.degradedReason,
      source: resolveTurnSource(narration.source, planning.source),
      planningSource: planning.planningSource,
      planningStatus: planning.planningStatus,
      planningModel: planning.planningModel,
      planningBundle: planning.planningBundle,
      rawPlannerResponse: planning.rawPlannerResponse,
      rawNarrationResponse: narration.rawNarrationResponse,
      parsedPlan: planning.parsedPlan,
      validatedPlan: planning.validatedPlan,
      plannerValidation: planning.plannerValidation,
    });
  }

  const toolResults = buildToolResultFacts(execution.execution.toolResults);
  const executionResult = {
    ...execution.execution,
    toolResults,
  };
  const referencedEntities = mergeReferencedEntities(
    planning.referencedEntities,
    execution.referencedEntities,
  );
  const narration = await narrateFromFacts(
    planning.planningSource,
    {
      transcript: effectiveTranscript,
      turnState: 'executed',
      requestedToolCalls: toToolCallSummary(resolvedToolCalls),
      referencedEntities,
      ...buildExecutionFacts(toolResults),
    },
    buildExecutionFallbackMessage(toolResults, executionResult.steps.at(-1)?.summary || 'Done.'),
  );
  const nextDialogState = rememberEntities(
    rememberPlan(withPendingConfirmation(dialogState, undefined), resultPlan),
    referencedEntities,
  );

  return finalize({
    assistantMessage: narration.assistantMessage,
    message: narration.assistantMessage,
    plan: resultPlan,
    modelTurn: planning.modelTurn,
    toolCalls: resolvedToolCalls,
    dialogState: nextDialogState,
    execution: executionResult,
    referencedEntities,
    degradedReason: planning.degradedReason,
    source: resolveTurnSource(narration.source, planning.source),
    planningSource: planning.planningSource,
    planningStatus: planning.planningStatus,
    planningModel: planning.planningModel,
    planningBundle: planning.planningBundle,
    rawPlannerResponse: planning.rawPlannerResponse,
    rawNarrationResponse: narration.rawNarrationResponse,
    parsedPlan: planning.parsedPlan,
    validatedPlan: planning.validatedPlan,
    plannerValidation: planning.plannerValidation,
  });
}

export { isOllamaAvailable, resetOllamaAvailability };

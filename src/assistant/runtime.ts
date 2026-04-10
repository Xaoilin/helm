import { getCapabilityDefinition, isCapabilityLive } from './capabilities';
import { applyStoredCorrections, parseCorrectionIntent } from './correctionMemory';
import { normaliseDialogState, rememberEntities, rememberPlan, withPendingConfirmation } from './dialogState';
import { executeActionPlan } from './executor';
import { planAssistantTurn, resetOllamaAvailability, isOllamaAvailable } from './planner';
import { recordAssistantDebugTrace } from '../services/assistantDebug';
import type { AssistantCommandContext, AssistantCommandOptions, AssistantCommandResult, AssistantDialogState, AssistantLang } from './shared';

function isAffirmative(text: string): boolean {
  return /^(?:yes|yeah|yep|please do|do it|go ahead|ok|okay|sure|نعم|أكيد|تمام)$/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(?:no|nope|cancel|stop|never mind|لا|إلغاء|خلاص)$/i.test(text.trim());
}

function defaultConfirmResponse(plan: AssistantDialogState['pendingConfirmation'], lang: AssistantLang): string {
  if (!plan || plan.steps.length === 0) {
    return lang === 'ar' ? 'هل تريدين أن أتابع؟' : 'Do you want me to continue?';
  }

  const step = plan.steps[0];
  const capability = getCapabilityDefinition(step.capability);
  return lang === 'ar'
    ? `أستطيع تنفيذ ${capability.title}. هل تريدين أن أفعل ذلك؟`
    : `I can ${capability.title.toLowerCase()}. Do you want me to do that?`;
}

export async function runAssistantTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: AssistantCommandOptions = {},
): Promise<AssistantCommandResult> {
  const lang = options.lang || 'en';
  let dialogState = normaliseDialogState(options.dialogState, context.currentSurface);
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
  const learnedCorrectionPrefix = correctionDrafts.length > 0
    ? lang === 'ar'
      ? 'سأتذكر هذا. '
      : "Thanks, I'll remember that. "
    : '';
  const finalize = (result: AssistantCommandResult): AssistantCommandResult => {
    recordAssistantDebugTrace({
      recordedAt: new Date().toISOString(),
      transcript,
      effectiveTranscript,
      source: result.source,
      degradedReason: result.degradedReason,
      plan: result.plan,
      execution: result.execution,
      referencedEntities: result.referencedEntities,
      navigationRequests: result.execution?.navigationRequests,
    });
    return result;
  };

  if (dialogState.pendingConfirmation) {
    if (isAffirmative(effectiveTranscript)) {
      if (!options.handlers) {
        const cleared = withPendingConfirmation(dialogState, undefined);
        return finalize({
          message: lang === 'ar' ? 'أحتاج إلى معالجات التنفيذ قبل أن أتمكن من المتابعة.' : 'I need execution handlers before I can continue.',
          plan: dialogState.pendingConfirmation,
          dialogState: cleared,
          source: 'local',
        });
      }

      const pendingPlan = dialogState.pendingConfirmation;
      const cleared = withPendingConfirmation(dialogState, undefined);
      const execution = executeActionPlan(pendingPlan, context, options.handlers, lang, cleared);
      if (execution.kind === 'clarify') {
        return finalize({
          message: execution.message,
          plan: { ...pendingPlan, mode: 'clarify', response: execution.message, steps: [] },
          dialogState: cleared,
          source: 'local',
        });
      }

      const updatedDialogState = rememberEntities(rememberPlan(cleared, pendingPlan), execution.referencedEntities);
      return finalize({
        message: execution.message,
        plan: pendingPlan,
        dialogState: updatedDialogState,
        execution: execution.execution,
        referencedEntities: execution.referencedEntities,
        source: 'local',
      });
    }

    if (isNegative(effectiveTranscript)) {
      const cleared = withPendingConfirmation(dialogState, undefined);
      const response = lang === 'ar' ? 'حسناً، ألغيت ذلك.' : 'Okay, I cancelled that.';
      return finalize({
        message: response,
        plan: { mode: 'answer', response, confidence: 1, steps: [] },
        dialogState: cleared,
        source: 'local',
      });
    }
  }

  const planning = await planAssistantTurn(effectiveTranscript, context, {
    lang,
    conversationHistory: options.conversationHistory,
    provider: options.provider,
    endpoint: options.endpoint,
    model: options.model,
    dialogState,
  });

  const plan = planning.plan;
  dialogState = rememberPlan(dialogState, plan);

  const unavailableStep = plan.steps.find(step => !isCapabilityLive(step.capability));
  if (unavailableStep) {
    const clarifyPlan = {
      mode: 'clarify' as const,
      response: lang === 'ar'
        ? 'هذا الإجراء غير متاح بعد، لذلك لن أنفذ شيئاً مختلفاً عنه.'
        : 'That action is not available yet, so I will not approximate it to something else.',
      confidence: plan.confidence,
      steps: [],
    };
    dialogState = rememberPlan(dialogState, clarifyPlan);
    return finalize({
      message: clarifyPlan.response,
      plan: clarifyPlan,
      dialogState,
      source: 'local',
    });
  }

  const requiresConfirmation = plan.steps.some(step =>
    step.requiresConfirmation || getCapabilityDefinition(step.capability).confirmationRule === 'always',
  );

  if (plan.mode === 'confirm' || (plan.mode === 'act' && requiresConfirmation)) {
    const confirmationPlan = { ...plan, mode: 'act' as const };
    dialogState = withPendingConfirmation(dialogState, confirmationPlan);
    const confirmationMessage = `${learnedCorrectionPrefix}${plan.response || defaultConfirmResponse(confirmationPlan, lang)}`.trim();
    return finalize({
      message: confirmationMessage,
      plan: { ...plan, mode: 'confirm' },
      dialogState,
      referencedEntities: planning.referencedEntities,
      source: planning.source,
      degradedReason: planning.degradedReason,
    });
  }

  if (plan.mode !== 'act' || !options.handlers) {
    dialogState = rememberEntities(dialogState, planning.referencedEntities);
    return finalize({
      message: `${learnedCorrectionPrefix}${plan.response}`.trim(),
      plan,
      dialogState,
      referencedEntities: planning.referencedEntities,
      source: planning.source,
      degradedReason: planning.degradedReason,
    });
  }

  const execution = executeActionPlan(plan, context, options.handlers, lang, dialogState);
  if (execution.kind === 'clarify') {
    const clarifyPlan = {
      mode: 'clarify' as const,
      response: `${learnedCorrectionPrefix}${execution.message}`.trim(),
      confidence: plan.confidence,
      steps: [],
    };
    dialogState = rememberPlan(dialogState, clarifyPlan);
    return finalize({
      message: clarifyPlan.response,
      plan: clarifyPlan,
      dialogState,
      source: 'local',
    });
  }

  dialogState = rememberEntities(dialogState, [
    ...(planning.referencedEntities || []),
    ...execution.referencedEntities,
  ]);

  return finalize({
    message: `${learnedCorrectionPrefix}${execution.message}`.trim(),
    plan,
    dialogState,
    execution: execution.execution,
    referencedEntities: execution.referencedEntities,
    source: planning.source,
    degradedReason: planning.degradedReason,
  });
}

export { isOllamaAvailable, resetOllamaAvailability };

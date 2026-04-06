import { getCapabilityDefinition } from './capabilities';
import { normaliseDialogState, rememberEntities, rememberPlan, withPendingConfirmation } from './dialogState';
import { executeActionPlan } from './executor';
import { planAssistantTurn, resetOllamaAvailability, isOllamaAvailable } from './planner';
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

  if (dialogState.pendingConfirmation) {
    if (isAffirmative(transcript)) {
      if (!options.handlers) {
        const cleared = withPendingConfirmation(dialogState, undefined);
        return {
          message: lang === 'ar' ? 'أحتاج إلى معالجات التنفيذ قبل أن أتمكن من المتابعة.' : 'I need execution handlers before I can continue.',
          plan: dialogState.pendingConfirmation,
          dialogState: cleared,
          source: 'local',
        };
      }

      const pendingPlan = dialogState.pendingConfirmation;
      const cleared = withPendingConfirmation(dialogState, undefined);
      const execution = executeActionPlan(pendingPlan, context, options.handlers, lang);
      if (execution.kind === 'clarify') {
        return {
          message: execution.message,
          plan: { ...pendingPlan, mode: 'clarify', response: execution.message, steps: [] },
          dialogState: cleared,
          source: 'local',
        };
      }

      const updatedDialogState = rememberEntities(rememberPlan(cleared, pendingPlan), execution.referencedEntities);
      return {
        message: execution.message,
        plan: pendingPlan,
        dialogState: updatedDialogState,
        execution: execution.execution,
        referencedEntities: execution.referencedEntities,
        source: 'local',
      };
    }

    if (isNegative(transcript)) {
      const cleared = withPendingConfirmation(dialogState, undefined);
      const response = lang === 'ar' ? 'حسناً، ألغيت ذلك.' : 'Okay, I cancelled that.';
      return {
        message: response,
        plan: { mode: 'answer', response, confidence: 1, steps: [] },
        dialogState: cleared,
        source: 'local',
      };
    }
  }

  const planning = await planAssistantTurn(transcript, context, {
    lang,
    conversationHistory: options.conversationHistory,
    endpoint: options.endpoint,
    model: options.model,
    dialogState,
  });

  const plan = planning.plan;
  dialogState = rememberPlan(dialogState, plan);

  const requiresConfirmation = plan.steps.some(step =>
    step.requiresConfirmation || getCapabilityDefinition(step.capability).confirmationRule === 'always',
  );

  if (plan.mode === 'confirm' || (plan.mode === 'act' && requiresConfirmation)) {
    const confirmationPlan = { ...plan, mode: 'act' as const };
    dialogState = withPendingConfirmation(dialogState, confirmationPlan);
    return {
      message: plan.response || defaultConfirmResponse(confirmationPlan, lang),
      plan: { ...plan, mode: 'confirm' },
      dialogState,
      referencedEntities: planning.referencedEntities,
      source: planning.source,
      degradedReason: planning.degradedReason,
    };
  }

  if (plan.mode !== 'act' || !options.handlers) {
    dialogState = rememberEntities(dialogState, planning.referencedEntities);
    return {
      message: plan.response,
      plan,
      dialogState,
      referencedEntities: planning.referencedEntities,
      source: planning.source,
      degradedReason: planning.degradedReason,
    };
  }

  const execution = executeActionPlan(plan, context, options.handlers, lang);
  if (execution.kind === 'clarify') {
    const clarifyPlan = {
      mode: 'clarify' as const,
      response: execution.message,
      confidence: plan.confidence,
      steps: [],
    };
    dialogState = rememberPlan(dialogState, clarifyPlan);
    return {
      message: execution.message,
      plan: clarifyPlan,
      dialogState,
      source: 'local',
    };
  }

  dialogState = rememberEntities(dialogState, [
    ...(planning.referencedEntities || []),
    ...execution.referencedEntities,
  ]);

  return {
    message: execution.message,
    plan,
    dialogState,
    execution: execution.execution,
    referencedEntities: execution.referencedEntities,
    source: planning.source,
    degradedReason: planning.degradedReason,
  };
}

export { isOllamaAvailable, resetOllamaAvailability };

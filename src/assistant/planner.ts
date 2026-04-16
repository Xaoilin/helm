import type { AssistantProvider, CalendarSource, FinanceAccount, KnowledgeTopic, Task } from '../types/domain';
import { DEFAULT_ASSISTANT_PROVIDER, HOSTED_ASSISTANT_MODEL, OLLAMA_ENDPOINT } from '../config';
import { LIMITS, TIMING } from '../config/constants';
import { chatWithHostedAssistant, testHostedAssistantConnection } from '../services/hostedAssistantApi';
import { chatWithOllama, testOllamaConnection, type OllamaMessage } from '../services/ollamaApi';
import {
  getCapabilityDefinition,
  getLiveCapabilityDefinitions,
  listCapabilitiesForPrompt,
  type CapabilityDefinition,
  type CapabilityId,
} from './capabilities';
import { retrieveBenchmarkExamples } from './evals/benchmarkCorpus';
import {
  SURFACE_LABELS,
  makeEntityReference,
  resolveCalendarEventReference,
  resolveCalendarSourceReference,
  resolveFinanceAccountReference,
  resolveKnowledgeTopicReference,
  resolveProjectReference,
  resolveSurfaceReference,
  resolveTaskReference,
} from './entityResolver';
import { buildActionPlanJsonSchema, parseActionPlan, type ActionPlan } from './plannerSchema';
import type {
  AssistantCommandContext,
  AssistantConversationMessage,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantLang,
  AssistantPlannerValidation,
  AssistantPlanningBundle,
  AssistantPlanningCapabilityCandidate,
  AssistantPlanningEntityCandidate,
} from './shared';
import { extractTemporalReference } from './temporalResolver';

export interface PlannerResult {
  plan: ActionPlan;
  referencedEntities?: AssistantEntityReference[];
  source: 'ollama' | 'openai' | 'degraded';
  degradedReason?:
    | 'ollama_offline'
    | 'ollama_error'
    | 'hosted_sign_in_required'
    | 'hosted_not_configured'
    | 'hosted_error'
    | 'unsupported_without_ai';
  planningSource: 'openai' | 'ollama' | 'none';
  planningStatus: 'planned' | 'blocked_provider_unavailable' | 'model_response_invalid' | 'validator_rejected';
  planningModel?: string;
  planningBundle?: AssistantPlanningBundle;
  rawPlannerResponse?: string;
  parsedPlan?: ActionPlan | null;
  validatedPlan?: ActionPlan | null;
  plannerValidation?: AssistantPlannerValidation;
}

type PlannerProvider = 'hosted' | 'ollama';
type GuardrailIntent =
  | 'delete_task'
  | 'complete_task'
  | 'reveal_task'
  | 'task_view'
  | 'navigate'
  | 'create_event'
  | 'reschedule_event'
  | 'record_transaction'
  | 'create_knowledge'
  | 'create_task'
  | null;
type UnsupportedGuardrail = 'device_control' | null;

const DEFAULT_OLLAMA_MODEL = 'qwen3';
const MAX_CANDIDATES = 5;
const MAX_CAPABILITIES = 6;
const RISKY_CAPABILITY_IDS = new Set(
  getLiveCapabilityDefinitions()
    .filter(capability => capability.confirmationRule === 'always')
    .map(capability => capability.id as CapabilityId),
);

const RESPONSES = {
  ollamaOffline: {
    en: 'Ollama is offline, so I cannot safely plan or execute that request right now.',
    ar: 'Ollama غير متصل، لذلك لا أستطيع التخطيط لهذا الطلب أو تنفيذه بأمان الآن.',
  },
  hostedSignInRequired: {
    en: 'Hosted AI needs sign-in before I can safely plan or execute that request.',
    ar: 'الذكاء الاصطناعي المستضاف يحتاج إلى تسجيل الدخول قبل أن أستطيع التخطيط لهذا الطلب أو تنفيذه بأمان.',
  },
  hostedNotConfigured: {
    en: 'Hosted AI is not configured in this build, so I cannot safely plan that request.',
    ar: 'الذكاء الاصطناعي المستضاف غير مُعدّ في هذا الإصدار، لذلك لا أستطيع التخطيط لهذا الطلب بأمان.',
  },
  hostedError: {
    en: (message: string) => `I couldn't reach the hosted planner (${message}), so I didn't guess or run anything.`,
    ar: (message: string) => `تعذر عليّ الوصول إلى المخطط المستضاف (${message})، لذلك لم أخمّن ولم أنفذ شيئاً.`,
  },
  ollamaError: {
    en: (message: string) => `I couldn't reach Ollama (${message}), so I didn't guess or run anything.`,
    ar: (message: string) => `تعذر عليّ الوصول إلى Ollama (${message})، لذلك لم أخمّن ولم أنفذ شيئاً.`,
  },
  hostedInvalidStructuredResponse: {
    en: "I had trouble interpreting the hosted planner's response, so I didn't run anything.",
    ar: 'واجهت مشكلة في تفسير رد المخطط المستضاف، لذلك لم أنفذ أي شيء.',
  },
  ollamaInvalidStructuredResponse: {
    en: "I had trouble interpreting Ollama's planner response, so I didn't run anything.",
    ar: 'واجهت مشكلة في تفسير رد المخطط من Ollama، لذلك لم أنفذ أي شيء.',
  },
  noLivePlanner: {
    en: 'No live AI planner is available, so I cannot safely carry out that request right now.',
    ar: 'لا يوجد مخطط ذكاء اصطناعي مباشر متاح الآن، لذلك لا أستطيع تنفيذ هذا الطلب بأمان.',
  },
  deleteClarify: {
    en: 'Which task should I delete?',
    ar: 'أي مهمة تريدين حذفها؟',
  },
  revealClarify: {
    en: 'Which task should I show you?',
    ar: 'أي مهمة تريدين أن أعرضها؟',
  },
  completeClarify: {
    en: 'Which task should I complete?',
    ar: 'أي مهمة تريدين إكمالها؟',
  },
  eventTimeClarify: {
    en: 'When should I schedule it?',
    ar: 'متى تريدين أن أحدده؟',
  },
  rescheduleClarify: {
    en: 'What time should I move it to?',
    ar: 'إلى أي وقت تريدين نقله؟',
  },
  knowledgeClarify: {
    en: 'Which knowledge topic should I save that under?',
    ar: 'تحت أي موضوع معرفة تريدين حفظ هذا؟',
  },
  financeClarify: {
    en: 'Which finance account should I use?',
    ar: 'أي حساب مالي تريدين أن أستخدمه؟',
  },
  validatorRejected: {
    en: 'I did not get a safe grounded action plan for that request, so I need to clarify first.',
    ar: 'لم أحصل على خطة إجراء مؤرضة وآمنة لهذا الطلب، لذلك أحتاج إلى توضيح أولاً.',
  },
  unsupportedDeviceControl: {
    en: 'I can help inside HELM, but I cannot control device or internet settings from here.',
    ar: 'أستطيع المساعدة داخل HELM، لكن لا يمكنني التحكم في إعدادات الجهاز أو الإنترنت من هنا.',
  },
};

let cachedEndpoint: string | null = null;
let ollamaAvailability: boolean | null = null;
let hostedAvailability: 'available' | 'sign_in_required' | 'not_configured' | 'unavailable' | null = null;

function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(value: string): string[] {
  return normaliseText(value).split(' ').filter(Boolean);
}

function computeOverlapScore(query: string, candidate: string): number {
  const queryTokens = tokenise(query);
  const candidateTokens = tokenise(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter(token => candidateSet.has(token)).length;
  if (overlap === 0) return 0;

  return overlap / Math.max(queryTokens.length, candidateTokens.length);
}

function buildAnswerPlan(response: string): ActionPlan {
  return { mode: 'answer', response, confidence: 1, steps: [] };
}

function buildClarifyPlan(response: string): ActionPlan {
  return { mode: 'clarify', response, confidence: 0.7, steps: [] };
}

function getNow(context: AssistantCommandContext): Date {
  return context.now ? new Date(context.now) : new Date();
}

function pickDefaultCalendarSource(context: AssistantCommandContext): CalendarSource | null {
  if (context.calendarSources.length === 0) return null;

  const primaryAccount = context.calendarAccounts.find(account => account.isPrimary);
  if (primaryAccount) {
    const primarySource = context.calendarSources.find(source => source.accountId === primaryAccount.id);
    if (primarySource) return primarySource;
  }

  return context.calendarSources[0] || null;
}

function pickDefaultFinanceAccount(context: AssistantCommandContext): FinanceAccount | null {
  return context.financeAccounts.find(account => account.type === 'current')
    || context.financeAccounts.find(account => account.includeInNetWorth)
    || context.financeAccounts[0]
    || null;
}

function pickDefaultKnowledgeTopic(context: AssistantCommandContext): KnowledgeTopic | null {
  return context.knowledgeTopics.length === 1 ? context.knowledgeTopics[0] : null;
}

function derivePlannerHintIntent(transcript: string): GuardrailIntent {
  const lower = normaliseText(transcript);

  if (/(?:\bdelete\b|\bremove\b|\btrash\b|احذف|امسح|شيل)/i.test(lower)) return 'delete_task';
  if (/(?:\bcomplete\b|\bfinish\b|\bmark\b|\bcheck off\b|أكمل|انهِ|عل[ّم]?)/i.test(lower)) return 'complete_task';
  if (/^(?:show me|open|find|locate|pull up|take me to)\s+(?:that task|this task|that one|this one|it)\b/i.test(transcript.trim())) return 'reveal_task';
  if (/(?:show(?:\s+me)?|open|pull up|take me to|go to)\s+(?:all\s+tasks|all\s+my\s+tasks|my\s+tasks|task\s+list|my\s+goals|goals|today(?:'s)?\s+tasks|tasks\s+for\s+today|today(?:'s)?\s+habits)/i.test(lower)) return 'task_view';
  if (/(?:\bmove\b|\bpush\b|\breschedule\b)/i.test(lower)) return 'reschedule_event';
  if (/(?:\bschedule\b|\bcreate\b|\bbook\b|\badd\b).+\b(?:meeting|event|appointment|call|calendar)\b/i.test(lower)) return 'create_event';
  if (/(?:\bspent\b|\bpaid\b|\brecord\b|\blog\b|\bincome\b|\bexpense\b|\bearned\b|\breceived\b)/i.test(lower)) return 'record_transaction';
  if (/(?:\bsave\b|\bknowledge entry\b|\bknowledge note\b|\bcreate note\b|\badd note\b).+\b(?:topic|knowledge|note)\b/i.test(lower)) return 'create_knowledge';
  if (/(?:\badd task\b|\bcreate task\b|\bnew task\b|\bhabit\b|\bgoal\b)/i.test(lower)) return 'create_task';
  if (/(?:\bopen\b|\bgo to\b|\bswitch to\b|\btake me to\b|\bshow\b)/i.test(lower)) return 'navigate';
  return null;
}

function deriveGuardrailIntent(transcript: string): GuardrailIntent {
  const lower = normaliseText(transcript);
  return /(?:\bdelete\b|\bremove\b|\btrash\b|احذف|امسح|شيل)/i.test(lower) ? 'delete_task' : null;
}

function deriveUnsupportedGuardrail(transcript: string): UnsupportedGuardrail {
  const lower = normaliseText(transcript);
  if (/\bturn\b.+\b(?:off|on)\b/i.test(lower)) return 'device_control';
  if (/\bdo not disturb\b/i.test(lower)) return 'device_control';
  if (/\bplay\b/i.test(lower) && /\bspotify\b/i.test(lower)) return 'device_control';
  return null;
}

function guardrailCapabilityIds(intent: GuardrailIntent): CapabilityId[] {
  switch (intent) {
    case 'delete_task':
      return ['tasks.delete_matching'];
    case 'complete_task':
      return ['tasks.complete_matching'];
    case 'reveal_task':
      return ['tasks.reveal_task'];
    case 'task_view':
      return ['tasks.open_view'];
    case 'create_event':
      return ['calendar.create_event'];
    case 'reschedule_event':
      return ['calendar.reschedule_event'];
    case 'record_transaction':
      return ['finance.record_transaction'];
    case 'create_knowledge':
      return ['knowledge.create_entry'];
    case 'create_task':
      return ['tasks.create_task'];
    case 'navigate':
      return ['navigation.go_to_surface', 'tasks.open_view'];
    default:
      return [];
  }
}

function guardrailClarifyMessage(intent: GuardrailIntent, lang: AssistantLang): string {
  switch (intent) {
    case 'delete_task':
      return RESPONSES.deleteClarify[lang];
    case 'complete_task':
      return RESPONSES.completeClarify[lang];
    case 'reveal_task':
      return RESPONSES.revealClarify[lang];
    case 'create_event':
      return RESPONSES.eventTimeClarify[lang];
    case 'reschedule_event':
      return RESPONSES.rescheduleClarify[lang];
    case 'record_transaction':
      return RESPONSES.financeClarify[lang];
    case 'create_knowledge':
      return RESPONSES.knowledgeClarify[lang];
    default:
      return RESPONSES.validatorRejected[lang];
  }
}

function unsupportedGuardrailClarifyMessage(intent: UnsupportedGuardrail, lang: AssistantLang): string {
  switch (intent) {
    case 'device_control':
      return RESPONSES.unsupportedDeviceControl[lang];
    default:
      return RESPONSES.validatorRejected[lang];
  }
}

function looksLikeImperativeActionRequest(transcript: string): boolean {
  const lower = normaliseText(transcript);
  if (lower.endsWith('?')) return false;

  return /^(?:open|show|take|go|switch|add|create|make|delete|remove|trash|complete|finish|mark|check off|schedule|book|move|push|reschedule|record|log|save|email|text|call|post|send|order|reply|transfer|write|publish|sync|turn|start)\b/i.test(lower);
}

function capabilityScore(transcript: string, capability: CapabilityDefinition): number {
  const query = normaliseText(transcript);
  const texts = [
    capability.id,
    capability.title,
    capability.description,
    ...capability.examples,
    ...capability.aliases,
    capability.domain,
  ];

  const best = Math.max(...texts.map(text => computeOverlapScore(query, text)));
  if (best === 0) return 0;

  const bonus = capability.confirmationRule === 'always' && derivePlannerHintIntent(transcript) === 'delete_task' ? 0.2 : 0;
  return Math.min(1, best + bonus);
}

function buildCapabilityCandidates(transcript: string): CapabilityDefinition[] {
  const guardrailIds = new Set(guardrailCapabilityIds(derivePlannerHintIntent(transcript)));
  const scored = getLiveCapabilityDefinitions()
    .map(capability => ({
      capability,
      score: capabilityScore(transcript, capability),
    }))
    .sort((left, right) => right.score - left.score || left.capability.id.localeCompare(right.capability.id));

  const selected: CapabilityDefinition[] = [];
  for (const item of scored) {
    if (selected.length >= MAX_CAPABILITIES) break;
    if (item.score > 0 || guardrailIds.has(item.capability.id as CapabilityId)) {
      selected.push(item.capability);
    }
  }

  for (const guardrailId of guardrailIds) {
    const capability = getCapabilityDefinition(guardrailId);
    if (!selected.some(item => item.id === capability.id)) {
      selected.unshift(capability);
    }
  }

  return selected.length > 0 ? selected.slice(0, MAX_CAPABILITIES) : [...getLiveCapabilityDefinitions()];
}

function toPlanningCapabilityCandidate(capability: CapabilityDefinition, transcript: string): AssistantPlanningCapabilityCandidate {
  return {
    id: capability.id,
    title: capability.title,
    domain: capability.domain,
    description: capability.description,
    confirmationRule: capability.confirmationRule,
    score: capabilityScore(transcript, capability),
    examples: [...capability.examples],
    aliases: [...capability.aliases],
  };
}

function pushUniqueCandidate(
  list: AssistantPlanningEntityCandidate[],
  candidate: AssistantPlanningEntityCandidate | null,
): void {
  if (!candidate || list.some(item => item.kind === candidate.kind && item.id === candidate.id)) return;
  list.push(candidate);
}

function extractTaskEntityQuery(transcript: string): string {
  return transcript
    .replace(/^(?:please\s+)?(?:show(?:\s+me)?|open|find|locate|pull\s+up|take\s+me\s+to|complete|mark|finish|check\s+off|delete|remove|trash)\s+/i, '')
    .replace(/^(?:all\s+of\s+)?(?:the\s+)?(?:my\s+)?/i, '')
    .replace(/\b(?:tasks?|task|goals?|goal|habits?|habit)\b/gi, ' ')
    .replace(/\b(?:related to|about|for|called|named|as done|done)\b/gi, ' ')
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildPlanningBundle(
  transcript: string,
  context: AssistantCommandContext,
  dialogState: AssistantDialogState | undefined,
): AssistantPlanningBundle {
  const capabilities = buildCapabilityCandidates(transcript);
  const taskCandidateMap = new Map<string, AssistantPlanningEntityCandidate>();
  const taskQueries = [...new Set([transcript, extractTaskEntityQuery(transcript)].filter(Boolean))];
  for (const query of taskQueries) {
    for (const match of resolveTaskReference(query, context, dialogState, { allowCompleted: true }).matches.slice(0, MAX_CANDIDATES)) {
      const candidate: AssistantPlanningEntityCandidate = {
        kind: 'task',
        id: match.data.id,
        label: match.data.title,
        surface: 'tasks',
        score: match.score,
        detail: `${match.data.category}${match.data.completed ? ', completed' : ', open'}`,
      };
      const existing = taskCandidateMap.get(candidate.id);
      if (!existing || candidate.score > existing.score) {
        taskCandidateMap.set(candidate.id, candidate);
      }
    }
  }
  const tasks = [...taskCandidateMap.values()]
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, MAX_CANDIDATES);
  const recentTask = dialogState?.recentEntities.find(entity => entity.kind === 'task');
  if (recentTask) {
    const task = context.tasks.find(item => item.id === recentTask.id);
    pushUniqueCandidate(tasks, task
      ? {
          kind: 'task',
          id: task.id,
          label: task.title,
          surface: 'tasks',
          score: 1,
          detail: `${task.category}${task.completed ? ', completed' : ', open'}, recent`,
        }
      : null);
  }

  const calendarEvents = resolveCalendarEventReference(transcript, context, dialogState).matches
    .slice(0, MAX_CANDIDATES)
    .map(match => ({
      kind: 'calendar_event' as const,
      id: match.data.id,
      label: match.data.title,
      surface: 'calendar' as const,
      score: match.score,
      detail: new Date(match.data.start).toISOString(),
    }));
  const recentEvent = dialogState?.recentEntities.find(entity => entity.kind === 'calendar_event');
  if (recentEvent) {
    const event = context.calendarEvents.find(item => item.id === recentEvent.id);
    pushUniqueCandidate(calendarEvents, event
      ? {
          kind: 'calendar_event',
          id: event.id,
          label: event.title,
          surface: 'calendar',
          score: 1,
          detail: `${new Date(event.start).toISOString()}, recent`,
        }
      : null);
  }

  const calendarSources = context.calendarSources.length > 0
    ? resolveCalendarSourceReference(transcript, context, dialogState).matches
      .slice(0, MAX_CANDIDATES)
      .map(match => ({
        kind: 'calendar_source' as const,
        id: match.data.id,
        label: match.data.name,
        surface: 'calendar' as const,
        score: match.score,
      }))
    : [];
  const defaultCalendarSource = pickDefaultCalendarSource(context);
  pushUniqueCandidate(calendarSources, defaultCalendarSource
    ? {
        kind: 'calendar_source',
        id: defaultCalendarSource.id,
        label: defaultCalendarSource.name,
        surface: 'calendar',
        score: 0.8,
        detail: 'default',
      }
    : null);

  const financeAccounts = context.financeAccounts.length > 0
    ? resolveFinanceAccountReference(transcript, context, dialogState).matches
      .slice(0, MAX_CANDIDATES)
      .map(match => ({
        kind: 'finance_account' as const,
        id: match.data.id,
        label: match.data.name,
        surface: 'finance' as const,
        score: match.score,
        detail: `${match.data.currency} ${match.data.type}`,
      }))
    : [];
  const defaultFinanceAccount = pickDefaultFinanceAccount(context);
  pushUniqueCandidate(financeAccounts, defaultFinanceAccount
    ? {
        kind: 'finance_account',
        id: defaultFinanceAccount.id,
        label: defaultFinanceAccount.name,
        surface: 'finance',
        score: 0.8,
        detail: 'default',
      }
    : null);

  const defaultTopic = pickDefaultKnowledgeTopic(context);
  const describeKnowledgeTopicCandidate = (topic: KnowledgeTopic, isDefault: boolean): string | undefined => {
    const parts = [
      isDefault ? 'default topic' : '',
      topic.description?.trim() || '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('; ') : undefined;
  };

  const knowledgeTopics = context.knowledgeTopics.length > 0
    ? resolveKnowledgeTopicReference(transcript, context, dialogState).matches
      .slice(0, MAX_CANDIDATES)
      .map(match => ({
        kind: 'knowledge_topic' as const,
        id: match.data.id,
        label: match.data.name,
        surface: 'knowledge' as const,
        score: match.score,
        detail: describeKnowledgeTopicCandidate(match.data, match.data.id === defaultTopic?.id),
      }))
    : [];
  pushUniqueCandidate(knowledgeTopics, defaultTopic
    ? {
        kind: 'knowledge_topic',
        id: defaultTopic.id,
        label: defaultTopic.name,
        surface: 'knowledge',
        score: 0.8,
        detail: describeKnowledgeTopicCandidate(defaultTopic, true),
      }
    : null);

  const surfaces = resolveSurfaceReference(transcript, dialogState).matches
    .slice(0, MAX_CANDIDATES)
    .map(match => ({
      kind: 'surface' as const,
      id: match.data,
      label: SURFACE_LABELS[match.data].en,
      surface: match.data,
      score: match.score,
    }));
  if (context.currentSurface) {
    pushUniqueCandidate(surfaces, {
      kind: 'surface',
      id: context.currentSurface,
      label: SURFACE_LABELS[context.currentSurface].en,
      surface: context.currentSurface,
      score: 0.8,
      detail: 'current',
    });
  }

  const projects = context.projects.length > 0
    ? resolveProjectReference(transcript, context, dialogState).matches
      .slice(0, MAX_CANDIDATES)
      .map(match => ({
        kind: 'project' as const,
        id: match.data.id,
        label: match.data.name,
        surface: 'projects' as const,
        score: match.score,
        detail: match.data.status,
      }))
    : [];
  const recentProject = dialogState?.recentEntities.find(entity => entity.kind === 'project');
  if (recentProject) {
    const project = context.projects.find(item => item.id === recentProject.id);
    pushUniqueCandidate(projects, project
      ? {
        kind: 'project',
        id: project.id,
        label: project.name,
        surface: 'projects',
        score: 1,
        detail: `${project.status}, recent`,
      }
      : null);
  }

  const temporalReference = extractTemporalReference(transcript, context).resolution;
  const capabilityIds = capabilities.map(capability => capability.id as CapabilityId);

  return {
    transcript,
    normalizedTranscript: normaliseText(transcript),
    currentSurface: context.currentSurface || dialogState?.currentSurface,
    nowIso: getNow(context).toISOString(),
    timezone: context.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    recentEntities: [...(dialogState?.recentEntities || [])].slice(0, 5),
    recentPlans: [...(dialogState?.recentPlans || [])].slice(0, 5),
    capabilities: capabilities.map(capability => toPlanningCapabilityCandidate(capability, transcript)),
    entityCandidates: {
      surfaces,
      projects,
      tasks,
      calendarEvents,
      calendarSources,
      financeAccounts,
      knowledgeTopics,
    },
    temporalCandidate: temporalReference
      ? {
          phrase: temporalReference.phrase,
          start: temporalReference.start,
          end: temporalReference.end,
        }
      : undefined,
    benchmarkExamples: retrieveBenchmarkExamples(transcript, capabilityIds, 4),
  };
}

export function buildPlannerMessages(
  transcript: string,
  bundle: AssistantPlanningBundle,
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
): OllamaMessage[] {
  const languageInstruction = lang === 'ar'
    ? 'Respond using Arabic in the response field.'
    : 'Respond using English in the response field.';

  const capabilities = getLiveCapabilityDefinitions()
    .filter(capability => bundle.capabilities.some(candidate => candidate.id === capability.id));

  const prompt = `You are Lina, the grounded assistant inside the HELM app.
${languageInstruction}
Return only JSON that matches the provided schema.

You are the first planner for this turn. Do not assume regex rules will rescue a weak plan.

Choose one mode:
- answer: informational reply only
- clarify: ask for missing details
- confirm: ask before a risky mutation
- act: one or more executable semantic steps

Relevant capabilities for this turn:
${listCapabilitiesForPrompt(capabilities)}

Planning rules:
- Use only capability ids from the relevant capability list.
- For grounded entity actions, use only ids from the planning bundle candidate lists. Never invent ids.
- Entity candidate detail may describe a default or umbrella target. If exactly one grounded candidate is marked default and its detail clearly covers the user's requested subtopic, use that grounded id instead of clarifying.
- For tasks.reveal_task and tasks.complete_matching, pass taskId.
- For tasks.delete_matching, pass taskIds as an array of one or more grounded task ids.
- For calendar.reschedule_event, pass eventId.
- For calendar.create_event, pass calendarSourceId when a specific calendar is intended or the bundle makes a default clear.
- For finance.record_transaction, pass accountId when a specific account is intended or the bundle makes a default clear.
- For navigation.go_to_surface, pass projectId when opening a specific project inside the Projects surface.
- For knowledge.create_entry, pass topicId when a specific topic is intended or the bundle makes a default clear.
- Prefer clarify over guessing when the correct id, time, or target is uncertain.
- If the user asks for an unsupported action, clarify truthfully and do not approximate it to another capability.
- For unsupported requests that ask Lina to perform work, use mode "clarify", not "answer".
- If the request is destructive and you are not fully sure which item(s) to delete, choose clarify.
- If the user asks to delete all matching tasks and the bundle contains multiple clear task matches, include every relevant task id in taskIds and choose confirm instead of clarify.
- Keep response concise and user-facing.`;

  const history = (conversationHistory || []).slice(-LIMITS.LLM_HISTORY_MESSAGES).map<OllamaMessage>(message => ({
    role: message.role,
    content: message.content,
  }));

  return [
    { role: 'system', content: prompt },
    { role: 'system', content: `Planning bundle JSON:\n${JSON.stringify(bundle, null, 2)}` },
    ...history,
    { role: 'user', content: transcript },
  ];
}

function tryParsePlanCandidate(response: string): ActionPlan | null {
  try {
    return parseActionPlan(JSON.parse(response));
  } catch {
    return null;
  }
}

function extractJsonObjectCandidates(response: string): string[] {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < response.length; index += 1) {
    const char = response[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && startIndex !== -1) {
        candidates.push(response.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
}

export function parsePlanFromModelResponse(response: string): ActionPlan | null {
  const directPlan = tryParsePlanCandidate(response);
  if (directPlan) return directPlan;

  for (const candidate of extractJsonObjectCandidates(response)) {
    const plan = tryParsePlanCandidate(candidate);
    if (plan) return plan;
  }

  return null;
}

export function looksLikeStructuredPlanPayload(response: string): boolean {
  if (!response.trim()) return false;

  const planPattern = /"mode"\s*:\s*"(?:answer|clarify|confirm|act)"/;
  const stepsPattern = /"steps"\s*:/;
  if (planPattern.test(response) && stepsPattern.test(response)) {
    return true;
  }

  return extractJsonObjectCandidates(response).some(candidate =>
    planPattern.test(candidate) && stepsPattern.test(candidate),
  );
}

function validationSuccess(plan: ActionPlan, referencedEntities: AssistantEntityReference[]): {
  plan: ActionPlan;
  referencedEntities: AssistantEntityReference[];
  plannerValidation: AssistantPlannerValidation;
  planningStatus: PlannerResult['planningStatus'];
} {
  return {
    plan: {
      ...plan,
      steps: plan.steps.map(step => ({
        ...step,
        requiresConfirmation: step.requiresConfirmation || RISKY_CAPABILITY_IDS.has(step.capability),
      })),
    },
    referencedEntities,
    plannerValidation: { status: 'accepted' },
    planningStatus: 'planned',
  };
}

function validationReject(
  reason: string,
  message: string,
): {
  plan: ActionPlan;
  referencedEntities: AssistantEntityReference[];
  plannerValidation: AssistantPlannerValidation;
  planningStatus: PlannerResult['planningStatus'];
} {
  return {
    plan: buildClarifyPlan(message),
    referencedEntities: [],
    plannerValidation: { status: 'rejected', reason },
    planningStatus: 'validator_rejected',
  };
}

function validateTaskId(
  taskId: string,
  context: AssistantCommandContext,
  allowCompleted: boolean,
): { task: Task | null; reason?: string } {
  const task = context.tasks.find(item => item.id === taskId) || null;
  if (!task) {
    return { task: null, reason: `Unknown task id "${taskId}".` };
  }
  if (!allowCompleted && task.completed) {
    return { task: null, reason: `Task "${task.title}" is already complete.` };
  }
  return { task };
}

export function validateModelPlan(
  transcript: string,
  plan: ActionPlan,
  context: AssistantCommandContext,
  lang: AssistantLang,
): {
  plan: ActionPlan;
  referencedEntities: AssistantEntityReference[];
  plannerValidation: AssistantPlannerValidation;
  planningStatus: PlannerResult['planningStatus'];
} {
  const unsupportedGuardrail = deriveUnsupportedGuardrail(transcript);
  if (unsupportedGuardrail) {
    if (plan.mode === 'clarify' && plan.steps.length === 0) {
      return validationSuccess(plan, []);
    }

    return validationSuccess(
      buildClarifyPlan(unsupportedGuardrailClarifyMessage(unsupportedGuardrail, lang)),
      [],
    );
  }

  const guardrailIntent = deriveGuardrailIntent(transcript);
  const expectedCapabilityIds = guardrailCapabilityIds(guardrailIntent);

  if (expectedCapabilityIds.length > 0) {
    if (plan.mode === 'answer') {
      return validationReject(
        `Transcript guardrail "${guardrailIntent}" rejected answer mode.`,
        guardrailClarifyMessage(guardrailIntent, lang),
      );
    }

    if (plan.mode !== 'clarify' && !plan.steps.some(step => expectedCapabilityIds.includes(step.capability))) {
      return validationReject(
        `Transcript guardrail "${guardrailIntent}" rejected capability "${plan.steps[0]?.capability || 'none'}".`,
        guardrailClarifyMessage(guardrailIntent, lang),
      );
    }
  }

  if (plan.mode === 'answer' && looksLikeImperativeActionRequest(transcript)) {
    return validationSuccess({
      ...plan,
      mode: 'clarify',
    }, []);
  }

  if (plan.mode === 'clarify' || plan.mode === 'answer') {
    return validationSuccess(plan, []);
  }

  const referencedEntities: AssistantEntityReference[] = [];
  const normalizedSteps: ActionPlan['steps'] = [];

  for (const step of plan.steps) {
    switch (step.capability) {
      case 'navigation.go_to_surface': {
        const surfaceId = typeof step.args.surface === 'string' ? step.args.surface : '';
        if (!(surfaceId in SURFACE_LABELS)) {
          return validationReject(`Unknown surface "${surfaceId}".`, RESPONSES.validatorRejected[lang]);
        }

        referencedEntities.push(makeEntityReference('surface', surfaceId, SURFACE_LABELS[surfaceId as keyof typeof SURFACE_LABELS].en, surfaceId as keyof typeof SURFACE_LABELS, 1));
        normalizedSteps.push(step);
        break;
      }

      case 'tasks.open_view':
      case 'tasks.create_task': {
        normalizedSteps.push(step);
        break;
      }

      case 'tasks.reveal_task': {
        const taskId = typeof step.args.taskId === 'string' ? step.args.taskId : '';
        const validation = validateTaskId(taskId, context, true);
        if (!validation.task) {
          return validationReject(validation.reason || 'Invalid task reference.', RESPONSES.revealClarify[lang]);
        }

        referencedEntities.push(makeEntityReference('task', validation.task.id, validation.task.title, 'tasks', 1));
        normalizedSteps.push({
          ...step,
          args: { taskId: validation.task.id },
        });
        break;
      }

      case 'tasks.complete_matching': {
        const taskId = typeof step.args.taskId === 'string' ? step.args.taskId : '';
        const validation = validateTaskId(taskId, context, false);
        if (!validation.task) {
          return validationReject(validation.reason || 'Invalid task reference.', RESPONSES.completeClarify[lang]);
        }

        referencedEntities.push(makeEntityReference('task', validation.task.id, validation.task.title, 'tasks', 1));
        normalizedSteps.push({
          ...step,
          args: { taskId: validation.task.id },
        });
        break;
      }

      case 'tasks.delete_matching': {
        const rawIds = Array.isArray(step.args.taskIds)
          ? step.args.taskIds.filter((item): item is string => typeof item === 'string')
          : [];
        const taskIds = [...new Set(rawIds)];
        if (taskIds.length === 0) {
          return validationReject('Delete plan contained no task ids.', RESPONSES.deleteClarify[lang]);
        }

        const tasksToDelete: Task[] = [];
        for (const taskId of taskIds) {
          const validation = validateTaskId(taskId, context, true);
          if (!validation.task) {
            return validationReject(validation.reason || 'Invalid task reference.', RESPONSES.deleteClarify[lang]);
          }
          tasksToDelete.push(validation.task);
        }

        referencedEntities.push(...tasksToDelete.map(task =>
          makeEntityReference('task', task.id, task.title, 'tasks', 1),
        ));
        normalizedSteps.push({
          ...step,
          args: { taskIds: tasksToDelete.map(task => task.id) },
        });
        break;
      }

      case 'calendar.create_event': {
        let calendarSourceId = typeof step.args.calendarSourceId === 'string' ? step.args.calendarSourceId : '';
        if (!calendarSourceId) {
          calendarSourceId = pickDefaultCalendarSource(context)?.id || '';
        }
        if (calendarSourceId) {
          const source = context.calendarSources.find(item => item.id === calendarSourceId);
          if (!source) {
            return validationReject(`Unknown calendar source "${calendarSourceId}".`, RESPONSES.eventTimeClarify[lang]);
          }
          referencedEntities.push(makeEntityReference('calendar_source', source.id, source.name, 'calendar', 1));
        }

        let start = typeof step.args.start === 'string' ? step.args.start : '';
        let end = typeof step.args.end === 'string' ? step.args.end : '';
        if ((!start || !end) && typeof step.args.timePhrase === 'string') {
          const resolution = extractTemporalReference(step.args.timePhrase, context).resolution;
          start = start || resolution?.start || '';
          end = end || resolution?.end || '';
        }
        if (!start || !end) {
          return validationReject('Calendar create plan is missing a resolved time.', RESPONSES.eventTimeClarify[lang]);
        }

        normalizedSteps.push({
          ...step,
          args: {
            ...step.args,
            start,
            end,
            ...(calendarSourceId ? { calendarSourceId } : {}),
          },
        });
        break;
      }

      case 'calendar.reschedule_event': {
        const eventId = typeof step.args.eventId === 'string' ? step.args.eventId : '';
        const event = context.calendarEvents.find(item => item.id === eventId);
        if (!event) {
          return validationReject(`Unknown event id "${eventId}".`, RESPONSES.rescheduleClarify[lang]);
        }

        let start = typeof step.args.start === 'string' ? step.args.start : '';
        let end = typeof step.args.end === 'string' ? step.args.end : '';
        if ((!start || !end) && typeof step.args.timePhrase === 'string') {
          const resolution = extractTemporalReference(step.args.timePhrase, context, {
            baseStart: event.start,
            baseEnd: event.end,
          }).resolution;
          start = start || resolution?.start || '';
          end = end || resolution?.end || '';
        }
        if (!start || !end) {
          return validationReject('Calendar reschedule plan is missing a resolved time.', RESPONSES.rescheduleClarify[lang]);
        }

        referencedEntities.push(makeEntityReference('calendar_event', event.id, event.title, 'calendar', 1));
        normalizedSteps.push({
          ...step,
          args: {
            ...step.args,
            eventId: event.id,
            start,
            end,
          },
        });
        break;
      }

      case 'finance.record_transaction': {
        let accountId = typeof step.args.accountId === 'string' ? step.args.accountId : '';
        if (!accountId) {
          accountId = pickDefaultFinanceAccount(context)?.id || '';
        }
        if (!accountId) {
          return validationReject('Finance record plan could not determine an account.', RESPONSES.financeClarify[lang]);
        }
        const account = context.financeAccounts.find(item => item.id === accountId);
        if (!account) {
          return validationReject(`Unknown finance account "${accountId}".`, RESPONSES.financeClarify[lang]);
        }

        referencedEntities.push(makeEntityReference('finance_account', account.id, account.name, 'finance', 1));
        normalizedSteps.push({
          ...step,
          args: {
            ...step.args,
            accountId: account.id,
          },
        });
        break;
      }

      case 'knowledge.create_entry': {
        let topicId = typeof step.args.topicId === 'string' ? step.args.topicId : '';
        if (!topicId) {
          topicId = pickDefaultKnowledgeTopic(context)?.id || '';
        }
        if (!topicId) {
          return validationReject('Knowledge plan could not determine a topic.', RESPONSES.knowledgeClarify[lang]);
        }

        const topic = context.knowledgeTopics.find(item => item.id === topicId);
        if (!topic) {
          return validationReject(`Unknown knowledge topic "${topicId}".`, RESPONSES.knowledgeClarify[lang]);
        }

        referencedEntities.push(makeEntityReference('knowledge_topic', topic.id, topic.name, 'knowledge', 1));
        normalizedSteps.push({
          ...step,
          args: {
            ...step.args,
            topicId: topic.id,
          },
        });
        break;
      }
    }
  }

  return validationSuccess({
    ...plan,
    steps: normalizedSteps,
  }, referencedEntities);
}

export async function isOllamaAvailable(endpoint: string = OLLAMA_ENDPOINT): Promise<boolean> {
  if (cachedEndpoint !== endpoint) {
    cachedEndpoint = endpoint;
    ollamaAvailability = null;
  }

  if (ollamaAvailability !== null) {
    return ollamaAvailability;
  }

  ollamaAvailability = await testOllamaConnection(endpoint);
  setTimeout(() => {
    ollamaAvailability = null;
  }, TIMING.OLLAMA_CACHE_EXPIRY);

  return ollamaAvailability;
}

export function resetOllamaAvailability(): void {
  cachedEndpoint = null;
  ollamaAvailability = null;
  hostedAvailability = null;
}

async function getHostedAvailability(): Promise<'available' | 'sign_in_required' | 'not_configured' | 'unavailable'> {
  if (hostedAvailability) {
    return hostedAvailability;
  }

  const status = await testHostedAssistantConnection();
  hostedAvailability = status.status;
  setTimeout(() => {
    hostedAvailability = null;
  }, TIMING.HOSTED_ASSISTANT_CACHE_EXPIRY);

  return hostedAvailability;
}

function getAssistantProvider(provider?: AssistantProvider): AssistantProvider {
  return provider || DEFAULT_ASSISTANT_PROVIDER;
}

async function planWithProvider(
  plannerProvider: PlannerProvider,
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    endpoint?: string;
    model?: string;
    dialogState?: AssistantDialogState;
  },
): Promise<PlannerResult> {
  const bundle = buildPlanningBundle(transcript, context, options.dialogState);
  const schema = buildActionPlanJsonSchema(
    bundle.capabilities.map(candidate => candidate.id as CapabilityId),
  );
  const messages = buildPlannerMessages(transcript, bundle, options.lang, options.conversationHistory);

  if (plannerProvider === 'hosted') {
    const availability = await getHostedAvailability();
    if (availability === 'sign_in_required') {
      return {
        plan: buildAnswerPlan(RESPONSES.hostedSignInRequired[options.lang]),
        source: 'degraded',
        degradedReason: 'hosted_sign_in_required',
        planningSource: 'none',
        planningStatus: 'blocked_provider_unavailable',
        planningModel: HOSTED_ASSISTANT_MODEL,
        planningBundle: bundle,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: { status: 'skipped', reason: 'Hosted planner requires sign-in.' },
      };
    }

    if (availability === 'not_configured') {
      return {
        plan: buildAnswerPlan(RESPONSES.hostedNotConfigured[options.lang]),
        source: 'degraded',
        degradedReason: 'hosted_not_configured',
        planningSource: 'none',
        planningStatus: 'blocked_provider_unavailable',
        planningModel: HOSTED_ASSISTANT_MODEL,
        planningBundle: bundle,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: { status: 'skipped', reason: 'Hosted planner is not configured.' },
      };
    }

    if (availability !== 'available') {
      return {
        plan: buildAnswerPlan(RESPONSES.hostedError[options.lang]('Hosted AI unavailable')),
        source: 'degraded',
        degradedReason: 'hosted_error',
        planningSource: 'none',
        planningStatus: 'blocked_provider_unavailable',
        planningModel: HOSTED_ASSISTANT_MODEL,
        planningBundle: bundle,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: { status: 'skipped', reason: 'Hosted planner is unavailable.' },
      };
    }

    try {
      const response = await chatWithHostedAssistant(messages, schema);
      const parsedPlan = parsePlanFromModelResponse(response);
      if (!parsedPlan) {
        return {
          plan: buildAnswerPlan(RESPONSES.hostedInvalidStructuredResponse[options.lang]),
          source: 'degraded',
          degradedReason: 'hosted_error',
          planningSource: 'openai',
          planningStatus: 'model_response_invalid',
          planningModel: HOSTED_ASSISTANT_MODEL,
          planningBundle: bundle,
          rawPlannerResponse: response,
          parsedPlan: null,
          validatedPlan: null,
          plannerValidation: {
            status: 'rejected',
            reason: looksLikeStructuredPlanPayload(response)
              ? 'Hosted planner returned malformed structured JSON.'
              : 'Hosted planner returned no parseable structured plan.',
          },
        };
      }

      const validation = validateModelPlan(transcript, parsedPlan, context, options.lang);
      return {
        plan: validation.plan,
        referencedEntities: validation.referencedEntities,
        source: 'openai',
        planningSource: 'openai',
        planningStatus: validation.planningStatus,
        planningModel: HOSTED_ASSISTANT_MODEL,
        planningBundle: bundle,
        rawPlannerResponse: response,
        parsedPlan,
        validatedPlan: validation.plan,
        plannerValidation: validation.plannerValidation,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      hostedAvailability = 'unavailable';
      setTimeout(() => {
        hostedAvailability = null;
      }, TIMING.HOSTED_ASSISTANT_UNAVAILABLE_COOLDOWN);

      return {
        plan: buildAnswerPlan(RESPONSES.hostedError[options.lang](message)),
        source: 'degraded',
        degradedReason: 'hosted_error',
        planningSource: 'none',
        planningStatus: 'blocked_provider_unavailable',
        planningModel: HOSTED_ASSISTANT_MODEL,
        planningBundle: bundle,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: { status: 'skipped', reason: message },
      };
    }
  }

  const endpoint = options.endpoint || OLLAMA_ENDPOINT;
  const available = await isOllamaAvailable(endpoint);
  if (!available) {
    return {
      plan: buildAnswerPlan(RESPONSES.ollamaOffline[options.lang]),
      source: 'degraded',
      degradedReason: 'ollama_offline',
      planningSource: 'none',
      planningStatus: 'blocked_provider_unavailable',
      planningModel: options.model || DEFAULT_OLLAMA_MODEL,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: 'Ollama is offline.' },
    };
  }

  try {
    const response = await chatWithOllama(messages, endpoint, options.model, schema);
    const parsedPlan = parsePlanFromModelResponse(response);
    if (!parsedPlan) {
      return {
        plan: buildAnswerPlan(RESPONSES.ollamaInvalidStructuredResponse[options.lang]),
        source: 'degraded',
        degradedReason: 'ollama_error',
        planningSource: 'ollama',
        planningStatus: 'model_response_invalid',
        planningModel: options.model || DEFAULT_OLLAMA_MODEL,
        planningBundle: bundle,
        rawPlannerResponse: response,
        parsedPlan: null,
        validatedPlan: null,
        plannerValidation: {
          status: 'rejected',
          reason: looksLikeStructuredPlanPayload(response)
            ? 'Ollama returned malformed structured JSON.'
            : 'Ollama returned no parseable structured plan.',
        },
      };
    }

    const validation = validateModelPlan(transcript, parsedPlan, context, options.lang);
    return {
      plan: validation.plan,
      referencedEntities: validation.referencedEntities,
      source: 'ollama',
      planningSource: 'ollama',
      planningStatus: validation.planningStatus,
      planningModel: options.model || DEFAULT_OLLAMA_MODEL,
      planningBundle: bundle,
      rawPlannerResponse: response,
      parsedPlan,
      validatedPlan: validation.plan,
      plannerValidation: validation.plannerValidation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    ollamaAvailability = false;
    setTimeout(() => {
      ollamaAvailability = null;
    }, TIMING.OLLAMA_UNAVAILABLE_COOLDOWN);

    return {
      plan: buildAnswerPlan(RESPONSES.ollamaError[options.lang](message)),
      source: 'degraded',
      degradedReason: 'ollama_error',
      planningSource: 'none',
      planningStatus: 'blocked_provider_unavailable',
      planningModel: options.model || DEFAULT_OLLAMA_MODEL,
      planningBundle: bundle,
      parsedPlan: null,
      validatedPlan: null,
      plannerValidation: { status: 'skipped', reason: message },
    };
  }
}

export async function planAssistantTurn(
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    provider?: AssistantProvider;
    endpoint?: string;
    model?: string;
    dialogState?: AssistantDialogState;
  },
): Promise<PlannerResult> {
  const provider = getAssistantProvider(options.provider);

  if (provider === 'hosted') {
    return planWithProvider('hosted', transcript, context, options);
  }

  if (provider === 'ollama') {
    return planWithProvider('ollama', transcript, context, options);
  }

  const hosted = await planWithProvider('hosted', transcript, context, options);
  if (hosted.source === 'openai' && hosted.planningStatus === 'planned') {
    return hosted;
  }

  if (hosted.planningStatus === 'validator_rejected') {
    const ollama = await planWithProvider('ollama', transcript, context, options);
    return ollama.planningStatus === 'planned' ? ollama : hosted;
  }

  if (hosted.degradedReason !== 'hosted_sign_in_required' && hosted.degradedReason !== 'hosted_not_configured') {
    const ollama = await planWithProvider('ollama', transcript, context, options);
    if (ollama.source === 'ollama' && ollama.planningStatus === 'planned') {
      return ollama;
    }
    if (ollama.planningStatus === 'validator_rejected') {
      return ollama;
    }
    return hosted;
  }

  const ollama = await planWithProvider('ollama', transcript, context, options);
  if (ollama.source === 'ollama' || ollama.planningStatus === 'validator_rejected') {
    return ollama;
  }

  return {
    plan: buildAnswerPlan(RESPONSES.noLivePlanner[options.lang]),
    source: 'degraded',
    degradedReason: hosted.degradedReason || ollama.degradedReason || 'unsupported_without_ai',
    planningSource: 'none',
    planningStatus: 'blocked_provider_unavailable',
    planningModel: undefined,
    planningBundle: hosted.planningBundle || ollama.planningBundle,
    parsedPlan: null,
    validatedPlan: null,
    plannerValidation: { status: 'skipped', reason: 'No live planner available in auto mode.' },
  };
}

export { SURFACE_LABELS };

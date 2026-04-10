import type { AssistantProvider, Task } from '../types/domain';
import { DEFAULT_ASSISTANT_PROVIDER, OLLAMA_ENDPOINT } from '../config';
import { LIMITS, TIMING } from '../config/constants';
import { chatWithHostedAssistant, testHostedAssistantConnection } from '../services/hostedAssistantApi';
import { chatWithOllama, testOllamaConnection, type OllamaMessage } from '../services/ollamaApi';
import { getLiveCapabilityDefinitions, listCapabilitiesForPrompt } from './capabilities';
import {
  SURFACE_LABELS,
  resolveCalendarEventReference,
  resolveSurfaceReference,
  resolveTaskReference,
} from './entityResolver';
import { actionPlanJsonSchema, parseActionPlan, type ActionPlan } from './plannerSchema';
import type {
  AssistantCommandContext,
  AssistantConversationMessage,
  AssistantDialogState,
  AssistantEntityReference,
  AssistantLang,
} from './shared';
import { parseTaskCreationRequest } from './taskRequestParser';
import { extractTemporalReference } from './temporalResolver';

export interface PlannerResult {
  plan: ActionPlan;
  referencedEntities?: AssistantEntityReference[];
  source: 'local' | 'ollama' | 'openai' | 'degraded';
  degradedReason?:
    | 'ollama_offline'
    | 'ollama_error'
    | 'hosted_sign_in_required'
    | 'hosted_not_configured'
    | 'hosted_error'
    | 'unsupported_without_ai';
}

const NAVIGATION_VERBS = ['open', 'go to', 'show me', 'navigate', 'switch to', 'take me to', 'افتح', 'اذهب'];
const RISKY_CAPABILITY_IDS = new Set(
  getLiveCapabilityDefinitions()
    .filter(capability => capability.confirmationRule === 'always')
    .map(capability => capability.id),
);

const RESPONSES = {
  noMeetings: {
    en: 'You have no upcoming meetings.',
    ar: 'ليس لديك اجتماعات قادمة.',
  },
  nextMeeting: {
    en: (title: string, time: string, location?: string) =>
      `Your next meeting is ${title} at ${time}${location ? `, at ${location}` : ''}.`,
    ar: (title: string, time: string, location?: string) =>
      `اجتماعك القادم هو ${title} الساعة ${time}${location ? `، في ${location}` : ''}.`,
  },
  tasksRemaining: {
    en: (count: number) => `You have ${count} task${count === 1 ? '' : 's'} remaining.`,
    ar: (count: number) => count === 0 ? 'ليس لديك مهام متبقية.' : `لديك ${count} مهام متبقية.`,
  },
  noStreak: {
    en: "You don't have an active streak right now.",
    ar: 'ليس لديك سلسلة نشطة حالياً.',
  },
  streak: {
    en: (count: number) => `You're on a ${count}-day streak.`,
    ar: (count: number) => `أنت في سلسلة ${count} يوم.`,
  },
  level: {
    en: (level: number, xp: number) => `You're level ${level} with ${xp} XP.`,
    ar: (level: number, xp: number) => `أنت في المستوى ${level} مع ${xp} نقطة خبرة.`,
  },
  prayerTime: {
    en: (name: string, time: string) => `${name} is at ${time}.`,
    ar: (name: string, time: string) => `${name} الساعة ${time}.`,
  },
  allPrayerTimes: {
    en: (list: string) => `Today's prayer times are: ${list}.`,
    ar: (list: string) => `أوقات الصلاة اليوم: ${list}.`,
  },
  prayerNotLoaded: {
    en: "Prayer times aren't loaded yet.",
    ar: 'لم يتم تحميل أوقات الصلاة بعد.',
  },
  focusToday: {
    en: (tasks: string, meeting: string) => `Focus on ${tasks}.${meeting ? ` ${meeting}` : ''}`,
    ar: (tasks: string, meeting: string) => `${tasks}.${meeting ? ` ${meeting}` : ''}`,
  },
  askEventTime: {
    en: 'When should I schedule it?',
    ar: 'متى تريدين أن أحدده؟',
  },
  askRescheduleTarget: {
    en: 'What time should I move it to?',
    ar: 'إلى أي وقت تريدين نقله؟',
  },
  askFinanceAmount: {
    en: 'What amount should I record?',
    ar: 'ما المبلغ الذي تريدين تسجيله؟',
  },
  ollamaOffline: {
    en: 'Ollama is offline. I can still handle grounded app actions like navigation, tasks, event scheduling, finance logging, and knowledge notes when the request is explicit.',
    ar: 'Ollama غير متصل. ما زال بإمكاني تنفيذ أوامر التطبيق الواضحة مثل التنقل والمهام والمواعيد والمالية والملاحظات.',
  },
  hostedSignInRequired: {
    en: 'Hosted AI is available after you sign in to HELM. I can still handle grounded app actions like navigation, tasks, event scheduling, finance logging, and knowledge notes when the request is explicit.',
    ar: 'الذكاء الاصطناعي المستضاف متاح بعد تسجيل الدخول إلى HELM. ما زال بإمكاني تنفيذ أوامر التطبيق الواضحة مثل التنقل والمهام والمواعيد والمالية والملاحظات.',
  },
  hostedNotConfigured: {
    en: 'Hosted AI is not configured in this build yet. I can still handle grounded app actions like navigation, tasks, event scheduling, finance logging, and knowledge notes when the request is explicit.',
    ar: 'الذكاء الاصطناعي المستضاف غير مُعدّ في هذا الإصدار بعد. ما زال بإمكاني تنفيذ أوامر التطبيق الواضحة مثل التنقل والمهام والمواعيد والمالية والملاحظات.',
  },
  ollamaError: {
    en: (message: string) => `I couldn't reach Ollama (${message}). I stayed on the grounded local assistant flow.`,
    ar: (message: string) => `تعذر علي الاتصال بـ Ollama (${message}). بقيت على مسار المساعد المحلي.`,
  },
  hostedError: {
    en: (message: string) => `I couldn't reach the hosted assistant (${message}). I stayed on the grounded local assistant flow.`,
    ar: (message: string) => `تعذر علي الاتصال بالمساعد المستضاف (${message}). بقيت على مسار المساعد المحلي.`,
  },
  unknown: {
    en: (transcript: string) =>
      `I heard "${transcript}" but I need either a clearer instruction or an AI provider online for open-ended help.`,
    ar: (transcript: string) =>
      `سمعت "${transcript}" لكني أحتاج إلى طلب أوضح أو إلى توفر مزود ذكاء اصطناعي للمساعدة المفتوحة.`,
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

function sanitizeTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.?!،]+$/g, '')
    .replace(/^(?:to\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnswerPlan(response: string): ActionPlan {
  return { mode: 'answer', response, confidence: 1, steps: [] };
}

function buildClarifyPlan(response: string): ActionPlan {
  return { mode: 'clarify', response, confidence: 0.7, steps: [] };
}

function inferTaskDeleteCategory(noun?: string): Task['category'] | 'any' {
  if (!noun) return 'any';
  if (/habit|habits|عادة|عادات/i.test(noun)) return 'daily';
  if (/goal|goals|هدف|أهداف/i.test(noun)) return 'goal';
  return 'any';
}

function inferTaskDeleteScope(rawScope?: string, noun?: string): 'one' | 'all' {
  if (rawScope && /\ball\b|كل/i.test(rawScope)) return 'all';
  if (noun && /(tasks|todos|habits|goals|مهام|عادات|أهداف)/i.test(noun)) return 'all';
  return 'one';
}

function buildTaskDeleteConfirmation(
  query: string,
  matches: Task[],
  scope: 'one' | 'all',
  lang: AssistantLang,
): string {
  if (scope === 'one' || matches.length === 1) {
    const title = matches[0]?.title || query;
    return lang === 'ar'
      ? `أستطيع حذف "${title}". هل تريدين أن أفعل ذلك؟`
      : `I can delete "${title}". Do you want me to do that?`;
  }

  const preview = matches.slice(0, 3).map(task => `"${task.title}"`).join(', ');
  const more = matches.length > 3 ? lang === 'ar' ? ' وغيرها' : ', and more' : '';
  return lang === 'ar'
    ? `أستطيع حذف ${matches.length} مهام تطابق "${query}": ${preview}${more}. هل تريدين أن أفعل ذلك؟`
    : `I can delete ${matches.length} tasks matching "${query}": ${preview}${more}. Do you want me to do that?`;
}

function buildContextDigest(context: AssistantCommandContext, dialogState?: AssistantDialogState): string {
  const now = context.now ? new Date(context.now) : new Date();
  const upcomingEvents = context.calendarEvents
    .filter(event => new Date(event.end) >= now)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 6)
    .map(event => {
      const start = new Date(event.start).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
      return `- ${event.title} @ ${start}`;
    })
    .join('\n') || '- none';

  const openTasks = context.tasks
    .filter(task => !task.completed)
    .slice(0, 8)
    .map(task => `- ${task.title} [${task.category}/${task.priority}]`)
    .join('\n') || '- none';

  const financeAccounts = context.financeAccounts
    .slice(0, 6)
    .map(account => `- ${account.name} (${account.currency})`)
    .join('\n') || '- none';

  const knowledgeTopics = context.knowledgeTopics
    .slice(0, 6)
    .map(topic => `- ${topic.name}`)
    .join('\n') || '- none';

  const calendarSources = context.calendarSources
    .slice(0, 6)
    .map(source => `- ${source.name}`)
    .join('\n') || '- none';

  const recentEntities = dialogState?.recentEntities
    .slice(0, 5)
    .map(entity => `- ${entity.kind}: ${entity.label}`)
    .join('\n') || '- none';

  return `Current surface: ${context.currentSurface || dialogState?.currentSurface || 'unknown'}

Upcoming events:
${upcomingEvents}

Open tasks:
${openTasks}

Calendar sources:
${calendarSources}

Finance accounts:
${financeAccounts}

Knowledge topics:
${knowledgeTopics}

Recent dialog entities:
${recentEntities}`;
}

function buildPlannerMessages(
  transcript: string,
  context: AssistantCommandContext,
  lang: AssistantLang,
  conversationHistory: AssistantConversationMessage[] | undefined,
  dialogState: AssistantDialogState | undefined,
): OllamaMessage[] {
  const languageInstruction = lang === 'ar'
    ? 'Respond using Arabic in the response field.'
    : 'Respond using English in the response field.';

  const prompt = `You are Lina, the grounded assistant inside the HELM app.
${languageInstruction}
Return only JSON that matches the provided schema.

Choose one mode:
- answer: informational reply only
- clarify: ask for missing details
- confirm: ask before a risky mutation
- act: one or more executable semantic steps

Use only these capability ids:
${listCapabilitiesForPrompt()}

  Planning rules:
  - Never invent entity ids. Use raw phrases like taskQuery, eventQuery, calendarQuery, topicQuery, or accountQuery.
  - Use timePhrase for unresolved natural-language time.
  - Prefer clarify when the request is missing key details like time, amount, or topic.
  - Prefer confirm for rescheduling existing calendar events.
  - If the user asks for an unsupported action, do not approximate it to a different capability. Reply truthfully that the action is not available.
  - Keep response concise and user-facing.

Live app context:
${buildContextDigest(context, dialogState)}`;

  const history = (conversationHistory || []).slice(-LIMITS.LLM_HISTORY_MESSAGES).map<OllamaMessage>(message => ({
    role: message.role,
    content: message.content,
  }));

  return [
    { role: 'system', content: prompt },
    ...history,
    { role: 'user', content: transcript },
  ];
}

function parsePlanFromModelResponse(response: string): ActionPlan | null {
  try {
    return parseActionPlan(JSON.parse(response));
  } catch {
    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return parseActionPlan(JSON.parse(response.slice(firstBrace, lastBrace + 1)));
    } catch {
      return null;
    }
  }
}

function planQueryLocally(
  lower: string,
  context: AssistantCommandContext,
  lang: AssistantLang,
): PlannerResult | null {
  if (
    lower.includes('next meeting')
    || lower.includes('next event')
    || lower.includes('upcoming meeting')
    || lower.includes('upcoming event')
    || lower.includes('اجتماع')
    || lower.includes('القادم')
  ) {
    const now = context.now ? new Date(context.now) : new Date();
    const upcoming = context.calendarEvents
      .filter(event => new Date(event.start) > now && !event.allDay)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    if (upcoming.length === 0) {
      return { plan: buildAnswerPlan(RESPONSES.noMeetings[lang]), source: 'local' };
    }

    const next = upcoming[0];
    const time = new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      plan: buildAnswerPlan(RESPONSES.nextMeeting[lang](next.title, time, next.location)),
      referencedEntities: [{
        kind: 'calendar_event',
        id: next.id,
        label: next.title,
        surface: 'calendar',
        score: 1,
        lastUsedAt: new Date().toISOString(),
      }],
      source: 'local',
    };
  }

  if (
    lower.includes('how many task')
    || lower.includes('tasks left')
    || lower.includes('pending task')
    || lower.includes('كم مهمة')
    || lower.includes('المتبقية')
  ) {
    const count = context.tasks.filter(task => !task.completed && task.category !== 'goal').length;
    return { plan: buildAnswerPlan(RESPONSES.tasksRemaining[lang](count)), source: 'local' };
  }

  if (lower.includes('streak') || lower.includes('سلسلة')) {
    const streak = context.gamification.currentStreak;
    return {
      plan: buildAnswerPlan(streak === 0 ? RESPONSES.noStreak[lang] : RESPONSES.streak[lang](streak)),
      source: 'local',
    };
  }

  if (lower.includes('level') || lower.includes('what am i') || lower.includes('مستوى')) {
    return {
      plan: buildAnswerPlan(RESPONSES.level[lang](context.gamification.level, context.gamification.totalXp)),
      source: 'local',
    };
  }

  if (lower.includes('focus') && lower.includes('today')) {
    const openTasks = context.tasks.filter(task => !task.completed && task.category !== 'goal').slice(0, 3);
    const taskText = openTasks.length > 0
      ? openTasks.map(task => task.title).join(', ')
      : lang === 'ar' ? 'لا توجد مهام عاجلة الآن' : 'no urgent tasks right now';
    const nextMeeting = planQueryLocally('next meeting', context, lang);
    return {
      plan: buildAnswerPlan(RESPONSES.focusToday[lang](taskText, nextMeeting?.plan.response ?? '')),
      source: 'local',
    };
  }

  const prayerNames = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'فجر', 'ظهر', 'عصر', 'مغرب', 'عشاء'];
  for (const prayerName of prayerNames) {
    if (lower.includes(prayerName)) {
      const mapped = prayerName === 'فجر' ? 'fajr'
        : prayerName === 'ظهر' ? 'dhuhr'
        : prayerName === 'عصر' ? 'asr'
        : prayerName === 'مغرب' ? 'maghrib'
        : prayerName === 'عشاء' ? 'isha'
        : prayerName;
      const prayer = context.prayerTimes?.find(entry => entry.name.toLowerCase() === mapped);
      if (!prayer) {
        return { plan: buildAnswerPlan(RESPONSES.prayerNotLoaded[lang]), source: 'local' };
      }
      return { plan: buildAnswerPlan(RESPONSES.prayerTime[lang](prayer.name, prayer.time)), source: 'local' };
    }
  }

  if ((lower.includes('prayer') && lower.includes('time')) || lower.includes('أوقات')) {
    if (!context.prayerTimes || context.prayerTimes.length === 0) {
      return { plan: buildAnswerPlan(RESPONSES.prayerNotLoaded[lang]), source: 'local' };
    }
    const list = context.prayerTimes.map(prayer => `${prayer.name} ${lang === 'ar' ? 'الساعة' : 'at'} ${prayer.time}`).join(', ');
    return { plan: buildAnswerPlan(RESPONSES.allPrayerTimes[lang](list)), source: 'local' };
  }

  return null;
}

function planTaskCreation(transcript: string, context: AssistantCommandContext): ActionPlan | null {
  const parsed = parseTaskCreationRequest(transcript, context);
  if (!parsed) return null;
  if (parsed.clarify || !parsed.title || !parsed.category || !parsed.priority) {
    return buildClarifyPlan(parsed.clarify || 'What should I call the task?');
  }

  return {
    mode: 'act',
    response: '',
    confidence: 0.94,
    steps: [{
      capability: 'tasks.create_task',
      args: {
        title: parsed.title,
        priority: parsed.priority,
        category: parsed.category,
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.duePhrase ? { duePhrase: parsed.duePhrase } : {}),
      },
    }],
  };
}

function buildTaskViewPlan(tab: 'today' | 'all' | 'goals'): ActionPlan {
  return {
    mode: 'act',
    response: '',
    confidence: 0.95,
    steps: [{
      capability: 'tasks.open_view',
      args: {
        tab,
        resetFilters: true,
      },
    }],
  };
}

function planTaskView(transcript: string): ActionPlan | null {
  const cleanedTranscript = transcript.trim().replace(/[.?!،]+$/g, '');

  const allMatchers = [
    /^(?:show(?:\s+me)?|open|pull up|take me to|go to)\s+(?:all\s+tasks|all\s+my\s+tasks|my\s+tasks|task\s+list)$/i,
  ];
  if (allMatchers.some(matcher => matcher.test(cleanedTranscript))) {
    return buildTaskViewPlan('all');
  }

  const goalMatchers = [
    /^(?:show(?:\s+me)?|open|pull up|take me to|go to)\s+(?:my\s+goals|goals)$/i,
  ];
  if (goalMatchers.some(matcher => matcher.test(cleanedTranscript))) {
    return buildTaskViewPlan('goals');
  }

  const todayMatchers = [
    /^(?:show(?:\s+me)?|open|pull up|take me to|go to)\s+(?:today(?:'s)?\s+tasks|my\s+today(?:'s)?\s+tasks|tasks\s+for\s+today|today(?:'s)?\s+habits)$/i,
  ];
  if (todayMatchers.some(matcher => matcher.test(cleanedTranscript))) {
    return buildTaskViewPlan('today');
  }

  return null;
}

function planTaskReveal(transcript: string, dialogState?: AssistantDialogState): ActionPlan | null {
  const cleanedTranscript = transcript.trim().replace(/[.?!،]+$/g, '');
  const hasRecentTask = dialogState?.recentEntities.some(entity => entity.kind === 'task') ?? false;

  const pronounMatcher = cleanedTranscript.match(/(?:show me|open|find|locate|pull up|take me to)\s+(that task|this task|that one|this one|it)$/i);
  if (pronounMatcher) {
    return {
      mode: 'act',
      response: '',
      confidence: hasRecentTask ? 0.9 : 0.72,
      steps: [{
        capability: 'tasks.reveal_task',
        args: { taskQuery: pronounMatcher[1] },
      }],
    };
  }

  const explicitMatcher = cleanedTranscript.match(/(?:show me|open|find|locate|pull up|take me to)\s+(?:my\s+)?(?:task|todo)\s+(.+)/i);
  if (!explicitMatcher) return null;

  const taskQuery = sanitizeTitle(explicitMatcher[1] || '');
  if (!taskQuery) {
    return buildClarifyPlan('Which task should I show you?');
  }

  return {
    mode: 'act',
    response: '',
    confidence: 0.86,
    steps: [{
      capability: 'tasks.reveal_task',
      args: { taskQuery },
    }],
  };
}

function planTaskCompletion(transcript: string): ActionPlan | null {
  const habitMatchers = [
    /(?:complete|finish|mark|check off)(?: the| my)?\s+(?:habit|daily)\s+(.+?)(?:\s+(?:as done|done|complete))?$/i,
    /(?:أكمل|انهِ|عل[ّم]?)\s+(?:العادة|العادة اليومية)\s+(.+)$/i,
  ];

  for (const matcher of habitMatchers) {
    const match = transcript.match(matcher);
    if (!match) continue;
    const title = sanitizeTitle(match[1] || '');
    if (!title) return null;
    return {
      mode: 'act',
      response: '',
      confidence: 0.92,
      steps: [{
        capability: 'tasks.complete_matching',
        args: {
          taskQuery: title,
          category: 'daily',
        },
      }],
    };
  }

  const taskMatchers = [
    /(?:complete|finish|mark|check off)(?: the| my)?\s+(?:task|todo)?\s+(.+?)(?:\s+(?:as done|done|complete))?$/i,
    /mark\s+(.+?)\s+(?:as\s+)?done$/i,
    /(?:أكمل|انهِ|عل[ّم]?)(?:\s+المهمة)?\s+(.+)$/i,
  ];

  for (const matcher of taskMatchers) {
    const match = transcript.match(matcher);
    if (!match) continue;
    const title = sanitizeTitle(match[1] || '');
    if (!title) return null;
    return {
      mode: 'act',
      response: '',
      confidence: 0.9,
      steps: [{
        capability: 'tasks.complete_matching',
        args: { taskQuery: title },
      }],
    };
  }

  return null;
}

function planTaskDeletion(
  transcript: string,
  context: AssistantCommandContext,
  lang: AssistantLang,
  dialogState?: AssistantDialogState,
): ActionPlan | null {
  const matchers = [
    /(?:delete|remove|trash)(?:\s+(?<scope>all(?:\s+of)?))?(?:\s+(?:the|my))?\s+(?<noun>task|tasks|todo|todos|habit|habits|goal|goals)\s+(?:related to|about|for|called|named)?\s*(?<query>.+)$/i,
    /(?:delete|remove|trash)(?:\s+(?<scope>all(?:\s+of)?))?\s+(?<query>.+?)\s+(?<noun>task|tasks|todo|todos|habit|habits|goal|goals)$/i,
    /(?:delete|remove|trash)(?:\s+(?<scope>all(?:\s+of)?))?\s+(?<query>that task|this task|that one|this one|it)$/i,
    /(?:احذف|امسح|شيل)(?:\s+(?<scope>كل))?(?:\s+(?:ال|هذه|هذا))?\s*(?<noun>مهمة|مهام|عادة|عادات|هدف|أهداف)\s+(?:عن|حول|اسمها)?\s*(?<query>.+)$/i,
    /(?:احذف|امسح|شيل)(?:\s+(?<scope>كل))?\s+(?<query>.+?)\s+(?<noun>مهمة|مهام|عادة|عادات|هدف|أهداف)$/i,
  ];

  for (const matcher of matchers) {
    const match = transcript.match(matcher);
    const groups = match?.groups;
    if (!groups) continue;

    const query = sanitizeTitle(groups.query || '');
    if (!query) {
      return buildClarifyPlan(lang === 'ar' ? 'أي مهمة تريدين حذفها؟' : 'Which task should I delete?');
    }

    const category = inferTaskDeleteCategory(groups.noun);
    const matchScope = inferTaskDeleteScope(groups.scope, groups.noun);
    const resolution = resolveTaskReference(query, context, dialogState, {
      category,
      allowCompleted: true,
    });

    if (matchScope === 'all') {
      if (resolution.matches.length === 0) {
        return buildClarifyPlan(lang === 'ar'
          ? `لم أجد مهاماً تطابق "${query}".`
          : `I couldn't find any tasks matching "${query}".`);
      }

      const tasks = resolution.matches.map(item => item.data);
      return {
        mode: 'confirm',
        response: buildTaskDeleteConfirmation(query, tasks, 'all', lang),
        confidence: resolution.best?.score ?? 0.84,
        steps: [{
          capability: 'tasks.delete_matching',
          args: {
            taskQuery: query,
            matchScope: 'all',
            ...(category !== 'any' ? { category } : {}),
          },
          requiresConfirmation: true,
        }],
      };
    }

    if (!resolution.best) {
      return buildClarifyPlan(lang === 'ar'
        ? `لم أجد مهمة تطابق "${query}".`
        : `I couldn't find a task matching "${query}".`);
    }

    if (resolution.ambiguous) {
      const names = resolution.matches.slice(0, 3).map(item => item.data.title).join(', ');
      return buildClarifyPlan(lang === 'ar'
        ? `أي مهمة تقصدين: ${names}؟`
        : `Which task did you mean: ${names}?`);
    }

    return {
      mode: 'confirm',
      response: buildTaskDeleteConfirmation(resolution.best.data.title, [resolution.best.data], 'one', lang),
      confidence: resolution.best.score,
      steps: [{
        capability: 'tasks.delete_matching',
        args: {
          taskQuery: resolution.best.data.title,
          matchScope: 'one',
          ...(category !== 'any' ? { category } : {}),
        },
        requiresConfirmation: true,
      }],
    };
  }

  return null;
}

function planNavigation(transcript: string, dialogState?: AssistantDialogState): ActionPlan | null {
  const lower = normaliseText(transcript);
  const words = lower.split(/\s+/);
  const likelyNavigation = words.length <= 4 || NAVIGATION_VERBS.some(verb => lower.includes(verb));
  if (!likelyNavigation) return null;

  const surface = resolveSurfaceReference(transcript, dialogState);
  if (!surface.best || surface.best.score < 0.6) return null;

  return {
    mode: 'act',
    response: '',
    confidence: surface.best.score,
    steps: [{
      capability: 'navigation.go_to_surface',
      args: { surface: surface.best.data },
    }],
  };
}

function planCalendarCreation(transcript: string, context: AssistantCommandContext, lang: AssistantLang): ActionPlan | null {
  const matcher = transcript.match(/(?:schedule|create|add|book)\s+(?:(an?|my)\s+)?(?:(meeting|event|appointment|call)\s+)?(.+)/i);
  if (!matcher) return null;

  if (context.calendarSources.length === 0) {
    return buildClarifyPlan(lang === 'ar' ? 'أضيفي تقويماً أولاً ثم سأتمكن من جدولة الموعد.' : 'Add a calendar first and then I can schedule the event.');
  }

  const eventKind = matcher[2];
  const remainder = matcher[3] || '';
  const calendarMatch = remainder.match(/\b(?:on|in|to)\s+(?:my\s+)?(.+?)\s+calendar\b/i);
  const calendarQuery = calendarMatch?.[1]?.trim();
  const remainderWithoutCalendar = calendarMatch ? remainder.replace(calendarMatch[0], ' ') : remainder;
  const extracted = extractTemporalReference(remainderWithoutCalendar, context);

  if (!extracted.resolution) {
    return buildClarifyPlan(RESPONSES.askEventTime[lang]);
  }

  const titleBase = sanitizeTitle(extracted.cleanedText);
  const title = sanitizeTitle(eventKind ? `${eventKind} ${titleBase}` : titleBase);
  if (!title) {
    return buildClarifyPlan(lang === 'ar' ? 'ما عنوان الموعد؟' : 'What should I call the event?');
  }

  return {
    mode: 'act',
    response: '',
    confidence: 0.88,
    steps: [{
      capability: 'calendar.create_event',
      args: {
        title,
        timePhrase: extracted.resolution.phrase,
        start: extracted.resolution.start,
        end: extracted.resolution.end,
        ...(calendarQuery ? { calendarQuery } : {}),
      },
    }],
  };
}

function planCalendarReschedule(transcript: string, context: AssistantCommandContext, lang: AssistantLang): ActionPlan | null {
  const matcher = transcript.match(/(?:move|push|reschedule)(?: my)?\s+(.+?)\s+(?:to|for)\s+(.+)/i);
  if (!matcher) return null;

  if (context.calendarEvents.length === 0) {
    return buildClarifyPlan(lang === 'ar' ? 'ليس لدي أي أحداث لتحريكها الآن.' : "I don't have any calendar events to move right now.");
  }

  const eventQuery = sanitizeTitle(matcher[1] || '');
  const extracted = extractTemporalReference(matcher[2] || '', context);
  if (!extracted.resolution) {
    return buildClarifyPlan(RESPONSES.askRescheduleTarget[lang]);
  }

  const eventResolution = resolveCalendarEventReference(eventQuery, context);
  const label = eventResolution.best?.data.title || eventQuery;
  const time = new Date(extracted.resolution.start).toLocaleString([], { hour: '2-digit', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric' });

  return {
    mode: 'confirm',
    response: lang === 'ar'
      ? `أستطيع نقل "${label}" إلى ${time}. هل تريدين أن أفعل ذلك؟`
      : `I can move "${label}" to ${time}. Do you want me to do that?`,
    confidence: 0.82,
    steps: [{
      capability: 'calendar.reschedule_event',
      args: {
        eventQuery,
        timePhrase: extracted.resolution.phrase,
        start: extracted.resolution.start,
        end: extracted.resolution.end,
      },
      requiresConfirmation: true,
    }],
  };
}

function planFinanceTransaction(transcript: string, lang: AssistantLang): ActionPlan | null {
  const expenseMatchers = [
    /(?:i\s+)?(?:spent|paid)\s+([£$]?\d+(?:\.\d{1,2})?)\s+(?:on\s+)?(.+?)(?:\s+from\s+(.+))?$/i,
    /(?:record|log|add)\s+(?:an?\s+)?expense\s+(?:of\s+)?([£$]?\d+(?:\.\d{1,2})?)(?:\s+for\s+(.+?))?(?:\s+from\s+(.+))?$/i,
  ];
  for (const matcher of expenseMatchers) {
    const match = transcript.match(matcher);
    if (!match) continue;
    return {
      mode: 'act',
      response: '',
      confidence: 0.84,
      steps: [{
        capability: 'finance.record_transaction',
        args: {
          type: 'expense',
          amount: match[1],
          description: sanitizeTitle(match[2] || 'Expense'),
          accountQuery: sanitizeTitle(match[3] || ''),
        },
      }],
    };
  }

  const incomeMatchers = [
    /(?:record|log|add)\s+(?:an?\s+)?income\s+(?:of\s+)?([£$]?\d+(?:\.\d{1,2})?)(?:\s+for\s+(.+?))?(?:\s+into\s+(.+))?$/i,
    /(?:i\s+)?(?:earned|received)\s+([£$]?\d+(?:\.\d{1,2})?)\s+from\s+(.+?)(?:\s+into\s+(.+))?$/i,
  ];
  for (const matcher of incomeMatchers) {
    const match = transcript.match(matcher);
    if (!match) continue;
    return {
      mode: 'act',
      response: '',
      confidence: 0.84,
      steps: [{
        capability: 'finance.record_transaction',
        args: {
          type: 'income',
          amount: match[1],
          description: sanitizeTitle(match[2] || 'Income'),
          accountQuery: sanitizeTitle(match[3] || ''),
        },
      }],
    };
  }

  if (/\b(?:record|log)\b/i.test(transcript) && /\b(?:expense|income|spent|paid|earned|received)\b/i.test(transcript)) {
    return buildClarifyPlan(RESPONSES.askFinanceAmount[lang]);
  }

  return null;
}

function planKnowledgeEntry(transcript: string, context: AssistantCommandContext, lang: AssistantLang): ActionPlan | null {
  const matcher = transcript.match(/(?:save|add|create)\s+(?:a\s+)?(?:knowledge\s+entry|note)\s+(?:about|on)?\s*(.+)/i);
  if (!matcher) return null;

  if (context.knowledgeTopics.length === 0) {
    return buildClarifyPlan(lang === 'ar' ? 'أنشئي موضوع معرفة أولاً ثم سأحفظ الملاحظة تحته.' : 'Create a knowledge topic first, then I can save the note under it.');
  }

  const raw = matcher[1] || '';
  const topicMatch = raw.match(/\b(?:under|in)\s+(.+?)\s+(?:topic|section)\b/i);
  const topicQuery = sanitizeTitle(topicMatch?.[1] || '');
  const content = sanitizeTitle(topicMatch ? raw.replace(topicMatch[0], ' ') : raw);
  const title = content.split(':')[0].slice(0, 60).trim() || 'Quick note';

  return {
    mode: 'act',
    response: '',
    confidence: 0.82,
    steps: [{
      capability: 'knowledge.create_entry',
      args: {
        title,
        content,
        topicQuery,
      },
    }],
  };
}

function planLocally(
  transcript: string,
  context: AssistantCommandContext,
  lang: AssistantLang,
  dialogState?: AssistantDialogState,
): PlannerResult | null {
  const lower = normaliseText(transcript);

  const queryPlan = planQueryLocally(lower, context, lang);
  if (queryPlan) return queryPlan;

  const taskCreate = planTaskCreation(transcript, context);
  if (taskCreate) return { plan: taskCreate, source: 'local' };

  const taskView = planTaskView(transcript);
  if (taskView) return { plan: taskView, source: 'local' };

  const taskReveal = planTaskReveal(transcript, dialogState);
  if (taskReveal) return { plan: taskReveal, source: 'local' };

  const taskDelete = planTaskDeletion(transcript, context, lang, dialogState);
  if (taskDelete) return { plan: taskDelete, source: 'local' };

  const taskComplete = planTaskCompletion(transcript);
  if (taskComplete) return { plan: taskComplete, source: 'local' };

  const reschedule = planCalendarReschedule(transcript, context, lang);
  if (reschedule) return { plan: reschedule, source: 'local' };

  const createEvent = planCalendarCreation(transcript, context, lang);
  if (createEvent) return { plan: createEvent, source: 'local' };

  const finance = planFinanceTransaction(transcript, lang);
  if (finance) return { plan: finance, source: 'local' };

  const knowledge = planKnowledgeEntry(transcript, context, lang);
  if (knowledge) return { plan: knowledge, source: 'local' };

  const navigation = planNavigation(transcript, dialogState);
  if (navigation) return { plan: navigation, source: 'local' };

  return null;
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

async function planWithHostedAssistant(
  transcript: string,
  context: AssistantCommandContext,
  options: {
    lang: AssistantLang;
    conversationHistory?: AssistantConversationMessage[];
    dialogState?: AssistantDialogState;
  },
): Promise<PlannerResult> {
  const availability = await getHostedAvailability();
  if (availability === 'sign_in_required') {
    return {
      plan: buildAnswerPlan(RESPONSES.hostedSignInRequired[options.lang]),
      source: 'degraded',
      degradedReason: 'hosted_sign_in_required',
    };
  }

  if (availability === 'not_configured') {
    return {
      plan: buildAnswerPlan(RESPONSES.hostedNotConfigured[options.lang]),
      source: 'degraded',
      degradedReason: 'hosted_not_configured',
    };
  }

  if (availability !== 'available') {
    return {
      plan: buildAnswerPlan(RESPONSES.hostedError[options.lang]('Hosted AI unavailable')),
      source: 'degraded',
      degradedReason: 'hosted_error',
    };
  }

  try {
    const response = await chatWithHostedAssistant(
      buildPlannerMessages(transcript, context, options.lang, options.conversationHistory, options.dialogState),
      actionPlanJsonSchema,
    );
    const plan = parsePlanFromModelResponse(response);

    if (!plan) {
      return {
        plan: buildAnswerPlan(response.trim() || RESPONSES.unknown[options.lang](transcript)),
        source: 'openai',
      };
    }

    return {
      plan: {
        ...plan,
        steps: plan.steps.map(step => ({
          ...step,
          requiresConfirmation: step.requiresConfirmation || RISKY_CAPABILITY_IDS.has(step.capability),
        })),
      },
      source: 'openai',
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
    };
  }
}

async function planWithOllama(
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
  const endpoint = options.endpoint || OLLAMA_ENDPOINT;
  const available = await isOllamaAvailable(endpoint);
  if (!available) {
    return {
      plan: buildAnswerPlan(RESPONSES.ollamaOffline[options.lang]),
      source: 'degraded',
      degradedReason: 'ollama_offline',
    };
  }

  try {
    const response = await chatWithOllama(
      buildPlannerMessages(transcript, context, options.lang, options.conversationHistory, options.dialogState),
      endpoint,
      options.model,
      actionPlanJsonSchema,
    );
    const plan = parsePlanFromModelResponse(response);

    if (!plan) {
      return {
        plan: buildAnswerPlan(response.trim() || RESPONSES.unknown[options.lang](transcript)),
        source: 'ollama',
      };
    }

    return {
      plan: {
        ...plan,
        steps: plan.steps.map(step => ({
          ...step,
          requiresConfirmation: step.requiresConfirmation || RISKY_CAPABILITY_IDS.has(step.capability),
        })),
      },
      source: 'ollama',
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
  const local = planLocally(transcript, context, options.lang, options.dialogState);
  if (local) {
    return local;
  }

  const provider = getAssistantProvider(options.provider);

  if (provider === 'hosted') {
    return planWithHostedAssistant(transcript, context, options);
  }

  if (provider === 'ollama') {
    return planWithOllama(transcript, context, options);
  }

  const hosted = await planWithHostedAssistant(transcript, context, options);
  if (hosted.source === 'openai') {
    return hosted;
  }
  if (hosted.degradedReason !== 'hosted_sign_in_required' && hosted.degradedReason !== 'hosted_not_configured') {
    const ollama = await planWithOllama(transcript, context, options);
    return ollama.source === 'ollama' ? ollama : hosted;
  }

  return planWithOllama(transcript, context, options);
}

export { SURFACE_LABELS };

/**
 * Voice Assistant Service — Intent parsing + ElevenLabs TTS
 *
 * Voice input: Deepgram API (primary) or Web Speech API (fallback)
 * Voice output: ElevenLabs API (cloned voice) with browser TTS fallback
 * Languages: English (en) and Arabic (ar)
 */

import type { Surface, CalendarEvent, Task, GamificationProfile } from '../types/domain';
import { chatWithOllama, buildSystemPrompt, testOllamaConnection, type OllamaMessage } from './ollamaApi';

// ── Intent Parsing ──

export type AssistantLang = 'en' | 'ar';

export interface LLMAction {
  type: 'navigate' | 'add_task' | 'complete_task' | 'complete_habit';
  surface?: Surface;
  taskTitle?: string;
  taskPriority?: string;
  taskCategory?: string;
}

export interface Intent {
  type: 'navigate' | 'query' | 'unknown';
  surface?: Surface;
  query?: string;
  response: string;
  action?: LLMAction;
}

const NAV_KEYWORDS: [string[], Surface][] = [
  [['dashboard', 'home', 'main', 'لوحة', 'الرئيسية'], 'dashboard'],
  [['chat', 'conversation', 'message', 'محادثة', 'رسالة'], 'chat'],
  [['calendar', 'schedule', 'meetings', 'events', 'تقويم', 'اجتماع', 'مواعيد'], 'calendar'],
  [['task', 'tasks', 'todo', 'to do', 'habits', 'مهام', 'مهمة', 'عادات'], 'tasks'],
  [['knowledge', 'islam', 'quran', 'learn', 'معرفة', 'إسلام', 'قرآن'], 'knowledge'],
  [['profile', 'stats', 'achievements', 'badges', 'level', 'ملف', 'إنجازات', 'مستوى'], 'profile'],
  [['credential', 'credentials', 'password', 'passwords', 'vault', 'كلمة سر', 'كلمات سر'], 'credentials'],
  [['workspace', 'workspaces', 'project', 'projects', 'مشاريع', 'مشروع'], 'workspaces'],
  [['integration', 'integrations', 'connect', 'ربط', 'تكامل'], 'integrations'],
  [['setting', 'settings', 'preferences', 'config', 'إعدادات', 'تفضيلات'], 'settings'],
  [['finance', 'money', 'budget', 'مالية', 'ميزانية', 'فلوس'], 'finance'],
];

const SURFACE_LABELS: Record<string, Record<AssistantLang, string>> = {
  dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
  chat: { en: 'Chat', ar: 'المحادثة' },
  calendar: { en: 'Calendar', ar: 'التقويم' },
  tasks: { en: 'Tasks', ar: 'المهام' },
  knowledge: { en: 'Knowledge', ar: 'المعرفة' },
  profile: { en: 'Profile', ar: 'الملف الشخصي' },
  credentials: { en: 'Credentials', ar: 'كلمات السر' },
  workspaces: { en: 'Workspaces', ar: 'المشاريع' },
  integrations: { en: 'Integrations', ar: 'التكاملات' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  finance: { en: 'Finance', ar: 'المالية' },
};

// ── Bilingual response templates ──

const RESPONSES = {
  opening: {
    en: (label: string) => `Opening ${label} for you.`,
    ar: (label: string) => `جاري فتح ${label}.`,
  },
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
    en: (count: number) => `You have ${count} task${count !== 1 ? 's' : ''} remaining.`,
    ar: (count: number) => count === 0 ? 'ليس لديك مهام متبقية.' :
      count === 1 ? 'لديك مهمة واحدة متبقية.' :
      count === 2 ? 'لديك مهمتان متبقيتان.' :
      `لديك ${count} مهام متبقية.`,
  },
  noStreak: {
    en: "You don't have an active streak right now. Complete a task to start one!",
    ar: 'ليس لديك سلسلة نشطة حالياً. أكمل مهمة لتبدأ واحدة!',
  },
  streak: {
    en: (s: number) => `You're on a ${s} day streak. Keep it going!`,
    ar: (s: number) => `أنت في سلسلة ${s} يوم. استمر!`,
  },
  level: {
    en: (lv: number, xp: number) => `You're level ${lv} with ${xp} XP.`,
    ar: (lv: number, xp: number) => `أنت في المستوى ${lv} مع ${xp} نقطة خبرة.`,
  },
  prayerTime: {
    en: (name: string, time: string) => `${name} is at ${time}.`,
    ar: (name: string, time: string) => `${name} الساعة ${time}.`,
  },
  noPrayerData: {
    en: "I don't have prayer times loaded right now.",
    ar: 'لا تتوفر لدي أوقات الصلاة حالياً.',
  },
  allPrayerTimes: {
    en: (list: string) => `Today's prayer times are: ${list}.`,
    ar: (list: string) => `أوقات الصلاة اليوم: ${list}.`,
  },
  prayerNotLoaded: {
    en: "Prayer times aren't loaded yet.",
    ar: 'لم يتم تحميل أوقات الصلاة بعد.',
  },
  unknown: {
    en: (transcript: string) =>
      `I heard "${transcript}" but I'm not sure what to do. Try saying "show me calendar" or "what's my next meeting".`,
    ar: (transcript: string) =>
      `سمعت "${transcript}" لكن لم أفهم المطلوب. جرب قول "افتح التقويم" أو "ما هو اجتماعي القادم".`,
  },
};

export function parseIntent(
  transcript: string,
  context: {
    calendarEvents: CalendarEvent[];
    tasks: Task[];
    gamification: GamificationProfile;
    prayerTimes?: { name: string; time: string }[];
  },
  lang: AssistantLang = 'en',
): Intent {
  const lower = transcript.toLowerCase().trim();

  // Navigation: "show me X", "go to X", "open X", "افتح X"
  for (const [keywords, surface] of NAV_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const label = SURFACE_LABELS[surface]?.[lang] || surface;
        return { type: 'navigate', surface, response: RESPONSES.opening[lang](label) };
      }
    }
  }

  // Query: "what's my next meeting" / "ما هو اجتماعي القادم"
  if (lower.includes('next meeting') || lower.includes('next event') || lower.includes('upcoming') ||
      lower.includes('اجتماع') || lower.includes('القادم') || lower.includes('الاجتماع')) {
    const now = new Date();
    const upcoming = context.calendarEvents
      .filter(e => new Date(e.start) > now && !e.allDay)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    if (upcoming.length === 0) {
      return { type: 'query', response: RESPONSES.noMeetings[lang] };
    }
    const next = upcoming[0];
    const time = new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { type: 'query', response: RESPONSES.nextMeeting[lang](next.title, time, next.location) };
  }

  // Query: "how many tasks" / "كم مهمة"
  if (lower.includes('how many task') || lower.includes('tasks left') || lower.includes('pending task') ||
      lower.includes('كم مهمة') || lower.includes('مهام') || lower.includes('المتبقية')) {
    const incomplete = context.tasks.filter(t => !t.completed && t.category !== 'goal').length;
    return { type: 'query', response: RESPONSES.tasksRemaining[lang](incomplete) };
  }

  // Query: "what's my streak" / "سلسلة"
  if (lower.includes('streak') || lower.includes('سلسلة')) {
    const s = context.gamification.currentStreak;
    if (s === 0) return { type: 'query', response: RESPONSES.noStreak[lang] };
    return { type: 'query', response: RESPONSES.streak[lang](s) };
  }

  // Query: "what level" / "مستوى"
  if (lower.includes('level') || lower.includes('what am i') || lower.includes('مستوى')) {
    const lv = context.gamification.level;
    return { type: 'query', response: RESPONSES.level[lang](lv, context.gamification.totalXp) };
  }

  // Query: prayer times
  const prayerNames = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'فجر', 'ظهر', 'عصر', 'مغرب', 'عشاء'];
  const prayerMap: Record<string, string> = {
    'فجر': 'fajr', 'ظهر': 'dhuhr', 'عصر': 'asr', 'مغرب': 'maghrib', 'عشاء': 'isha',
  };
  for (const pn of prayerNames) {
    if (lower.includes(pn)) {
      const normalised = prayerMap[pn] || pn;
      const pt = context.prayerTimes?.find(p => p.name.toLowerCase() === normalised);
      if (pt) return { type: 'query', response: RESPONSES.prayerTime[lang](pt.name, pt.time) };
      return { type: 'query', response: RESPONSES.noPrayerData[lang] };
    }
  }
  if (lower.includes('prayer') && lower.includes('time') || lower.includes('صلاة') || lower.includes('أوقات')) {
    if (context.prayerTimes && context.prayerTimes.length > 0) {
      const times = context.prayerTimes.filter(p => ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].includes(p.name));
      const list = times.map(p => `${p.name} ${lang === 'ar' ? 'الساعة' : 'at'} ${p.time}`).join(', ');
      return { type: 'query', response: RESPONSES.allPrayerTimes[lang](list) };
    }
    return { type: 'query', response: RESPONSES.prayerNotLoaded[lang] };
  }

  // Unknown
  return { type: 'unknown', response: RESPONSES.unknown[lang](transcript) };
}

// ── ElevenLabs TTS ──

export async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<HTMLAudioElement> {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`ElevenLabs API error: ${resp.status} ${resp.statusText}`);
  }

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  return audio;
}

// ── Browser TTS Fallback ──

export function speakWithBrowserTTS(text: string, lang: AssistantLang = 'en'): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-GB';

  const voices = speechSynthesis.getVoices();
  if (lang === 'ar') {
    const arabicVoice = voices.find(v => v.lang.startsWith('ar'));
    if (arabicVoice) utterance.voice = arabicVoice;
  } else {
    const femaleVoice = voices.find(v => v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Hazel'));
    if (femaleVoice) utterance.voice = femaleVoice;
  }
  speechSynthesis.speak(utterance);
}

// ── Ollama LLM Processing ──

let _ollamaAvailable: boolean | null = null;

/**
 * Check if Ollama is available (cached after first check, refreshes every 60s).
 */
export async function isOllamaAvailable(endpoint?: string): Promise<boolean> {
  if (_ollamaAvailable !== null) return _ollamaAvailable;
  _ollamaAvailable = await testOllamaConnection(endpoint);
  // Refresh cache after 60s
  setTimeout(() => { _ollamaAvailable = null; }, 60_000);
  return _ollamaAvailable;
}

/** Reset cached Ollama availability (call when settings change). */
export function resetOllamaCache(): void {
  _ollamaAvailable = null;
}

/**
 * Process a user message through the local Ollama LLM.
 * Returns an Intent with the LLM's response and any navigation action.
 */
export async function processWithLLM(
  transcript: string,
  context: {
    calendarEvents: CalendarEvent[];
    tasks: Task[];
    gamification: GamificationProfile;
    prayerTimes?: { name: string; time: string }[];
  },
  lang: AssistantLang = 'en',
  conversationHistory: OllamaMessage[] = [],
  endpoint?: string,
  model?: string,
): Promise<Intent> {
  const systemPrompt = buildSystemPrompt(context, lang);

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-10), // Last 5 exchanges (10 messages)
    { role: 'user', content: transcript },
  ];

  try {
    const response = await chatWithOllama(messages, endpoint, model);

    // Parse action tags from response
    const cleanResponse = response
      .replace(/\[NAV:\w+\]/g, '')
      .replace(/\[ADD_TASK:[^\]]+\]/g, '')
      .replace(/\[COMPLETE_TASK:[^\]]+\]/g, '')
      .replace(/\[COMPLETE_HABIT:[^\]]+\]/g, '')
      .trim();

    // Check for actions
    let action: LLMAction | undefined;

    const navMatch = response.match(/\[NAV:(\w+)\]/);
    if (navMatch) {
      action = { type: 'navigate', surface: navMatch[1] as Surface };
    }

    const addTaskMatch = response.match(/\[ADD_TASK:([^|]+)\|([^|]+)\|([^\]]+)\]/);
    if (addTaskMatch) {
      action = {
        type: 'add_task',
        taskTitle: addTaskMatch[1].trim(),
        taskPriority: addTaskMatch[2].trim(),
        taskCategory: addTaskMatch[3].trim(),
      };
    }

    const completeTaskMatch = response.match(/\[COMPLETE_TASK:([^\]]+)\]/);
    if (completeTaskMatch) {
      action = { type: 'complete_task', taskTitle: completeTaskMatch[1].trim() };
    }

    const completeHabitMatch = response.match(/\[COMPLETE_HABIT:([^\]]+)\]/);
    if (completeHabitMatch) {
      action = { type: 'complete_habit', taskTitle: completeHabitMatch[1].trim() };
    }

    return {
      type: action?.type === 'navigate' ? 'navigate' : 'query',
      surface: action?.surface,
      response: cleanResponse,
      action,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // Ollama failed — mark as unavailable and return error
    _ollamaAvailable = false;
    setTimeout(() => { _ollamaAvailable = null; }, 30_000);
    return {
      type: 'unknown',
      response: lang === 'ar'
        ? `لم أتمكن من الاتصال بـ Ollama: ${msg}`
        : `Couldn't reach Ollama: ${msg}`,
    };
  }
}

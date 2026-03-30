/**
 * Voice Assistant Service — Intent parsing + ElevenLabs TTS
 *
 * Voice input: Web Speech API (browser-native)
 * Voice output: ElevenLabs API (cloned voice) with browser TTS fallback
 */

import type { Surface, CalendarEvent, Task, GamificationProfile } from '../types/domain';

// ── Intent Parsing ──

export interface Intent {
  type: 'navigate' | 'query' | 'unknown';
  surface?: Surface;
  query?: string;
  response: string;
}

const NAV_KEYWORDS: [string[], Surface][] = [
  [['dashboard', 'home', 'main'], 'dashboard'],
  [['chat', 'conversation', 'message'], 'chat'],
  [['calendar', 'schedule', 'meetings', 'events'], 'calendar'],
  [['task', 'tasks', 'todo', 'to do', 'habits'], 'tasks'],
  [['knowledge', 'islam', 'quran', 'learn'], 'knowledge'],
  [['profile', 'stats', 'achievements', 'badges', 'level'], 'profile'],
  [['credential', 'credentials', 'password', 'passwords', 'vault'], 'credentials'],
  [['workspace', 'workspaces', 'project', 'projects'], 'workspaces'],
  [['integration', 'integrations', 'connect'], 'integrations'],
  [['setting', 'settings', 'preferences', 'config'], 'settings'],
];

export function parseIntent(
  transcript: string,
  context: {
    calendarEvents: CalendarEvent[];
    tasks: Task[];
    gamification: GamificationProfile;
    prayerTimes?: { name: string; time: string }[];
  },
): Intent {
  const lower = transcript.toLowerCase().trim();

  // Navigation: "show me X", "go to X", "open X"
  for (const [keywords, surface] of NAV_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const label = surface.charAt(0).toUpperCase() + surface.slice(1);
        return { type: 'navigate', surface, response: `Opening ${label} for you.` };
      }
    }
  }

  // Query: "what's my next meeting"
  if (lower.includes('next meeting') || lower.includes('next event') || lower.includes('upcoming')) {
    const now = new Date();
    const upcoming = context.calendarEvents
      .filter(e => new Date(e.start) > now && !e.allDay)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    if (upcoming.length === 0) {
      return { type: 'query', response: 'You have no upcoming meetings.' };
    }
    const next = upcoming[0];
    const time = new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { type: 'query', response: `Your next meeting is ${next.title} at ${time}${next.location ? `, at ${next.location}` : ''}.` };
  }

  // Query: "how many tasks"
  if (lower.includes('how many task') || lower.includes('tasks left') || lower.includes('pending task')) {
    const incomplete = context.tasks.filter(t => !t.completed && t.category !== 'goal').length;
    return { type: 'query', response: `You have ${incomplete} task${incomplete !== 1 ? 's' : ''} remaining.` };
  }

  // Query: "what's my streak"
  if (lower.includes('streak')) {
    const s = context.gamification.currentStreak;
    if (s === 0) return { type: 'query', response: `You don't have an active streak right now. Complete a task to start one!` };
    return { type: 'query', response: `You're on a ${s} day streak. Keep it going!` };
  }

  // Query: "what level"
  if (lower.includes('level') || lower.includes('what am i')) {
    const lv = context.gamification.level;
    return { type: 'query', response: `You're level ${lv} with ${context.gamification.totalXp} XP.` };
  }

  // Query: prayer times
  const prayerNames = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  for (const pn of prayerNames) {
    if (lower.includes(pn)) {
      const pt = context.prayerTimes?.find(p => p.name.toLowerCase() === pn);
      if (pt) return { type: 'query', response: `${pt.name} is at ${pt.time}.` };
      return { type: 'query', response: `I don't have prayer times loaded right now.` };
    }
  }
  if (lower.includes('prayer') && lower.includes('time')) {
    if (context.prayerTimes && context.prayerTimes.length > 0) {
      const times = context.prayerTimes.filter(p => ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].includes(p.name));
      const list = times.map(p => `${p.name} at ${p.time}`).join(', ');
      return { type: 'query', response: `Today's prayer times are: ${list}.` };
    }
    return { type: 'query', response: `Prayer times aren't loaded yet.` };
  }

  // Unknown
  return { type: 'unknown', response: `I heard "${transcript}" but I'm not sure what to do. Try saying "show me calendar" or "what's my next meeting".` };
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

export function speakWithBrowserTTS(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  utterance.lang = 'en-GB';
  // Try to find a female voice
  const voices = speechSynthesis.getVoices();
  const femaleVoice = voices.find(v => v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Hazel'));
  if (femaleVoice) utterance.voice = femaleVoice;
  speechSynthesis.speak(utterance);
}

/**
 * Ollama Local LLM Service
 *
 * Connects to a local Ollama instance for real AI conversations.
 * Ollama runs at http://localhost:11434 by default — no API key needed.
 *
 * Install: https://ollama.com
 * Then: ollama pull llama3.2
 */

import type { CalendarEvent, Task, GamificationProfile } from '../types/domain';
import type { AssistantLang } from './voiceAssistant';
import { API_TIMEOUT, LIMITS, TIMING } from '../config/constants';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
}

// ── API Functions ──

/**
 * Send a chat completion request to Ollama.
 */
export async function chatWithOllama(
  messages: OllamaMessage[],
  endpoint: string = DEFAULT_ENDPOINT,
  model: string = DEFAULT_MODEL,
): Promise<string> {
  const resp = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(API_TIMEOUT.OLLAMA_CHAT),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: false, // Disable extended thinking (qwen3) for faster responses
      options: {
        temperature: LIMITS.LLM_TEMPERATURE,
        num_predict: LIMITS.LLM_MAX_TOKENS, // Keep responses concise
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }

  const data: OllamaChatResponse = await resp.json();
  return data.message?.content || '';
}

/**
 * Test if Ollama is running and reachable.
 */
export async function testOllamaConnection(endpoint: string = DEFAULT_ENDPOINT): Promise<boolean> {
  try {
    const resp = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(TIMING.OLLAMA_CONNECTION_TIMEOUT),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * List available models from Ollama.
 */
export async function listOllamaModels(endpoint: string = DEFAULT_ENDPOINT): Promise<string[]> {
  try {
    const resp = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(TIMING.OLLAMA_MODEL_LIST_TIMEOUT),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

// ── Context Builder ──

interface LLMContext {
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  gamification: GamificationProfile;
  prayerTimes?: { name: string; time: string }[];
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Build a compact system prompt with the user's live data.
 * Keeps it short for fast inference on small models.
 */
export function buildSystemPrompt(context: LLMContext, lang: AssistantLang = 'en'): string {
  const now = new Date();
  const today = toLocalDateStr(now);
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

  // Upcoming events (next 24h)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const upcoming = context.calendarEvents
    .filter(e => {
      const start = new Date(e.start);
      return start >= now && start <= tomorrow && !e.allDay;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, 5);

  const upcomingStr = upcoming.length > 0
    ? upcoming.map(e => {
        const t = new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `- ${e.title} at ${t}${e.location ? ` (${e.location})` : ''}`;
      }).join('\n')
    : 'No upcoming events.';

  // Pending tasks
  const pendingTasks = context.tasks
    .filter(t => !t.completed && t.category !== 'goal')
    .slice(0, 8);
  const tasksStr = pendingTasks.length > 0
    ? pendingTasks.map(t => `- ${t.emoji || ''} ${t.title} [${t.priority}]${t.dueDate ? ` due ${t.dueDate}` : ''}`).join('\n')
    : 'No pending tasks.';

  // Goals
  const goals = context.tasks
    .filter(t => !t.completed && t.category === 'goal')
    .slice(0, 5);
  const goalsStr = goals.length > 0
    ? goals.map(g => `- ${g.title}${g.goalTag ? ` [${g.goalTag}]` : ''}`).join('\n')
    : '';

  // Daily habits done today
  const dailyLog = context.gamification.dailyLog || {};
  const todayLog = dailyLog[today] || [];
  const dailyHabits = context.tasks.filter(t => t.category === 'daily' && !t.completed);
  const habitsTotal = dailyHabits.length + todayLog.length;
  const habitsDone = todayLog.length;

  // Prayer times
  const prayerStr = context.prayerTimes
    ? context.prayerTimes.map(p => `${p.name}: ${p.time}`).join(', ')
    : '';

  // Gamification
  const g = context.gamification;

  const langInstruction = lang === 'ar'
    ? 'Respond in Arabic (العربية). Use RTL-friendly text.'
    : 'Respond in English.';

  return `You are Lina, a friendly and concise personal assistant in the HELM app.
${langInstruction}
Keep responses short (2-3 sentences max for voice, slightly longer for chat).
Today is ${today}, current time is ${timeStr}.

USER'S DATA:
Level ${g.level} | ${g.totalXp} XP | ${g.currentStreak}-day streak | ${g.totalTasksCompleted} tasks completed

Upcoming events (next 24h):
${upcomingStr}

Pending tasks:
${tasksStr}
${goalsStr ? `\nGoals:\n${goalsStr}` : ''}

Daily habits: ${habitsDone}/${habitsTotal} done today
${prayerStr ? `Prayer times: ${prayerStr}` : ''}

ACTIONS:
You can perform actions by including action tags in your response. Only include actions when the user clearly requests them.

Navigation — go to a page:
[NAV:surface_name]
Valid surfaces: dashboard, chat, calendar, tasks, finance, knowledge, profile, credentials, workspaces, integrations, settings
Example: "Sure, let me open that for you. [NAV:calendar]"

Add a task:
[ADD_TASK:title|priority|category]
priority: low, medium, high
category: daily, task, goal
Example: "Done! I've added it. [ADD_TASK:Buy groceries|medium|task]"

Complete a task (by title match):
[COMPLETE_TASK:title]
Example: "Marked as done! [COMPLETE_TASK:Buy groceries]"

Complete a daily habit (by title match):
[COMPLETE_HABIT:title]
Example: "Great work! [COMPLETE_HABIT:Drink 1L Water]"

Rules:
- Only include ONE action tag per response
- Always explain what you're doing in natural language before the tag
- For task/habit completion, match the title as closely as possible to existing items
- If the user just wants to chat, don't include any action tags
- Keep responses concise (2-3 sentences for voice, can be longer for chat)`;
}

/**
 * Pre-configured circuit breakers for each external service.
 *
 * Import the breaker for a service and wrap API calls with breaker.call().
 * If a service fails 3 times consecutively, the breaker opens for 60s
 * (fast-fail), preventing cascading failures and wasted API calls.
 */

import { CircuitBreaker } from './circuitBreaker';

/** Google Calendar API — opens after 3 failures, 60s cooldown */
export const googleCalendarBreaker = new CircuitBreaker({
  name: 'GoogleCalendar',
  maxFailures: 3,
  cooldownMs: 60_000,
});

/** Ollama LLM — opens after 2 failures, 30s cooldown (local service, faster recovery) */
export const ollamaBreaker = new CircuitBreaker({
  name: 'Ollama',
  maxFailures: 2,
  cooldownMs: 30_000,
});

/** Hosted assistant — opens after 2 failures, 30s cooldown (fast recovery for transient provider issues) */
export const hostedAssistantBreaker = new CircuitBreaker({
  name: 'HostedAssistant',
  maxFailures: 2,
  cooldownMs: 30_000,
});

/** Deepgram STT — opens after 3 failures, 60s cooldown */
export const deepgramBreaker = new CircuitBreaker({
  name: 'Deepgram',
  maxFailures: 3,
  cooldownMs: 60_000,
});

/** ElevenLabs TTS — opens after 3 failures, 60s cooldown */
export const elevenLabsBreaker = new CircuitBreaker({
  name: 'ElevenLabs',
  maxFailures: 3,
  cooldownMs: 60_000,
});

/** Monzo Bank API — opens after 2 failures, 120s cooldown (SCA approval may be needed) */
export const monzoBreaker = new CircuitBreaker({
  name: 'Monzo',
  maxFailures: 2,
  cooldownMs: 120_000,
});

/** AlAdhan Prayer Times API — opens after 3 failures, 300s cooldown (infrequent calls) */
export const prayerTimesBreaker = new CircuitBreaker({
  name: 'PrayerTimes',
  maxFailures: 3,
  cooldownMs: 300_000,
});

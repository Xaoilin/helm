import type { Surface } from '../types/domain';

/**
 * Build-time switches for features deprecated on 2026-09-26.
 *
 * Life Hero, the Lina assistant, and voice are disabled and scheduled for
 * removal from the codebase. See docs/deprecated-features.md for every file
 * involved and the removal checklist.
 *
 * These are product decisions, not user settings: a stored `lifeHeroEnabled`
 * or `assistantEnabled` setting never turns a disabled feature back on.
 * Remove each switch, and every branch it guards, when its feature is deleted.
 *
 * The `as boolean` keeps both branches type-checked while the code remains.
 */

/** Life Hero companion, daily adventure, and the evidence sources that feed it. */
export const LIFE_HERO_ENABLED = false as boolean;

/** Lina assistant: Chat surface, planner, hosted AI and Ollama checks, audit trail. */
export const ASSISTANT_ENABLED = false as boolean;

/** Voice: wake word, speech recognition, microphone access, and speech playback. */
export const VOICE_ENABLED = false as boolean;

/** Surfaces that only exist for a disabled feature. */
const DEPRECATED_SURFACES: ReadonlySet<Surface> = new Set<Surface>(ASSISTANT_ENABLED ? [] : ['chat']);

/** Whether navigation may offer, restore, or open this surface. */
export function isSurfaceAvailable(surface: Surface): boolean {
  return !DEPRECATED_SURFACES.has(surface);
}

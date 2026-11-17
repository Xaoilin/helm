import { z } from 'zod';
import { AI_UPDATES_URL } from '../config/aiUpdates';
import type { AiUpdatesSnapshot } from '../types/domain';

const BUNDLED_URL = `${import.meta.env.BASE_URL}ai-updates.json`;
const REQUEST_TIMEOUT_MS = 5_000;
export const AI_UPDATES_REFRESH_MS = 30 * 60_000;
export const AI_UPDATES_STALE_MS = 14 * 60 * 60_000;
const NEW_RELEASE_MS = 48 * 60 * 60_000;

const linkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.url({ protocol: /^https$/ }).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
});
const discussionSchema = linkSchema.extend({
  preview: z.string().trim().min(1).max(300).optional(),
  points: z.int().nonnegative().optional(),
  comments: z.int().nonnegative().optional(),
  observedAt: z.iso.datetime().optional(),
});
const snapshotSchema: z.ZodType<AiUpdatesSnapshot> = z.object({
  updatedAt: z.iso.datetime(),
  stories: z.array(z.object({
    id: z.string().min(1).max(250),
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(650),
    publishedAt: z.iso.datetime(),
    category: z.enum(['coding', 'models', 'research']),
    source: linkSchema,
    discussions: z.array(discussionSchema).max(4),
    featured: z.boolean(),
  })).max(30).refine(stories => new Set(stories.map(story => story.id)).size === stories.length),
});

async function readSnapshot(url: string, signal: AbortSignal): Promise<AiUpdatesSnapshot> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`AI updates returned HTTP ${response.status}`);
  return snapshotSchema.parse(await response.json());
}

export async function loadAiUpdates(signal: AbortSignal) {
  try {
    return { snapshot: await readSnapshot(AI_UPDATES_URL, signal), offline: false };
  } catch (error) {
    signal.throwIfAborted();
    console.warn('AI Updates refresh failed', error);
    return { snapshot: await readSnapshot(BUNDLED_URL, signal), offline: true };
  }
}

export function newestAiRelease(snapshot: AiUpdatesSnapshot, now: number): number {
  return snapshot.stories.reduce((latest, story) => {
    const publishedAt = Date.parse(story.publishedAt);
    return story.featured && publishedAt <= now && now - publishedAt < NEW_RELEASE_MS
      ? Math.max(latest, publishedAt)
      : latest;
  }, 0);
}

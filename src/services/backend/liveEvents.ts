/**
 * The live-update streams: one server-sent-event stream per server that hosts a service
 * (`/api/live/v1/events`), read with the signed-in user's Supabase token in the Authorization header.
 * Every change a service saves arrives as an event naming its domain, so open tabs reload that domain
 * instead of polling; prayer reminders arrive the same way. A stream that ends (its token expired) or
 * fails reconnects with backoff; after a reconnect a synthetic `live.ready` event asks every listener to
 * reload what it may have missed.
 */
import { liveGatewayOrigins } from '../../config';
import { getFreshAccessToken } from '../../store/supabase';
import { backoffDelayMs } from '../backoff';
import { logWarn } from '../logger';
import { liveEventSchema, type LiveEvent } from './liveContracts';

export type LiveListener = (event: LiveEvent) => void;

/** Sent to listeners when a stream reconnects: anything may have changed while it was down. */
export const LIVE_READY = 'live.ready';

const EVENTS_PATH = '/api/live/v1/events';
const RECONNECT = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
/** A stream that ends sooner than this counts as a failure, so a server that keeps closing is not hammered. */
const HEALTHY_STREAM_MS = 60_000;
const SIGNED_OUT_RETRY_MS = 30_000;

const listeners = new Set<LiveListener>();

export function subscribeLiveEvents(listener: LiveListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dispatch(event: LiveEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      logWarn('LiveEvents', `A listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** One parsed server-sent event: its name and data (lines joined), or null for a comment-only block. */
export interface SseMessage {
  event: string;
  data: string;
}

/** Splits buffered stream text into complete events; returns them and the unfinished rest. */
export function parseSseBuffer(buffer: string): { messages: SseMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/gu, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages: SseMessage[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line === '') continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /u, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) messages.push({ event, data: data.join('\n') });
  }
  return { messages, rest };
}

/** A `change` message as a live event; null when it does not match the contract. */
export function toLiveEvent(message: SseMessage): LiveEvent | null {
  if (message.event !== 'change') return null;
  try {
    const parsed = liveEventSchema.safeParse(JSON.parse(message.data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function readStream(body: ReadableStream<Uint8Array>, onReady: () => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const { messages, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const message of messages) {
      if (message.event === 'ready') {
        onReady();
        continue;
      }
      const event = toLiveEvent(message);
      if (event) dispatch(event);
    }
  }
}

/** Keeps one server's stream open until `signal` aborts. */
async function stream(origin: string, signal: AbortSignal): Promise<void> {
  let failures = 0;
  let connectedBefore = false;
  let rejectedToken = false;
  while (!signal.aborted) {
    try {
      // The session renews its token by itself; a forced renewal is only for a token the gateway refused.
      const token = await getFreshAccessToken({ forceRefresh: rejectedToken });
      rejectedToken = false;
      if (!token) {
        await sleep(SIGNED_OUT_RETRY_MS, signal);
        continue;
      }
      const response = await fetch(`${origin}${EVENTS_PATH}`, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal,
      });
      rejectedToken = response.status === 401;
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const openedAt = Date.now();
      await readStream(response.body, () => {
        if (connectedBefore) {
          dispatch({ type: LIVE_READY, domain: 'live', at: new Date().toISOString(), data: null });
        }
        connectedBefore = true;
      });
      // The stream ended (its token expired, or the server restarted): reconnect, backing off if it was brief.
      failures = Date.now() - openedAt >= HEALTHY_STREAM_MS ? 0 : failures + 1;
      await sleep(backoffDelayMs(failures, RECONNECT), signal);
    } catch (error) {
      if (signal.aborted) return;
      logWarn('LiveEvents', `Stream from ${origin} failed: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(backoffDelayMs(failures, RECONNECT), signal);
      failures += 1;
    }
  }
}

/** Opens a stream to every server that hosts a configured service; returns a function that closes them. */
export function startLiveEvents(origins: string[] = liveGatewayOrigins()): () => void {
  if (typeof fetch !== 'function' || typeof ReadableStream === 'undefined') return () => undefined;
  const controller = new AbortController();
  for (const origin of origins) void stream(origin, controller.signal);
  return () => controller.abort();
}

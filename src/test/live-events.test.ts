import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_READY, parseSseBuffer, startLiveEvents, subscribeLiveEvents, toLiveEvent } from '../services/backend/liveEvents';
import type { LiveEvent } from '../services/backend/liveContracts';

vi.mock('../store/supabase', () => ({ getFreshAccessToken: vi.fn(async () => 'token-1') }));

const CHANGE = '{"type":"lifestyle.save-item","domain":"lifestyle","at":"2026-09-27T02:38:26.055911Z","data":null}';

describe('live-update stream parsing', () => {
  it('splits complete events, keeps the unfinished rest, and skips comments', () => {
    const { messages, rest } = parseSseBuffer(`event:ready\ndata:2026-09-27T02:38:26Z\n\n:keep-alive\n\nevent:change\r\ndata:${CHANGE}\r\n\r\nevent:chan`);

    expect(messages).toEqual([
      { event: 'ready', data: '2026-09-27T02:38:26Z' },
      { event: 'change', data: CHANGE },
    ]);
    expect(rest).toBe('event:chan');
  });

  it('reads a change event that matches the contract, and nothing else', () => {
    expect(toLiveEvent({ event: 'change', data: CHANGE })).toMatchObject({ type: 'lifestyle.save-item', domain: 'lifestyle' });
    expect(toLiveEvent({ event: 'change', data: '{"type":1}' })).toBeNull();
    expect(toLiveEvent({ event: 'change', data: 'not json' })).toBeNull();
    expect(toLiveEvent({ event: 'ready', data: CHANGE })).toBeNull();
  });
});

describe('live-update streams', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens one authenticated stream per server and delivers its change events to listeners', async () => {
    const encoder = new TextEncoder();
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event:ready\ndata:now\n\nevent:change\ndata:${CHANGE}\n\n`));
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const received: LiveEvent[] = [];
    const unsubscribe = subscribeLiveEvents(event => received.push(event));

    const stop = startLiveEvents(['https://one.test', 'https://two.test']);
    await vi.waitFor(() => expect(received.filter(event => event.type === 'lifestyle.save-item')).toHaveLength(2));
    stop();
    unsubscribe();

    expect(fetch).toHaveBeenCalledWith('https://one.test/api/live/v1/events', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    }));
    expect(fetch).toHaveBeenCalledWith('https://two.test/api/live/v1/events', expect.anything());
    // The first connection is not a reconnect, so nothing asks listeners to catch up.
    expect(received.some(event => event.type === LIVE_READY)).toBe(false);
  });
});

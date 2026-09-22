import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getClient, initSupabase, setCurrentUserId, subscribeHelmBroadcast } from '../store/supabase';

class FailingSocket {
  static instances: FailingSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();

  constructor() {
    FailingSocket.instances.push(this);
  }

  fail(): void {
    this.readyState = 3;
    this.onerror?.(new Event('error'));
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }

  close(): void {
    this.readyState = 3;
  }
}

describe('installed Realtime SDK recovery boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FailingSocket);
    FailingSocket.instances = [];
    initSupabase('https://project.supabase.test', 'public-key');
    setCurrentUserId('synthetic-account');
  });

  afterEach(async () => {
    const client = getClient();
    await client?.realtime.removeAllChannels();
    await client?.auth.dispose();
    initSupabase('', '');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stops SDK socket retries when the last Broadcast subscription is removed', async () => {
    const unsubscribe = subscribeHelmBroadcast(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(FailingSocket.instances).toHaveLength(1);
    FailingSocket.instances[0].fail();

    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(getClient()?.realtime.getChannels()).toHaveLength(0);
    expect(FailingSocket.instances).toHaveLength(1);
  });

  it('keeps another channel connected when the Broadcast subscription is removed', async () => {
    const unsubscribe = subscribeHelmBroadcast(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    getClient()?.channel('other-owner').subscribe();
    FailingSocket.instances[0].fail();

    unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getClient()?.realtime.getChannels().map(channel => channel.topic)).toEqual(['realtime:other-owner']);
    expect(FailingSocket.instances).toHaveLength(2);
  });
});

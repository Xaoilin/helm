// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initSupabase,
  isSupabaseReady,
  loadRemote,
  saveRemote,
  loadAllRemote,
  queueRemoteWrite,
  flushWriteQueue,
} from '../store/supabase';

// Mock the Supabase client — chain .eq() calls flexibly
const mockSingle = vi.fn();
interface EqChain {
  eq: (column: string, value: unknown) => EqChain;
  single: typeof mockSingle;
  select: () => EqChain;
}

const makeEqChain = (): EqChain => {
  const chain: EqChain = { eq: () => chain, single: mockSingle, select: () => chain };
  return chain;
};
const mockSelect = vi.fn(() => makeEqChain());
const mockUpsert = vi.fn(() => ({ error: null }));
const mockDelete = vi.fn(() => makeEqChain());
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  upsert: mockUpsert,
  delete: mockDelete,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

describe('Supabase persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should not be ready before init', () => {
      // Reset by passing empty strings
      initSupabase('', '');
      expect(isSupabaseReady()).toBe(false);
    });

    it('should be ready after init with valid credentials', () => {
      initSupabase('https://test.supabase.co', 'test-key');
      expect(isSupabaseReady()).toBe(true);
    });

    it('should not be ready with empty url', () => {
      initSupabase('', 'test-key');
      expect(isSupabaseReady()).toBe(false);
    });

    it('should not be ready with empty key', () => {
      initSupabase('https://test.supabase.co', '');
      expect(isSupabaseReady()).toBe(false);
    });
  });

  describe('loadRemote', () => {
    it('should return null when not initialized', async () => {
      initSupabase('', '');
      const result = await loadRemote('helm', 'settings');
      expect(result).toBeNull();
    });

    it('should return value and timestamp when data exists', async () => {
      initSupabase('https://test.supabase.co', 'key');
      mockSingle.mockResolvedValueOnce({
        data: { value: { theme: 'dark' }, updated_at: '2026-03-29T10:00:00Z' },
        error: null,
      });

      const result = await loadRemote('helm', 'settings');
      expect(result).toEqual({
        value: { theme: 'dark' },
        updatedAt: '2026-03-29T10:00:00Z',
      });
    });

    it('should return null on error', async () => {
      initSupabase('https://test.supabase.co', 'key');
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await loadRemote('helm', 'settings');
      expect(result).toBeNull();
    });
  });

  describe('saveRemote', () => {
    it('should return false when not initialized', async () => {
      initSupabase('', '');
      const result = await saveRemote('helm', 'settings', { theme: 'dark' });
      expect(result).toBe(false);
    });

    it('should return true on successful upsert', async () => {
      initSupabase('https://test.supabase.co', 'key');
      mockUpsert.mockReturnValueOnce({ error: null });

      const result = await saveRemote('helm', 'settings', { theme: 'dark' });
      expect(result).toBe(true);
    });

    it('should return false on upsert error', async () => {
      initSupabase('https://test.supabase.co', 'key');
      mockUpsert.mockReturnValueOnce({ error: { message: 'Failed' } });

      const result = await saveRemote('helm', 'settings', { theme: 'dark' });
      expect(result).toBe(false);
    });
  });

  describe('loadAllRemote', () => {
    it('should return empty array when not initialized', async () => {
      initSupabase('', '');
      const result = await loadAllRemote('helm');
      expect(result).toEqual([]);
    });
  });

  describe('queueRemoteWrite', () => {
    it('should not throw when not initialized', () => {
      initSupabase('', '');
      expect(() => queueRemoteWrite('helm', 'test', { a: 1 })).not.toThrow();
    });
  });

  describe('flushWriteQueue', () => {
    it('should not throw when not initialized', async () => {
      initSupabase('', '');
      await expect(flushWriteQueue()).resolves.not.toThrow();
    });
  });
});

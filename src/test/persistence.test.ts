import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadStore, saveStore } from '../store/persistence';

describe('Persistence layer', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('loadStore', () => {
    it('should return null for non-existent key', async () => {
      const result = await loadStore('nonexistent');
      expect(result).toBeNull();
    });

    it('should return parsed JSON for existing key', async () => {
      localStorage.setItem('helm:test', JSON.stringify({ foo: 'bar' }));
      const result = await loadStore<{ foo: string }>('test');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return null for invalid JSON', async () => {
      localStorage.setItem('helm:bad', 'not-json{{{');
      const result = await loadStore('bad');
      expect(result).toBeNull();
    });

    it('should handle arrays', async () => {
      localStorage.setItem('helm:list', JSON.stringify([1, 2, 3]));
      const result = await loadStore<number[]>('list');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle empty string values', async () => {
      localStorage.setItem('helm:empty', '""');
      const result = await loadStore<string>('empty');
      expect(result).toBe('');
    });
  });

  describe('saveStore', () => {
    it('should persist object to localStorage', async () => {
      await saveStore('data', { name: 'test', count: 42 });
      const raw = localStorage.getItem('helm:data');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual({ name: 'test', count: 42 });
    });

    it('should persist arrays', async () => {
      await saveStore('items', ['a', 'b', 'c']);
      const raw = localStorage.getItem('helm:items');
      expect(JSON.parse(raw!)).toEqual(['a', 'b', 'c']);
    });

    it('should overwrite existing values', async () => {
      await saveStore('key', 'first');
      await saveStore('key', 'second');
      const raw = localStorage.getItem('helm:key');
      expect(JSON.parse(raw!)).toBe('second');
    });
  });

  describe('round-trip', () => {
    it('should save and load complex nested objects', async () => {
      const data = {
        accounts: [{ id: '1', email: 'test@test.com', sources: [{ id: 's1', name: 'Cal' }] }],
        settings: { theme: 'dark', nested: { deep: true } },
      };
      await saveStore('complex', data);
      const loaded = await loadStore('complex');
      expect(loaded).toEqual(data);
    });

    it('should save and load null values', async () => {
      await saveStore('nullable', null);
      const loaded = await loadStore('nullable');
      expect(loaded).toBeNull();
    });
  });
});

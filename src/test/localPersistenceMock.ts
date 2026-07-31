import type * as Persistence from '../store/persistence';

/**
 * Unit-only provider adapter. Feature-state tests use a deterministic in-memory
 * database stand-in; production persistence is covered separately.
 */
export function createLocalPersistenceMock(actual: typeof Persistence): typeof Persistence {
  return {
    ...actual,
    loadStore: async <T>(key: string): Promise<T | null> => {
      const raw = localStorage.getItem(`helm:${key}`);
      return raw === null ? null : JSON.parse(raw) as T;
    },
    saveStore: async <T>(key: string, value: T): Promise<void> => {
      localStorage.setItem(`helm:${key}`, JSON.stringify(value));
    },
    loadDeviceStore: async <T>(key: Parameters<typeof actual.loadDeviceStore<T>>[0]): Promise<T | null> => {
      const raw = localStorage.getItem(`helm:device:${key}`);
      return raw === null ? null : JSON.parse(raw) as T;
    },
    saveDeviceStore: async <T>(
      key: Parameters<typeof actual.saveDeviceStore<T>>[0],
      value: T,
    ): Promise<void> => {
      localStorage.setItem(`helm:device:${key}`, JSON.stringify(value));
    },
  };
}

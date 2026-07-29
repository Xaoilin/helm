if (typeof globalThis.document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}

// Mock the Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel<T> {
    onmessage?: (message: T) => void;
  },
  invoke: vi.fn().mockRejectedValue(new Error('Tauri not available')),
}));

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] || null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] || null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock sessionStorage
const sessionStore: Record<string, string> = {};
const sessionStorageMock = {
  getItem: vi.fn((key: string) => sessionStore[key] || null),
  setItem: vi.fn((key: string, value: string) => { sessionStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete sessionStore[key]; }),
  clear: vi.fn(() => { Object.keys(sessionStore).forEach(k => delete sessionStore[k]); }),
  get length() { return Object.keys(sessionStore).length; },
  key: vi.fn((i: number) => Object.keys(sessionStore)[i] || null),
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock });

const clipboardMock = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(''),
};

if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: clipboardMock,
    configurable: true,
  });
}

if (typeof HTMLElement !== 'undefined') {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
}

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  value: MockResizeObserver,
  configurable: true,
});

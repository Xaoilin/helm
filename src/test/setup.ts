import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// Keep date-only domain calculations independent of the machine running Vitest.
process.env.TZ = 'UTC';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

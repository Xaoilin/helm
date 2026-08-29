/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }
export function resolveAssetBase(): string {
  return '/helm/'
}

export const vitestExcludedPaths = ['node_modules', 'e2e', '.codex_tmp/**', '.ai/**']

export default defineConfig({
  plugins: [react()],
  base: resolveAssetBase(),
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        lifeHeroConcept: fileURLToPath(new URL('./concepts/life-hero/index.html', import.meta.url)),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    // Preserve uncaught browser errors without forwarding expected app logging.
    forwardConsole: {
      unhandledErrors: true,
      logLevels: [],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Layout is covered by Playwright; unit tests stub CSS to avoid needless transforms.
    css: false,
    pool: 'forks',
    maxWorkers: process.env.CI ? 2 : 10,
    // Keep successful expected warnings out of hosted logs; failed-test output remains visible.
    silent: 'passed-only',
    exclude: vitestExcludedPaths,
  },
})

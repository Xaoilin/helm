/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  base: '/helm/',
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
    watch: {
      ignored: ['**/src-tauri/target/**'],
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
    exclude: ['node_modules', 'e2e', '.codex_tmp/**'],
    alias: {
      'openwakeword-wasm-browser': path.resolve(__dirname, 'src/test/__mocks__/openwakeword.ts'),
    },
  },
})

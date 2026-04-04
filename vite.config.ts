/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/helm/',
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    alias: {
      '@picovoice/porcupine-react': path.resolve(__dirname, 'src/test/__mocks__/porcupine-react.ts'),
      '@picovoice/porcupine-web': path.resolve(__dirname, 'src/test/__mocks__/porcupine-web.ts'),
    },
  },
})

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.codex_tmp/**', 'supabase/.temp/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ESLint 10 and the current React Hooks preset promote these new rules.
      // Keep the established HELM baseline while they are adopted deliberately.
      'no-useless-assignment': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // UI import boundary: surfaces and components reach Supabase through a
    // specific gateway module (for example `store/supabase/secrets`) or a
    // service, never through the compatibility barrel, and use the stable
    // `store/persistence` consumer API rather than its internals.
    files: ['src/surfaces/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '(^|/)store/supabase$',
            message: 'Import the specific gateway module under store/supabase/ (or a service); the store/supabase barrel is for existing non-UI code only.',
          },
          {
            regex: '(^|/)store/persistence/',
            message: 'Use the store/persistence consumer API; its internal modules are not a UI dependency.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/store/**/*.ts', 'src/store/**/*.tsx', 'src/test/**/*.ts', 'src/test/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])

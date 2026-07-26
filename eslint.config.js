import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
  },
  // shadcn/ui-Komponenten sind generiert (nicht von Hand umschreiben) und
  // exportieren neben Komponenten auch Varianten/Hooks; das Skeleton nutzt
  // bewusst Math.random für Zufallsbreiten. Carousel und use-mobile setzen
  // im Effekt synchron State (generiertes shadcn-Idiom).
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/hooks/use-mobile.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Provider exportieren neben der Komponente auch Hooks (useAuth) bzw.
  // den trpc-Client — Fast Refresh ist hier unkritisch.
  {
    files: ['src/providers/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])

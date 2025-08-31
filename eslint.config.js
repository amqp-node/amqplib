import { defineConfig, globalIgnores } from 'eslint/config'

import globals from 'globals'

import js from '@eslint/js'

import prettier from 'eslint-plugin-prettier'

export default defineConfig([
  globalIgnores(['node_modules', 'dist', 'build', 'coverage']),
  js.configs.recommended,
  {
    name: 'prettier',
    plugins: {
      prettier
    },
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node
      }
    },
    rules: {
      ...prettier.configs.recommended.rules
    }
  }
])

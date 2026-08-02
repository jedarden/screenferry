import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  // Base JS config for broader JavaScript patterns
  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // TypeScript-specific rules
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General best practices
      'no-console': 'off',
      'no-debugger': 'error',
      'no-constant-condition': 'error',
      'no-duplicate-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-wrappers': 'error',
      'no-throw-literal': 'error',
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off', // TypeScript handles this
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',

      // Code quality
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-return': 'error',
      'require-await': 'error',

      // Stylistic
      'curly': ['error', 'all'],
      'no-array-constructor': 'error',
      'object-shorthand': ['error', 'always'],
      'one-var': ['error', 'never'],
    },
  },

  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.beads/**',
      'coverage/**',
      '*.min.js',
      'tools/**',
      'spike/**',
      'docs/research/sim/*.py', // Python files
    ],
  },
];
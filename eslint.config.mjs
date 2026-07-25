import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Jest só carrega testSequencer via require() (CommonJS) — não dá pra
    // usar import ESM aqui, já que o projeto inteiro é "type": "commonjs".
    files: ['test/e2e/sequencer.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);

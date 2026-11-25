// Конфигурация ESLint 9 (flat config). Набор .eslintrc.json рассчитан на ESLint 8 и совпадает по правилам.
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', fetch: 'readonly', DOMParser: 'readonly',
        XMLSerializer: 'readonly', Event: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', IntersectionObserver: 'readonly', Math: 'readonly',
        localStorage: 'readonly', Promise: 'readonly', console: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-empty': 'error',
      'no-cond-assign': 'error',
      'no-fallthrough': 'error',
      'no-extra-semi': 'error',
      'no-irregular-whitespace': 'error',
      eqeqeq: 'warn'
    }
  }
];

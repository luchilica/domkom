export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly', fetch: 'readonly', DOMParser: 'readonly', XMLSerializer: 'readonly', Event: 'readonly' }
    },
    rules: {}
  }
];

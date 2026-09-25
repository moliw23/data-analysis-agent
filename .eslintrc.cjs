module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', indexedDB: 'readonly', URL: 'readonly', Blob: 'readonly', Event: 'readonly', FileReader: 'readonly', Response: 'readonly', fetch: 'readonly' },
  rules: {
    'react/prop-types': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  ignorePatterns: ['dist', 'node_modules', 'tmp', '*.config.js', 'server'],
}

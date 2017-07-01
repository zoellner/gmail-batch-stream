module.exports = {
  env: {
    es6: true,
    node: true
  },
  extends: [
    'eslint:recommended'
  ],
  rules: {
    'no-process-env': 'error',
    'no-process-exit': 'error',
    'no-const-assign': 'error',
    'no-useless-computed-key': 'error',
    'no-var': 'warn',
    'no-console': 'error'
  }
}

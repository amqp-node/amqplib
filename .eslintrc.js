module.exports = {
  env: {
    es6: true,
    node: true
  },
  extends: ['eslint:recommended', 'plugin:import/errors', 'plugin:import/warnings', 'prettier'],
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module'
  },
  rules: {
    //'no-unused-vars': ['error', { args: 'none' }],
    //'no-console': 'off',
    //'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    //'no-duplicate-imports': 'error',
    //'require-atomic-updates': 'off',
    //indent: ['error', 2],
    //'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'double', { avoidEscape: true }],
    semi: ['error', 'always']
    //'brace-style': ['error', '1tbs', { allowSingleLine: true }]
  }
};

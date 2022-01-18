module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:import/errors", "plugin:import/warnings", "prettier"],
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: "module",
  },
  rules: {
    quotes: ["error", "double", { avoidEscape: true }],
    semi: ["error", "always"],
  },
};

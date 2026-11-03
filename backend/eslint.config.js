// Static analysis gate for the backend. Deliberately a CORRECTNESS gate, not a style gate.

const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "eslint.config.js",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // --- correctness: these block the build ---
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-func-assign": "error",
      "no-import-assign": "error",
      "no-obj-calls": "error",
      "no-sparse-arrays": "error",
      "no-unsafe-negation": "error",
      "no-unsafe-finally": "error",
      "no-unsafe-optional-chaining": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-cond-assign": ["error", "always"],
      "no-compare-neg-zero": "error",
      "no-const-assign": "error",
      "no-class-assign": "error",
      "no-invalid-regexp": "error",
      "no-misleading-character-class": "error",
      "use-isnan": "error",
      "valid-typeof": ["error", { requireStringLiterals: true }],
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "for-direction": "error",

      // --- rules kept visible but non-blocking, with reasons ---

      // Every hit in this repo is `new Promise((resolve) => setTimeout(resolve, ms))`, the standard sleep idiom, where the arrow incidentally returns the timer id.
      "no-promise-executor-return": "warn",

      // ExitCode = 1` in a CLI. The rule cannot see that neither is concurrently reachable.
      "require-atomic-updates": "warn",

      // --- hygiene: reported, does not block ---
      "no-unused-vars": ["warn", {
        args: "none",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "warn",
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "no-fallthrough": "warn",
      "no-case-declarations": "warn",
      "no-redeclare": "warn",
    },
  },
  {
    // Test files additionally see Jest's globals.
    files: ["tests/**/*.js", "**/*.test.js", "**/*.itest.js"],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
];

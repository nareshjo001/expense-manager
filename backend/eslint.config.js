// OPS-001-T06 -- static analysis gate for the backend.
//
// Deliberately a CORRECTNESS gate, not a style gate. Every rule set to
// "error" below can only fire on code that is genuinely wrong or dead:
// an undefined identifier, an unreachable branch, a promise executor
// that swallows a return, a duplicate object key silently discarding a
// value. Those are the failures a lint step is worth gating a pull
// request on.
//
// Stylistic and taste-level rules stay at "warn" (visible in the report,
// non-blocking) rather than "off": this codebase predates any linter, so
// promoting them to errors would mean rewriting ~200 files in the same
// change that introduces the linter -- a large, untestable diff with real
// regression risk and no correctness benefit. They can be tightened
// incrementally afterwards, file by file, which is the point of leaving
// them visible.
//
// Run with `npm run lint`. CI runs `npm run lint:ci`, which additionally
// fails on any warning count above the frozen baseline (see
// scripts/lintBaseline.js) so the warning list can only shrink.

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

      // Every hit in this repo is `new Promise((resolve) => setTimeout(resolve, ms))`,
      // the standard sleep idiom, where the arrow incidentally returns the
      // timer id. The rule exists to catch `new Promise((resolve) =>
      // doAsync().then(resolve))`, where a rejection is silently dropped --
      // a real bug this codebase does not have. Left as a warning so a
      // genuine instance of the dangerous shape still shows up in the report.
      "no-promise-executor-return": "warn",

      // High false-positive rate on two shapes this codebase uses correctly:
      // `req.userId = decoded._id` in Express middleware (one request, one
      // handler chain, no interleaving) and `process.exitCode = 1` in a CLI.
      // The rule cannot see that neither is concurrently reachable. Kept
      // visible rather than off, since a true interleaved-update bug would
      // still be worth reading.
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

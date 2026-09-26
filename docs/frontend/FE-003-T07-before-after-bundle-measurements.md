# FE-003-T07: Before/after bundle measurements

Closes FE-003 (frontend route performance) with real numbers from a real
production build. Every earlier attempt was blocked because a full CRA build
cannot finish in the development sandbox (2 vCPU / 3.8 GB). GitHub Actions
can finish it, so FE-003-T02 wired the budget checker into CI right after
`npm run build`. This report reads that step's output.

## Source of the numbers

- **After:** CI run on `main` at merge commit `6e057f0` (PR #47, FE-003-T02..T06),
  "Frontend validation" job, "Performance budget check" step. The sizes are
  gzip at max compression (Node's `zlib`, level 9) of each `build/static/js/*.js`
  file, summed per category by `frontend/scripts/checkPerformanceBudgets.js`.
- **Before:** 378 KB gzip for the main bundle. This comes from the feature's
  2026-09-08 audit (section 4 of the feature doc), when charts, Insights, SIA,
  OCR bill upload and Firebase all shipped in the main bundle. It is the same
  figure T02 encoded as main's original `maxGzipKB` ceiling. It was recorded
  by the audit rather than re-measured by this checker, so treat it as
  approximate (see Caveats).

## What loads on first paint

This project uses `react-scripts` 5.0.1, whose webpack config sets no
`splitChunks` option. That means webpack 5's default, `chunks: "async"`
(verified in `node_modules/react-scripts/config/webpack.config.js`). The
runtime is not split out either. As a result, **the only JavaScript loaded on
first paint is `main`**. Every other chunk loads only when a route or
feature that needs it is opened.

## Results

| Category | Loaded | Before (gzip) | After (gzip) |
|---|---|---|---|
| **main** | **First paint** | **~378 KB** | **194.54 KB** |
| charts (Trend/Bar/Pie pages) | When a chart route is opened or prefetched | in main | 9.54 KB |
| insights | When Analysis is opened or prefetched | in main | 13.10 KB |
| sia (SIA panel + voice controls) | When "Ask SIA" is opened or prefetched | in main | 8.75 KB |
| bill-upload (OCR form) | When "Upload" is opened or prefetched | in main | 1.25 KB |
| firebase-push | Only when a push token is requested | in main | 0.62 KB |
| other-chunks (async vendor splits) | Alongside the lazy chunk that needs them | in main | 178.52 KB |
| **Total JS** | | ~378 KB | 406.32 KB |

**Headline: first-paint JavaScript dropped from about 378 KB to 194.54 KB
gzip, about 183 KB or 48.5% less**, for every session, including the many
that never open a chart, SIA, OCR or push notifications.

The small named chunks (charts is 9.54 KB) are only the app's own
components. The heavy libraries they use (recharts and its d3
dependencies, the Firebase SDK) are pulled out by webpack into the numbered
async vendor chunks counted under `other-chunks`. They still load only on
demand, and the T06 prefetch starts them on hover, focus or touch of the
link that leads there.

## Caveats (read before quoting the numbers)

- **"Before" is not a same-commit A/B.** The 378 KB figure is from the
  2026-09-08 audit. Features have landed since then (for example BUD-001's
  category budgets UI, which is eager on the Expenses page). The real
  like-for-like saving is therefore probably slightly larger than 183 KB,
  not smaller.
- **Total JS went up about 28 KB (378 to 406 KB).** Some of this is chunking
  overhead: each async chunk carries its own module wrappers, and some shared
  modules are duplicated across chunks. Some is code added since the audit.
  This is the expected trade: bytes move off the critical path, and users who
  never open a feature never download it.
- **These are gzip sizes of the emitted files, not transfer sizes.** The
  host's compression (gzip or brotli) and caching determine what users
  actually download. Brotli would be smaller.

## Budgets now enforced

`frontend/performance-budgets.json` moves every category out of RECORD mode.
Each `baselineGzipKB` is set to the measured size above. With
`allowedGrowthPercent: 10`, CI now fails if any category grows more than 10%
(for example, main above ~214 KB). Main's hard ceiling is tightened from 378
to 250 KB. That ceiling is a backstop that still holds if someone later raises
a baseline with `--update-baseline --force`, so main can't drift back toward
its pre-split size unnoticed.

When a deliberate change legitimately grows a chunk, re-baseline it. Build
locally or in CI, run `npm run perf:budgets:update-baseline -- --force`,
review the diff, and commit it with the reason.

## Related

- FE-003-T01 static composition analysis: `frontend/scripts/analyzeBundleComposition.js`.
  The committed `frontend/bundle-composition-baseline.json` is the pre-split
  (T01-era) snapshot. CI regenerates the current one as a build artifact on
  every run.
- Feature doc: `workflow/features/P2/FE-003-frontend-route-performance.md`.

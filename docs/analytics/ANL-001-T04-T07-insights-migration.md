# ANL-001 T04-T07: Migrating chart insights to backend-authoritative data

Covers the migration of the frontend's client-side insight computations
(`frontend/src/insights-engine/**`) to the backend-computed `report.insights`
object (ANL-001-T01-T03, `backend/analytics/analyzers/*Analyzer.js` via
`reportGenerator.js`), one consumer at a time, plus the resulting cleanup
(T06) and the record of what was deliberately investigated and left
unmigrated. T04's own charter frames this as real multi-file frontend work
with no environment blocker, simply larger in scope than earlier ANL-001
tasks -- this document is the "why" behind each of the scoping decisions
made while doing it.

## 1. Prerequisite bug found and fixed: `insights` was never actually persisted

Before any frontend consumer could be migrated, the backend value it would
read had to actually reach the database. It didn't: `reportGenerator.js`
has computed and attached a `report.insights` object to every generated
report since ANL-001-T03, but `backend/models/Report.js`'s Mongoose schema
never declared an `insights` path. Mongoose's default `strict: true` mode
silently strips any undeclared path from a `$set` update before it reaches
MongoDB -- confirmed against `backend/Services/reportService.js`'s
`persistAndCache()`, the only write path
(`FinancialReport.findOneAndUpdate(filter, { $set: setFields }, { new: true,
upsert: false, runValidators: true })`). In other words: every report
generated since T03 computed `insights` correctly in memory, served it
correctly on the request that generated it, and then silently lost it the
moment it was cached -- so any later read of that same cached report (which
is the common case; `persistAndCache` exists specifically to avoid
recomputing on every request) got `insights: undefined`.

Fixed by declaring `insights: { type: mongoose.Schema.Types.Mixed, default:
{} }` on the schema, matching the existing pattern used for every sibling
analyzer-output section (`spending`, `budgets`, `categories`, `trends`,
`habits`, `financialHealth`, `forecast`, `anomalies`). Verified the fix
actually closes the gap: 3 new tests were added to
`backend/tests/report.schema.persistence.test.js` covering a full populated
`insights` round-trip, each sub-report's no-data shape, and a legacy
document with no `insights` key at all (reads back `{}`, the schema
default, not an error) -- and, before restoring the fix, the field was
temporarily removed to confirm all 3 new tests fail exactly as expected
(`rehydrated.insights` comes back `undefined`), proving the tests catch the
regression rather than just exercising the happy path.

This also explains why every consumer below has to treat `report.insights`
as potentially `{}` (the schema default) rather than always-populated: any
report cached before this fix shipped, and any report a test constructs
without the field, legitimately has no `insights` data yet.

## 2. The core scoping constraint: `chartFindings` is not filter-parameterized

`report.insights.chartFindings` (`chartFindingsAnalyzer.js`) is computed
once per report generation, from that report's current-calendar-month data
only (`trendReport`, `budgetReport`, and the current month's
`categoryReport`, assembled in `reportGenerator.js`). The three chart pages
(bar/line/pie), by contrast, are each a small state machine of user-chosen
filters -- month vs. category view, a specific month or a whole year, one
year vs. a multi-year comparison -- and most of those filter states show
data the single backend snapshot doesn't describe at all.

Migrating "the chart" to backend data is therefore not a single yes/no
decision per chart family; it's a decision per filter STATE. The rule
applied uniformly across all three charts: the backend-computed insight is
used only in the one filter state where it is a faithful description of
what the chart is currently showing (identified below, per chart), and the
existing frontend rule (`notifyChartFilterApplied` /
`insights-engine/rules/chartPatterns.js`) is left completely unchanged and
running for every other filter state. This is why T06 ("remove redundant
frontend rules") concludes that nothing was actually removable -- see
section 6.

None of the three charts' backend-driven thresholds below are ports of the
old frontend math. Each backend field is a genuinely different metric from
what the old client-side rule computed (different formulas, different input
data, different scope), so reusing the old cutoffs against the new metric
would have been coincidental at best and misleading at worst. Each
migration picked fresh thresholds for the new metric's own scale, with the
reasoning recorded below and in the code comments at each call site.

## 3. Bar chart (`frontend/src/components/charts/barchart/BarChartPage.js`)

**Matching filter state:** `viewBy === 'bycategory' && specificMonth ===
true && month === <the current calendar month, "YYYY-MM">`. Every other
state (whole-year category view, month-over-month view, any past or future
specific month) keeps using `notifyChartFilterApplied` unchanged.

**Backend field:** `report.insights.chartFindings.bar` (`buildBarFindings`
in `chartFindingsAnalyzer.js`). **Interpretation limit worth calling out
explicitly:** `hasData` on this field is gated on
`budgetReport.hasBudget === true` -- i.e. it goes false for any user with no
budget configured at all, regardless of whether their category data exists.
That's a budget-status gate, not a category-data gate, and it's easy to
misread as "not enough transactions" when it actually means "no budget
set." When `hasData` is false, the UI falls back to the frontend rule
exactly as if the filter state didn't match, rather than showing an error.

**Metric used:** `concentrationRatio` (top-3-category spend share, 0-1),
paired with `report.categories.monthly.categoryDistribution[0]` for the
top category's name and percentage (used instead of `chartFindings.bar`'s
own fields, which don't carry a category name).

**Thresholds (fresh, chosen for this migration):**
- `>= 0.70` -> HIGH, "A large share of spending was concentrated in
  `{category}`, accounting for `{pct}`% of the total."
- `>= 0.50` -> MEDIUM, "`{category}` was the largest spending category
  during this period at `{pct}`% of total spending."
- below that -> LOW, "Spending was fairly balanced across categories
  during this period."

## 4. Line/trend chart (`frontend/src/components/charts/linechart/TrendChartPage.js`)

**Matching filter state:** `viewBy === 'bymonth' && Number(selectedYear) ===
<the current calendar year>`. Every other state (week view, any `byyear`
comparison, or a bymonth view for a past/future year) keeps using
`notifyChartFilterApplied` unchanged.

**Backend field:** `report.insights.chartFindings.line` (`buildLineFindings`,
sourced from `trendReport.monthlyTrend`), a current-month-vs-previous-month
comparison. **Interpretation limit:** this is a two-point comparison (this
month vs. last month), not a trend fitted across the whole visible series --
so even though it's shown alongside a full monthly time series, it's only
describing the most recent step of it.

**Metric used:** `direction` (`"up"|"down"|"same"`) paired with
`volatility` (`trendReport.spendingDirectionStrength`, a signed weighted
multi-period trend-strength signal). This `volatility` value is NOT the
same measurement as the old frontend rule's `isVolatile` (which averaged
absolute percent-change between consecutive points of whichever series the
active filter returned), nor is it the same as this same backend file's
own unrelated +-15 "Increasing"/"Decreasing" summary-label cutoffs used
elsewhere in the report. The `>= 30` "strong" threshold below was chosen
fresh for this specific field.

**Mapping (fresh, chosen for this migration):**
- `direction === 'up'`, `|volatility| >= 30` -> HIGH / UP, "Spending has
  been trending upward recently."
- `direction === 'up'`, otherwise -> MEDIUM / UP, "Spending has shown an
  upward pattern in recent periods."
- `direction === 'down'`, `|volatility| >= 30` -> MEDIUM / DOWN, "Spending
  has been trending downward recently."
- `direction === 'down'`, otherwise -> LOW / DOWN, "Spending has shown a
  downward pattern in recent periods."
- `"same"`, `null`, or any unexpected value -> LOW / FLAT, "Your spending
  stayed at similar levels during this period."

## 5. Pie chart (`frontend/src/components/charts/piechart/PieChartPage.js`)

**Matching filter state:** `show === 'distribution' && viewBy ===
'thismonth'` (the chart's default state). The other two `show` modes
(`'count'` -- transaction counts, a different metric entirely; `'comparison'`
-- budget vs. spent, not a category breakdown at all) and
`distribution` + `'thisyear'` (a full-year breakdown the current-month-only
backend snapshot doesn't cover) all keep using the frontend rule unchanged.

**Backend field:** `report.insights.chartFindings.pie` (`buildPieFindings`).
**Metric used:** `concentrationRatio`, an HHI-style index (sum of squared
category spend-share percentages, normalized to 0-1) -- a different formula
from both the bar chart's top-3-share-sum ratio above and this chart's own
prior frontend rule (`insights-engine/rules/chartPatterns.js`'s
`pieChartFinding`, a gini-coefficient/dominance-ratio calculation with
0.45/0.35 cutoffs). Paired with `categoryDistribution[0]` for the same
reason as the bar chart (the backend field's own `topSlice` carries a
category name with no percentage).

**Thresholds (fresh, chosen for this migration -- deliberately not the old
rule's 0.45/0.35 gini cutoffs, since HHI and gini are different scales):**
- `>= 0.35` -> HIGH, "A large share of spending was concentrated in
  `{category}`, accounting for `{pct}`% of total spending."
- `>= 0.20` -> MEDIUM, "`{category}` was the largest spending category
  during this period at `{pct}`% of total spending."
- below that -> LOW, "Spending was fairly balanced across categories
  during this period."

## 6. Overall stability card (`frontend/src/components/monthlyInsights/OverallInsight.js`)

Unlike the three charts above, this one migration is a genuine 1:1 swap,
not a filter-scoped partial migration: `buildStability()`'s pre-existing
client-side formula (`Math.max(0, Math.min(100, Math.round(100 - cov *
100)))`, tiered at 75/50 into Highly/Moderately/Low Stability) was verified
byte-for-byte identical to `backend/analytics/analyzers/
stabilityScoreAnalyzer.js`'s `calculateStabilityScore` and its own 75/50
tier cutoffs. There is no scope mismatch to work around here, because
unlike `chartFindings`, this backend field and this UI card are both
describing the exact same thing: the current month's day-to-day spending
consistency.

`buildStability()` now takes the backend value (`report.insights.stability`)
as a second parameter and prefers it whenever `hasData` is true, mapping
its `tier` code (`"HighlyStable"|"ModeratelyStable"|"LowStability"`) to the
same display labels and messages the component has always shown. It falls
back to the original client-side computation from `report.spending.
stability` when `insights.stability.hasData` is false or `insights` is
absent/`{}` -- which is the normal, expected shape for any report cached
before the ANL-001-T04 fix in section 1 shipped. This component previously
had no test file; `OverallInsight.test.js` (new) covers both paths, all 3
tier mappings, and the pre-existing empty-data state, using a case where
the backend and client-side values deliberately disagree (0.5 vs. 0.1
coefficient of variation) to prove the backend value actually wins rather
than merely "looking right."

## 7. Investigated and deliberately NOT migrated

Two other frontend-rule consumers were investigated as candidates for this
migration, on the basis that their backend analyzer counterparts appear,
by naming, to be designed as their replacements. Both were found to have
real algorithmic differences from what they'd be replacing, deep enough
that a forced migration would change the numbers shown to users, not just
their source -- so both were left completely unmigrated.
`ExpenseInsightsContext.js` and `ExpensesPage.js` have zero diff from
`origin/main` as a result; this is a verified outcome of investigation, not
work left undone.

**`notifyInitialLoad` (frontend `overallSpend.js` +
`buildWeeklyBaseline.js`) vs. backend `weeklyChange`
(`weeklyChangeAnalyzer.js`):**
- Frontend uses rolling 7-day windows (`now-7d..now` vs. `now-14d..now-7d`).
  Backend uses Monday-aligned calendar weeks, which is a partial week (and
  a fundamentally different total) on any day that isn't a Monday.
- Frontend's volatility baseline is a rolling 6-week window. Backend reuses
  the current calendar month's `coefficientOfVariation` -- the same value
  `OverallInsight.js`'s stability card uses -- which is a different
  statistic over a different window.
- Frontend has an absolute floor rule (a change under Rs.50 is never flagged
  as significant, regardless of percentage). Backend's `weeklyChangeAnalyzer.js`
  has no equivalent floor.
- Frontend's `anomalyContext` gate (suppressing the insight when a known
  anomaly explains the change) has no backend equivalent.

**`notifyFilterApplied` (frontend `categoryPatterns.js`'s `categorySpend`)
vs. backend `categoryPattern` (`categoryPatternAnalyzer.js`):**
- `categoryPatternAnalyzer.js`'s own header comment states outright that it
  is "a deliberate, documented backend-native REINTERPRETATION... not a
  byte-for-byte port" -- this alone was reason enough to investigate
  carefully rather than assume compatibility.
- Dominant-category detection: frontend uses a 35% threshold with a
  dual-payload shape; backend's `topCategory` has no threshold at all.
- Spike classification: frontend runs a 3-month rolling z-score-style
  calculation; backend uses a binary check
  (`biggestJump.category === dominantCategory && growthPercentage >= 50`).
- Micro-transaction detection: frontend is single-category-only, gated on
  60%-of-mean / >=50%-of-category / n>=6; backend is multi-category, gated
  on 10%-of-own-mean / >=3-micro / >=2-total -- different scope and
  different thresholds.
- "Stable months" framing: frontend counts tiered stable months plus a
  top-2 concentration figure; backend computes a continuous
  `1 - meanAbsGrowthPercent/100` plus a top-3 share.

In both cases, the risk of migrating was producing a technically-backend-
sourced number that answers a subtly different question than the one the
existing UI text and thresholds were written for -- which would be a
regression dressed up as a migration. Both remain on the pre-existing,
verified-correct frontend rules engine.

## 8. T06: what was actually removable from the frontend rules engine

Nothing. Every path through `frontend/src/insights-engine/**` referenced
above (`chartPatterns.js`'s `lineChartFinding`/`barChartFinding`/
`pieChartFinding`, `overallSpend.js`, `buildWeeklyBaseline.js`,
`categoryPatterns.js`'s `categorySpend`) is still reachable code, because
every migration above is a partial, filter-scoped preference for backend
data with the frontend rule as the fallback for every other state --
and, per section 7, two consumers were kept on the frontend rule entirely.
Removing any of this code would break the fallback paths that real users
hit constantly (any chart filter other than the one matching state, any
report predating the schema fix, any weekly-change or category-pattern
insight). This is a legitimate "nothing to remove" outcome, not a skipped
task: the fallback design itself is what T06's charter was checking for,
and the reasoning above is the documentation of why it was necessary.

## 9. Testing

- Backend: `insights` schema round-trip (`report.schema.persistence.test.js`,
  3 new tests, regression-proven per section 1), plus the existing
  `analytics.*` suite (323 tests / 15 suites, unaffected) and the report
  route smoke test -- all passing, no analyzer logic changed in this task.
- Frontend: each migrated file's existing test suite was extended with
  scenarios for the backend-matching state, the non-matching
  (fallback-to-frontend-rule) states, and the `hasData: false` /
  missing-`insights` cases. Run together as a combined pass across all 6
  changed test files (`BarChartPage`, `TrendChartPage` +
  `.staleData`, `PieChartPage` + `.staleData`, `OverallInsight`): 59/59
  tests passing. Lint clean (`eslint`) across all 10 changed/added
  frontend files.

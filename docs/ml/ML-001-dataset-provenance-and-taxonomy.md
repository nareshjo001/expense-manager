# ML-001-T01: Dataset provenance and label-taxonomy documentation

Documents what `ml-service/training/dataset/merged_expenses.csv` (the base
training dataset `training/dataset_builder.py` reads, see its
`BASE_DATASET_PATH`) actually contains, where it came from as far as the
repository can verify, and the label taxonomy it trains against. Feeds
ML-001-T02 (deduplicate/quantify ambiguous labels) and T03 (grouped
train/validation/test splitting) directly.

## Dataset composition

`merged_expenses.csv` holds **97,056** labeled `(expenseName,
expenseCategory)` rows. It is the exact concatenation of five files under
`ml-service/usedDatasets/` -- verified by reconciling row counts
(49,995 + 10,000 + 5,000 + 32,000 + 61 = 97,056, matching exactly):

| Source file | Rows | Apparent origin (from filename/content -- unverified) |
|---|---|---|
| `usedDatasets/50k_clean_synthetic.csv` | 49,995 | Synthetic (filename states so) |
| `usedDatasets/cleaned_expenses_v1.csv` | 10,000 | Unknown external source |
| `usedDatasets/cleaned_expenses_v2.csv` | 5,000 | Unknown external source; distinguishable from v1 by lowercase category labels (e.g. `"travel"` vs `"Travel"`) |
| `usedDatasets/merchant_dataset_generated.csv` | 32,000 | Synthetic/generated (filename states so) |
| `usedDatasets/used_app_data.csv` | 61 | Real production app usage (filename states so) -- by far the smallest slice of real user data in the training set |
| **Total** | **97,056** | |

**No merge script that assembled `merged_expenses.csv` from these five
files survives in the codebase or its recoverable git history.** The
earliest history available is a single squashed commit
(`b802055`, "Squashed 'ml-service/' content", June 2026,
`git-subtree-dir: ml-service`) that already contains the fully-assembled
file -- everything before that squash was flattened into one commit and
is not recoverable from this repository. `training/category_config.py`'s
`CATEGORY_ALIASES` dict carries a `# aliases / kaggle labels` comment,
which is the only in-repo hint that at least one source file used
Kaggle-style category names, but which specific file(s), and under what
license, is **not determinable from the repository alone**.

**Open item for the owner:** confirm or correct the "apparent origin"
column above. If any source file was downloaded from an external dataset
(Kaggle or otherwise), its exact name/URL/license should be recorded here
-- training on externally sourced labeled data without a recorded license
is a real compliance question this document surfaces but cannot resolve
on its own. Per the ML-001 spec's own allowance, this stays an explicit
**UNKNOWN** until the owner resolves it, rather than a guessed citation.

## Label taxonomy

15 canonical categories (`training/category_config.py`'s
`CANONICAL_CATEGORIES`): Food, Transport, Shopping, Bills, Entertainment,
Groceries, Health, Education, Travel, Rent, Investment, Salary, Personal
Care, Gifts, Others.

The raw dataset actually contains **26 distinct label strings** before
normalization. `normalize_category()` collapses every one of them onto a
canonical category with **zero unmapped rows** (verified by running the
mapping over the full 97,056-row file):

| Raw label | Canonical category | Rows | Raw label | Canonical category | Rows |
|---|---|---|---|---|---|
| `Shopping` | Shopping | 10,579 | `education` | Education | 602 |
| `Food` | Food | 10,552 | `healthcare` | Health | 570 |
| `Travel` | Travel | 8,017 | `travel` | Travel | 565 |
| `Transport` | Transport | 7,548 | `entertainment` | Entertainment | 557 |
| `Bills` | Bills | 7,546 | `utilities` | Bills | 554 |
| `Groceries` | Groceries | 7,545 | `shopping` | Shopping | 546 |
| `Education` | Education | 6,550 | `emi` | Bills | 541 |
| `Entertainment` | Entertainment | 6,547 | `food` | Food | 534 |
| `Health` | Health | 6,547 | `investment` | Investment | 531 |
| `Personal Care` | Personal Care | 6,048 | | | |
| `Other` | Others | 4,545 | | | |
| `Investment` | Investment | 3,041 | | | |
| `Others` | Others | 2,010 | | | |
| `EMI` | Bills | 1,981 | | | |
| `Salary` | Salary | 1,000 | | | |
| `Rent` | Rent | 1,000 | | | |
| `Gifts` | Gifts | 1,000 | | | |

11 of the 26 raw labels are pure case or synonym variants of another raw
label already in the table (e.g. `Travel`/`travel`, `Other`/`Others`,
`EMI`/`emi`/`utilities` all folding into `Bills` or `Others`) -- this
alone is evidence the source files used inconsistent label conventions,
consistent with them coming from more than one origin.

## Class distribution after normalization

| Canonical category | Rows | Share |
|---|---|---|
| Shopping | 11,125 | 11.5% |
| Food | 11,086 | 11.4% |
| Bills | 10,622 | 10.9% |
| Travel | 8,582 | 8.8% |
| Transport | 7,548 | 7.8% |
| Groceries | 7,545 | 7.8% |
| Education | 7,152 | 7.4% |
| Health | 7,117 | 7.3% |
| Entertainment | 7,104 | 7.3% |
| Others | 6,555 | 6.8% |
| Personal Care | 6,048 | 6.2% |
| Investment | 3,572 | 3.7% |
| Rent | 1,000 | 1.0% |
| Salary | 1,000 | 1.0% |
| Gifts | 1,000 | 1.0% |

**Real class imbalance exists** -- the three smallest classes (Rent,
Salary, Gifts) sit at exactly 1,000 rows each (suspiciously round,
suggesting a synthetic-generation target rather than an organic count),
an ~11x gap from the largest class (Shopping, 11,125). ML-001-T02
(deduplicate/quantify ambiguous labels) and T04 (baselines) both need to
account for this rather than assume a roughly-balanced dataset -- macro-F1
(named in the ML-001 spec) is the right metric precisely because it
does not let the majority classes hide poor performance on Rent/Salary/
Gifts.

## Consequences

- ML-001-T02 can start from this exact raw-label inventory rather than
  re-deriving it, and should specifically examine whether the ~10,061
  rows carrying a lowercase/alias raw label (the right-hand column above)
  cluster in one particular source file, which would help narrow down
  which of the two "unknown origin" files they came from.
- ML-001-T03's grouped split (by normalized merchant/description, per the
  ML-001 problem statement) needs to be aware that `used_app_data.csv`'s
  61 rows are the only confirmed-real user data in the set -- a naive
  random split could easily place all of it in one fold.
- The dataset-provenance open item above should be resolved (or formally
  accepted as permanently unknown) before ML-001-T07 publishes an
  evaluation report / model card that any external party might read.

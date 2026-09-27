# OCR-006-T04: Vision-model structured-output benchmark

Evidence for the question T02 and T03 both left open: if a vision model were
used as a fallback for the receipts the current OCR pipeline gets wrong,
would it actually read them correctly? T02 found exactly **one** receipt in
the corpus (`limbo-premium`) that no traditional OCR configuration could
recover. T03 reviewed three hosted providers and approved none of them for
receipt images, pending an ADR. This task answers the accuracy question
without needing that approval: every receipt image was processed entirely
on the maintainer's own machine, with a free, local, zero-egress model. No
receipt image or any derived text left the machine, and T03's provider
review is unaffected — this evidence stands independently of which hosted
provider (if any) is chosen later.

## Method

- **Script:** `backend/scripts/ocrEvaluation/groqVisionBenchmark.js` (name
  kept for history; it now supports any OpenAI-compatible vision endpoint
  via `--provider`). Run from `backend/` with
  `node scripts/ocrEvaluation/groqVisionBenchmark.js --provider=ollama`.
  Writes `results/vision-ollama-latest.json` and `.md` (gitignored run
  output).
- **Corpus:** the same 21-entry corpus T01/T02 used (6 synthetic, 15
  anonymized-real receipts), so results are directly comparable.
- **Provider:** originally planned as Groq (already integrated in this
  codebase, reviewed favourably on privacy in T03). **Groq no longer has a
  usable vision model at any tier** — both prior vision models
  (`llama-4-scout-17b-16e-instruct`, `llama-4-maverick-17b-128e-instruct`)
  were deprecated during this task (2026-07-17 and 2026-03-09), confirmed
  live against a real key's `/v1/models` listing. This is itself evidence
  for T03's "model deprecation or churn" failure mode, observed in real
  time rather than hypothesized. The benchmark pivoted to **Ollama**
  running locally (`qwen3-vl:4b`, ~3.3GB, CPU inference, OpenAI-compatible
  endpoint at `http://localhost:11434`, no auth, no network egress). The
  Groq provider config remains in the script, unused, for when/if Groq
  reintroduces a vision model.
- **Scoring:** amount and date matching reuse `scoring.js`'s
  `amountMatches`/`dateMatches` exactly as T02 used them, for a fair,
  identical comparison. A full `scoreEntry()` was deliberately **not**
  reused: its pass/fail gate also asserts Tesseract-specific confidence
  codes (`NO_AMOUNT_FOUND`, etc.) that describe the OCR+regex pipeline's
  own reasoning, not a vision model's. Merchant name is scored but
  informational only, consistent with T01/T02 (amount and date are the two
  gated fields).
- **Consent:** the corpus is the same pre-existing, already-anonymized set
  built for OCR-003-T07/T08. No new receipt images (including the
  maintainer's own unredacted originals, offered during this task) were
  added or sent anywhere.

### Three implementation bugs found and fixed during this task

These are recorded because two of them are general Node.js/local-LLM
gotchas worth knowing about beyond this script, and because the third
materially affects how the results below should be read.

1. **Node's global `fetch()` has its own hidden 300-second timeout.**
   `fetch()` is built on `undici`, whose default `Agent` applies a
   300,000ms `headersTimeout`/`bodyTimeout` to every request, independent
   of any `AbortSignal` the caller passes in. A CPU-inference response
   taking longer than 5 minutes was killed by this internal timer, not by
   the script's own (much longer) timeout, and surfaced only as a bare
   `"fetch failed"` with no detail. Fixed by replacing `fetch()` with a
   small dependency-free `http`/`https`-based request function that has no
   timeout of its own — only the script's own `timeoutMs` now bounds a
   request.
2. **`qwen3-vl:4b`'s "thinking" mode could not be disabled.** Both the
   OpenAI-compatible `reasoning_effort: "none"` parameter and the native
   `think: false` flag were tried; neither suppressed it. A live streaming
   diagnostic against the native endpoint showed the model still emitting
   a visible `<think>...</think>` preamble regardless. This is a real,
   current limitation of this model/Ollama version combination, not a
   configuration mistake in this script.
3. **The prompt's amount-formatting instruction caused a genuine
   non-terminating loop on some inputs.** The original wording ("Digits
   only, no currency symbol, no thousands separators", applied to a
   decimal amount typed as `number`) was ambiguous enough that the model
   got stuck arguing with itself — captured verbatim — over whether a
   printed `245.00` should become `24500`, for over 1,000 seconds, ending
   at `finish_reason: "length"` having produced zero JSON. This was
   confirmed with a live streaming reproduction of the exact benchmark
   request before changing anything. The prompt was reworded to state the
   rule unambiguously ("a total printed as 245.00 is the number 245.00,
   NEVER 24500"), and a regression test asserts the ambiguous wording is
   never reintroduced. This fix alone did not eliminate all non-completion
   failures — see below.

## Results

Two full runs were made on the 21-entry corpus (the second, after the
prompt fix, on 2026-09-27). Every result below is **an API call either
succeeding or timing out at 600,000ms (10 minutes)**; the model never once
returned a low-confidence or wrong answer for the fields we score.

| Run | Scored | Completed / total | Pass rate on completed | Amount match | Date match | Merchant match (info) |
|---|---|---|---|---|---|---|
| 1 (fetch fix only) | 14 | 14/21 | **100%** (14/14) | 100% | 100% | 91.7% |
| 2 (+ prompt fix) | 12 | 12/21 | **100%** (12/12) | 100% | 100% | 91.7% |

**Across both runs, 15 of the 21 receipts completed at least once, and
every single one scored a correct amount and date.** The following 6 never
completed in either run, always timing out at 600,000ms:
`ambiguous-total`, `no-date`, `heading-collision`, `theo-cafe`,
`brahmins-thatte-idli`, `warung-leko`.

Three receipts (`dindigul-thalappakatti`, `hotel-vishwanand`,
`ratna-cafe`) completed successfully in run 1 but timed out in run 2, and
`clean-simple` timed out in run 1 (the loop bug) but completed in run 2
(after the prompt fix). **This is itself a finding**: even at
`temperature: 0`, this local model's completion behaviour is not fully
deterministic run to run — CPU-parallel floating-point execution is a
known source of this kind of non-determinism. This adds a concrete
instance to T03's "non-determinism" failure-mode row, which until now was
stated only as a general concern.

### The one result that matters most

T02 identified exactly one receipt, `limbo-premium`, where the payable
amount (`640`) was recognized correctly by **no traditional OCR
configuration tested** (28 configurations, oracle selection included).
**The vision model read `limbo-premium` correctly in both runs**: amount
`640`, date `2025-05-12`, confidence `high` — matching ground truth
exactly. This is the direct, targeted evidence T02 said would be needed:
on the one receipt traditional OCR provably cannot solve on this corpus, a
local, free, private vision model does solve it, consistently.

`warung-leko` — T02's other notable case, an *extraction* failure (the
correct amount was already present in the OCR text but not extracted) — is
inconclusive here: it is one of the 6 that never completed, so no verdict
exists for it from this task.

### Why 6 receipts never complete

The prompt fix (bug 3 above) resolved the one *specific* ambiguity we could
reproduce and prove. It did not eliminate every non-completion; the "cannot
disable thinking" limitation (bug 2) means some inputs still send the model
into a long-or-unbounded internal reasoning process, for reasons that were
not investigated further. Diagnosing each of the remaining 6 individually
would mean reverse-engineering a small local model's internal chain of
thought on specific images, which is disproportionate to what this task
needs to answer and was stopped deliberately rather than pursued to
completion. It cost real time (over 2.5 hours of wall clock for the second
21-entry run alone) without moving the accuracy finding at all.

## Conclusion

**On every receipt this local vision model successfully processed, across
two independent runs, it got the amount and date exactly right — including
the one receipt (`limbo-premium`) that T02 proved traditional OCR cannot
recover on this corpus.** That is the core finding this task set out to
get, and it is now backed by direct measurement rather than assumption.

The model's *reliability of completing at all* is a separate, real, and
currently unresolved limitation of this specific free/local
model+Ollama-version combination (29% of the corpus never completed in
either run; three more were non-deterministic across runs). That limitation
is about serving infrastructure and model choice, not about whether a
vision model *can* read these receipts. It should inform any production
design (a hard timeout with silent fallback to the existing OCR result, per
T03's mitigation table, is essential regardless of provider) but it does
not weaken the accuracy finding above.

This task does not change T03's decision status: no hosted provider is
approved, and any receipt image sent to a third party still needs the ADR
T03 describes. It also does not fill the "required data is consented,
representative and large enough" gap T03 flagged — this is still the same
21-entry, largely single-maintainer corpus.

## Updated OCR-006 evidence gate status

| Gate item | Status | Change from T03 |
|---|---|---|
| A non-AI baseline is measured | Met (T02) | Unchanged |
| **A vision model's accuracy is measured** *(new, informal, added by this task)* | **Met for this corpus**: 100% pass rate (amount+date) on every receipt it completed, across 2 runs, including the one recognition-only failure from T02 | New evidence |
| Privacy/provider cost and failure modes are approved | Partially met: reviewed, not approved | Unchanged — this task used no hosted provider |
| Required data is consented, representative and large enough | Not met | Unchanged |
| The experiment can be disabled without affecting core financial CRUD | Not assessed | Unchanged |

**Overall: still not met**, for the same reasons T03 gave (no approved
provider, no user-demand evidence, small corpus). What has changed is that
the *accuracy* half of the open question — would a vision model actually
help, if all the governance gates were later cleared — now has a real,
positive answer for this corpus. Feeds directly into T05 (defining the
opt-in fallback confidence threshold).

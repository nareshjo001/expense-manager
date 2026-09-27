# ADR-0009: Vision-model OCR fallback (OCR-006-T01..T05)

**Status: PROPOSED.** This ADR recommends **not building** the
vision-model OCR fallback at this time, and records the specific evidence
behind that call plus the conditions that would change it. Per
[OCR-006-T03](../ocr/OCR-006-T03-provider-privacy-review.md), a new
third-party data flow needs an ADR the project owner accepts before any
receipt image can be sent externally; this document is that ADR, proposing
that the answer stay no, for now.

## Decision

Do not build a vision-model fallback for receipt OCR at this time. Do not
send any user's receipt image to a third-party AI provider. Keep the
existing Tesseract-based pipeline as the sole OCR path.

The design work in
[OCR-006-T05](../ocr/OCR-006-T05-fallback-trigger-and-threshold.md) is
preserved as the reference spec to build from *if* the conditions in
[When to revisit this decision](#when-to-revisit-this-decision) are met —
this is a deferral with a concrete design already done, not a dead end.

## Context

Four evidence tasks preceded this decision:

- [OCR-006-T01](../ocr/OCR-006-T01-failure-corpus.md) built a 21-receipt
  corpus (6 synthetic, 15 anonymized-real) and classified the current
  pipeline's failures as recognition, extraction or derived.
- [OCR-006-T02](../ocr/OCR-006-T02-traditional-ocr-ceiling.md) measured
  that pipeline against 28 traditional OCR configurations. Baseline: 15/21
  receipts pass. Oracle ceiling with a perfect extractor: 20/21. **Exactly
  one receipt** (`limbo-premium`'s amount) is a recognition failure no
  tested traditional configuration recovers — the only field on this
  corpus where a stronger recognizer is even a candidate.
- [OCR-006-T03](../ocr/OCR-006-T03-provider-privacy-review.md) reviewed
  Groq, OpenAI and Gemini for sending receipt images. **No provider is
  approved.** Groq's only vision model is a Preview model the vendor says
  not to use in production, and it was deprecated mid-review. OpenAI's
  zero-retention option needs a sales approval a solo project is unlikely
  to get. Gemini's free tier trains on inputs with human review, which is
  disqualifying; its paid tier's retention/region posture is the weakest
  of the three reviewed.
- [OCR-006-T04](../ocr/OCR-006-T04-vision-model-benchmark.md) measured
  actual accuracy, entirely locally (Ollama, `qwen3-vl:4b`, zero egress,
  since no hosted provider was approved to test against). Result: **100%
  pass rate on every receipt it completed**, across two runs, including a
  correct read of `limbo-premium` — direct confirmation that a vision
  model can recover T02's one unrecovered case. But it only completed 12–14
  of 21 receipts per run (this specific model's "thinking" mode could not
  be disabled, sending some receipts into multi-minute-or-longer reasoning
  with no reliable way to bound it), and which receipts completed was not
  even consistent between the two runs.
- [OCR-006-T05](../ocr/OCR-006-T05-fallback-trigger-and-threshold.md)
  specified exactly when the fallback would trigger, how per-user opt-in
  would work (default off, fails closed), and how its output would be
  validated (draft-only, re-validated, never a silent write) — all reusing
  existing code shapes (`reviewReasons`, the SIA-001-T06 preference
  pattern, the SIA-001-T04 circuit breaker). It also surfaced that **no
  provider evidenced so far is actually reachable from a deployed server**:
  the only one with measured accuracy ran on a developer's own laptop.

## Rationale

Three independent reasons converge on the same answer, any one of which
would be enough on its own:

1. **The addressable problem is small.** On this corpus, 1 of 21 receipts
   (~5%) is a recognition failure only a stronger recognizer could fix.
   T02 already noted 21 receipts, mostly one person's purchases, is too
   small a sample to size this reliably — it could be 5% or it could be
   noise. Building a new external-data-flow feature, with all the
   machinery in T05, to address a rate this uncertain and this small is
   disproportionate before the rate itself is better known.
2. **Every reviewed provider has a specific, current disqualifier**, not
   a generic "needs more review" — Groq has no production-appropriate
   vision model as of this review (twice deprecated during T03/T04
   alone), OpenAI's privacy posture needs an approval this project likely
   can't get, and Gemini's free tier is disqualified outright by training
   on inputs. There is no live "just pick one" option today.
3. **The one option with measured accuracy (T04) is not deployable.**
   100% accuracy-when-completed is a genuinely strong result, but it was
   produced by a model running on a developer machine that a production
   server cannot reach, with a ~29% non-completion rate that would need
   solving before it could serve real traffic — and solving that is an
   infrastructure project (self-hosting inference, or finding a hosted
   equivalent) this ADR did not scope or approve.

None of this says a vision fallback is a bad idea. It says the case for
building it now is thin, and the reasons are specific and fixable rather
than fundamental.

## What this ADR is *not*

- Not a statement that vision models can't read these receipts — T04's
  finding is the opposite.
- Not a rejection of the T05 design — it stands as the reference spec.
- Not a permanent ban. It is a "not now," with explicit revisit
  conditions below, unlike a do-not-build item with no reversal path.
- Not a judgment on any specific provider's product quality — Groq's,
  OpenAI's and Gemini's disqualifiers here are about this project's
  current constraints (a solo maintainer, no sales relationship, no
  approved budget for a paid tier), not a general critique of those
  providers.

## Consequences

- The Tesseract-based pipeline remains the only OCR path. Its known gap
  (~5% recognition failures on this corpus) stays open; T02's cheaper,
  already-identified non-AI improvements (multi-pass OCR with a
  selection rule, extractor rules for a few date/amount formats) remain
  available and unaffected by this decision.
- No new third-party data flow is added. `PRV-001-T01`'s current
  statement that "receipt images never leave this server" stays true.
- The T05 design (trigger predicate, opt-in shape, validation rules,
  circuit-breaker reuse) is not implemented. If revisited, it should be
  re-checked against whatever provider is actually chosen — T05's
  circuit-breaker tuning note in particular is specific to a local model's
  failure rate and should not be assumed to transfer.
- `docs/ocr/` keeps T01–T05 as the durable record of this investigation,
  so revisiting it later does not mean repeating this work.

## When to revisit this decision

Any of the following would be reason enough to reopen this ADR:

- **A hosted provider clears T03's privacy bar** — for example, a
  provider offers self-serve zero-retention with no image-specific
  carve-out, and the org can accept its terms without a sales approval
  this project can't get.
- **Real user demand appears** — support requests or product feedback
  specifically about receipts the current OCR gets wrong, which T03 and
  T04 both note is currently undocumented.
- **The corpus grows enough to size the real recognition-failure rate**
  with confidence, especially with more low-quality real photos like
  `limbo-premium`, rather than relying on this one small, largely
  single-maintainer sample.
- **A deployable path to a vision model appears** — either a hosted
  provider clears the bar above, or self-hosting inference is separately
  evaluated and approved as its own infrastructure decision.

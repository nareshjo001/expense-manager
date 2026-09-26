# OCR-006-T03: Vision-provider privacy, cost and failure-mode review

Evidence for the OCR-006 evidence gate item "Privacy/provider cost and
failure modes are approved". This document **reviews**; it does **not
approve** anything. See [Decision status](#decision-status).

Scope: vision-capable APIs from the three LLM providers this codebase
already has adapters for in SIA (`backend/sia/llmService.js`, configured by
`SIA_LLM_PROVIDER`): **Groq**, **OpenAI** and **Google Gemini**. Groq is
also the default speech-to-text provider (`SIA_STT_PROVIDER`). None of them
is currently used for, or approved for, receipt images. No other providers
were reviewed.

No receipt image or OCR text was sent to any provider while preparing this
review. All information comes from the providers' public documentation,
**retrieved 2026-09-26**. Provider policies, models and prices change often;
re-verify every row before any decision relies on it.

## 1. Current state this review must stay consistent with

- `docs/privacy/PRV-001-T01-user-data-and-external-services-inventory.md`
  §2.5 states: "**Receipt images never leave this server and are never
  persisted anywhere**". Receipt OCR is in-process Tesseract with
  `multer.memoryStorage()`. **Any vision fallback would make that statement
  false.** PRV-001's inventory, the user-facing privacy disclosure and the
  account-deletion policy (ADR-0007) would all need updating before any
  image is sent.
- PRV-001-T01 §2.3 and §2.4 already list OpenAI, Gemini and Groq as
  receiving *aggregated* SIA figures, with no user identity and no
  transaction-level records, plus raw audio (Groq). §4.2 records their
  retention policies as undocumented in this repo. A receipt image is a
  materially different data class: a transaction-level record, often with
  a location and sometimes a person's name. The existing SIA use does not
  imply approval for images.
- Workflow decisions that constrain any design
  (`workflow/decisions/architecture-decisions.md`, all *Proposed*):
  - ADR-002: LLMs never invent totals.
  - ADR-005: AI extraction creates drafts, never silent financial writes.
  - ADR-008: receipt review remains mandatory.
  - DNB-014 (`do-not-build.md`): LLM calculations may be revisited only
    with "an accepted ADR".

## 2. Provider comparison

Prices are list prices per 1M tokens (USD), converted to an estimated cost
per receipt of about 600x1200 px. The estimate assumes roughly 300 prompt
tokens and roughly 200 output tokens, with reasoning or "thinking" set as
low as the model allows. Reasoning tokens can multiply the output cost.

| | **Groq** | **OpenAI** | **Google Gemini API** |
|---|---|---|---|
| Already integrated in this codebase | Yes. SIA chat adapter plus STT default (Whisper). | Yes. SIA chat adapter. | Yes. SIA chat adapter, via the OpenAI-compatible endpoint. |
| Current vision-capable model (example) | `qwen/qwen3.8-27b`. It is the **only** vision model listed and has **Preview** status. The previous vision model, Llama 4 Scout, **shut down 2026-07-17**; Llama 4 Maverick shut down 2026-03-09. [G1][G2][G3] | `gpt-5.4-mini` (text and image input, structured outputs) [O3] | e.g. `gemini-3.1-flash-lite` / `gemini-3.8-flash` [M3] |
| Production suitability of that model | "Preview models are intended for evaluation purposes only and should not be used in production environments as they may be discontinued at short notice." [G2] | GA model with a dated snapshot (`gpt-5.4-mini-2026-03-17`) [O3] | GA (paid tier) [M3] |
| Training on API inputs | No: "Groq is not permitted to use Inputs or Outputs for training … unless explicitly granted permission" [G5] | No, since 2023-03-01, unless you opt in [O1] | **Paid tier: no.** **Free (unpaid) tier: yes**, and "human reviewers may read, annotate, and process your API input and output". [M1] |
| Default retention of inputs (incl. images) | "By default, Groq does not retain customer data for inference requests." Inputs and outputs may be logged for troubleshooting or abuse investigation, **up to 30 days**. [G4] | Abuse-monitoring logs "retained for up to 30 days". [O1] | Prompts and outputs retained **55 days** for abuse monitoring [M2]. The terms say "a limited period" [M1]. |
| Zero-retention option | **Yes, self-serve.** Any customer can turn on ZDR in the console Data Controls. It then does not retain data for reliability or abuse monitoring. [G4] | **By approval only.** "subject to prior approval by OpenAI" via sales. **Image caveat:** an image flagged by the CSAM classifier "will be retained for manual review, even if Zero Data Retention … is enabled". Modified Abuse Monitoring still excludes "image and file inputs in rare cases" only. [O1] | Documented ZDR posture for the Developer API. Apart from abuse monitoring, you avoid stateful features (`store=false`, no context caching, no Search/Maps grounding, which retain for 30 days). [M4] *How to exempt a project from the 55-day abuse-monitoring log is **unverified**.* |
| Are images logged? | Covered by the same policy as other inputs (above). No image-specific statement found. *Unverified.* | Yes, within abuse monitoring. Image-specific exceptions apply even under ZDR (above). | Images are explicitly part of "prompts" in the terms: "files such as images" [M1]. |
| Region / data location | "All customer data is retained in Google Cloud Platform (GCP) buckets located in the United States." [G4] | Data residency available in several regions, **including India** (`in.api.openai.com`). India needs approval for abuse-monitoring controls and a "Modified Retention amendment". [O1] | "may be stored transiently or cached in any country in which Google or its agents maintain facilities". EEA/UK/CH end users require the Paid Services. [M1] |
| Structured output with images | JSON Object and JSON Schema modes. `strict: true` (constrained decoding) is supported on `qwen/qwen3.8-27b`. [G1][G6] | The model page lists structured outputs [O3]. Strict-schema behaviour specifically *with image input* is not stated in the guides retrieved [O4]. *Unverified.* | Yes: JSON-schema structured output is documented together with image input. [M5] |
| Image token cost | 2,048 input tokens per image, max 3 images, and a 20 MB request limit for URL input [G1] | ceil(w/32)·ceil(h/32) patches × 1.2 multiplier, so about 870 tokens at 600x1200 [O2] | 258 tokens per 768x768 tile (≤384 px on both sides = 1 tile), so a few tiles and about 1–1.5k tokens [M5] |
| List price (per 1M tokens, in/out) | $0.80 / $4.00 (Preview) [G2] | $0.75 / $4.50 [O3] | Flash-Lite 3.1: $0.25 / $1.50. Flash 3.8: $0.75 / $3.75 through 2026-12-31, rising to $1.50 / $7.50. [M3] |
| **Estimated cost per receipt** | **≈ $0.003** (more with reasoning) | **≈ $0.002** | **≈ $0.001** (Flash-Lite) to **≈ $0.002** (Flash) |

All three are **fractions of a US cent per receipt**, so cost is not the
deciding factor at this app's scale. Retention, region, model stability and
hallucination risk are. For every provider this is an order-of-magnitude
estimate from list prices, not a measured bill.

### Provider-specific concerns

- **Groq.** Self-serve ZDR and a contractual no-training clause are the
  strongest privacy posture of the three. However, its only vision model is
  a Preview model, and its previous vision models were shut down within
  this calendar year. A fallback built on it would run on a model the
  vendor says not to use in production.
- **OpenAI.** It has an India data-residency option, but ZDR needs a sales
  approval that a solo project may not get. Even with ZDR, flagged images
  can be retained. Default retention is up to 30 days.
- **Gemini.** It is the cheapest, and structured output with images is
  documented. The **free tier uses inputs for training, with human
  review**, which is disqualifying for receipts. Any use must be
  paid-tier-only, and the SIA Gemini key's tier would need checking. The
  55-day abuse log and the "any country" storage wording are the weakest
  retention and region posture of the three.

## 3. Receipt-specific data minimization requirements

These requirements apply to any future design. They are conditions for a
design to be *considered*; they do not grant approval.

**What a receipt image can contain.** These were observed in this repo's
own corpus (`backend/scripts/ocrEvaluation/corpus/manifest.json` notes):

- The customer's name and mobile number. Two corpus receipts had to be
  blacked out, and one was highlighter-redacted.
- Merchant name, address and phone, i.e. where and when the user was.
  That is location and time-of-day data.
- GSTIN, bill/KOT/table numbers and waiter or cashier names, which are
  third-party personal data.
- Payment details: card last 4 digits, masked PAN, auth or approval codes,
  UPI references.
- Loyalty or membership IDs.
- Line items. For pharmacies, clinics, liquor or religious purchases these
  can reveal sensitive categories.

Requirements:

1. **Low-confidence and opt-in only.** Send only when the deterministic
   pipeline has already flagged the receipt (`needsReview`, or
   `NO_AMOUNT_FOUND` / `NO_DATE_FOUND` / low field confidence), **and** the
   user has given explicit per-user opt-in for this feature, separate from
   SIA consent. The per-user AI disable controls from SIA-001-T06 are the
   pattern to follow. The default is off.
2. **Crop before sending.** Use the per-line bounding boxes that
   OCR-003-T02 already preserves to send only the region around the
   missing or low-confidence field (the total block, the date line), not
   the whole receipt. T01/T02 show that the fields that fail are amount
   and date, not merchant.
3. **Redact what remains in the crop.** Black out lines matching phone
   numbers, card or PAN patterns, name/mobile fields and loyalty IDs before
   upload. Re-encode the image so no EXIF or GPS data remains;
   `preprocessImage()` already re-encodes to PNG, which drops it.
4. **No identity.** Send no userId, email, name or account metadata in the
   request, consistent with the SIA context rule in PRV-001-T01 §2.3.
5. **Never persist provider output unconfirmed.** Keep the provider's
   answer in memory only. Present it as a draft in the existing review UI
   (ADR-005, ADR-008). Write nothing to the ledger until the user confirms,
   and persist neither the raw provider response nor the image. This
   mirrors how SIA does not persist raw prompts and responses.
6. **Provider-side retention must be disclosed and reconciled with
   deletion.** A 30–55 day provider log outlives account deletion
   (ADR-0007). Either use a zero-retention configuration or document that
   gap, as ADR-0005 did for backups.
7. **Paid or contracted tiers only.** No free tier that trains on inputs.

## 4. Failure modes and required mitigations

| Failure mode | Why it matters for receipts | Required mitigation |
|---|---|---|
| **Hallucinated or "plausible" totals and dates** | A vision model can return a well-formed amount that is not on the receipt: a subtotal, a line item, a pre-rounding figure (warung-leko has `Total Bill 107,107` vs `Grand Total 107,000`), or an invented value. A wrong amount still looks like an amount. | The output must pass the **same deterministic validation as the OCR path**: `parseAmountInput()` and the scorer's calendar-date validation, plus range and plausibility checks such as a date not in the future. It must never auto-save (ADR-002/005/008). Where OCR text exists, prefer values that also appear in it. Show both candidates when they disagree. |
| **Schema drift or malformed output** | A non-JSON or wrong-shape answer breaks the draft. | Use strict structured output where the provider supports it (Groq `strict: true`; Gemini schema). Otherwise validate the JSON against a schema and treat a failure as "no suggestion". |
| **Currency and locale confusion** | IDR `107,000` vs INR decimals, and day-first vs month-first dates. | Put locale hints in the prompt, and validate the result with the same day-first rule the pipeline uses. |
| **Prompt injection via receipt text** | Printed text is untrusted input. | Use a fixed system prompt, structured output only, and no tools. Output is data that is validated, never an instruction. |
| **Timeouts, rate limits, outages** | They add latency to an upload that already waits up to 30 s for OCR. | Use a hard timeout, at most one retry, and a circuit breaker (the SIA-001-T04 pattern). On any failure, fall back silently to the existing OCR result and manual entry. |
| **Model deprecation or churn** | Groq removed two vision models in 2026, and its current one is Preview. | Pin model snapshots and keep a kill switch (see gate item 6). Re-run the T02 evaluation on every model change. |
| **Non-determinism** | The same receipt can give different answers. | Any evaluation must be repeated over several runs and reported as counts, like T02. |
| **Cost runaway** | Cost is cheap per call but unbounded by default. | Apply per-user and per-day caps and send only low-confidence receipts (requirement 1). |

## Decision status

**No provider is approved by this review.** Under this project's rules, a
new vendor or data flow requires an architecture/privacy decision (ADR)
that the project owner accepts. That applies to sending receipt images to
any of these three providers, even ones already used for SIA text. DNB-014
likewise requires "an accepted ADR". This document is input to such an
ADR; it is not the ADR.

## OCR-006 evidence gate checklist

Status is based on the evidence from T01–T03 only.

| Gate item (from the OCR-006 brief) | Status | Evidence |
|---|---|---|
| P0 and P1 dependencies are complete | **Partially met / needs owner reconciliation** | The task tables mark every task Done for OCR-003 (T01–T08), OCR-004 (T01–T07) and SIA-001 (T01–T07). However, the feature-doc headers still say OCR-003 "In Progress" and SIA-001 "Planned", and the 2026-09-08 audit blocks say "NOT IMPLEMENTED". The tracker must be reconciled before this can be called met. |
| A non-AI baseline is measured | **Met** (small-sample caveat) | T02 measures the current pipeline at 15/21 receipts (amount 17/21, date 18/21) and the production path at 15/21. The extraction ceiling is 17/21. The best single traditional configuration reaches 16/21. The oracle reaches 18/21 with the current extractor and 20/21 with a perfect one. |
| User demand and success metric are documented | **Not met** | T01–T03 contain no user-demand evidence and no agreed success metric. |
| Required data is consented, representative and large enough | **Not met** | The corpus is 15 real receipts from one maintainer. On it there is **1** recognition-only failure (limbo-premium) that no traditional method recovered. That cannot size a vision model's benefit or separate it from noise. The corpus images were contributed for local evaluation. No consent covers sending them, or any user's receipts, to a third party. |
| Privacy/provider cost and failure modes are approved | **Partially met: reviewed, not approved** | This document covers retention, training, ZDR, region, structured output, cost (roughly $0.001–0.003 per receipt) and failure modes for Groq, OpenAI and Gemini. Approval requires an owner-accepted ADR, and none exists. |
| The experiment can be disabled without affecting core financial CRUD | **Not assessed** | No design exists, by intent. The proposed ADR-005 and ADR-008 draft-and-confirm flow, plus the fall-back-to-OCR mitigation above, make this plausible. It must be shown by a design and tests, not asserted. |

**Overall: the OCR-006 gate is not met.** The strongest finding from
T01–T02 is that about 6 of the 7 current field failures look reachable with
cheaper non-AI work: better extraction, multi-pass OCR, and making the
harness match production. Only 1 of 21 receipts is a recognition-only
failure on current evidence. That argues for doing that work and growing the
corpus before revisiting a vision-model fallback.

## Sources (all retrieved 2026-09-26)

- [G1] Groq, *Vision*: https://console.groq.com/docs/vision
- [G2] Groq, *Supported Models*: https://console.groq.com/docs/models; model page https://console.groq.com/docs/model/qwen/qwen3.8-27b
- [G3] Groq, *Model Deprecation*: https://console.groq.com/docs/deprecations
- [G4] Groq, *Your Data in GroqCloud*: https://console.groq.com/docs/your-data
- [G5] Groq, *Services Agreement*: https://console.groq.com/docs/legal/services-agreement
- [G6] Groq, *Structured Outputs*: https://console.groq.com/docs/structured-outputs
- [O1] OpenAI, *Data controls in the OpenAI platform*: https://developers.openai.com/api/docs/guides/your-data
- [O2] OpenAI, *Images and vision*: https://developers.openai.com/api/docs/guides/images-vision
- [O3] OpenAI, *GPT-5.4 mini model page*: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- [O4] OpenAI, *Structured Outputs*: https://developers.openai.com/api/docs/guides/structured-outputs
- [M1] Google, *Gemini API Additional Terms of Service*: https://ai.google.dev/gemini-api/terms
- [M2] Google, *Abuse monitoring*: https://ai.google.dev/gemini-api/docs/usage-policies
- [M3] Google, *Gemini Developer API pricing*: https://ai.google.dev/gemini-api/docs/pricing
- [M4] Google, *Zero data retention in the Gemini Developer API*: https://ai.google.dev/gemini-api/docs/zdr
- [M5] Google, *Image understanding*: https://ai.google.dev/gemini-api/docs/image-understanding

Items marked *unverified* could not be confirmed from these pages and must be
checked with the provider before any ADR relies on them.

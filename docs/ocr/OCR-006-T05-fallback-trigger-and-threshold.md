# OCR-006-T05: Opt-in fallback trigger and confidence threshold (design spec)

No OCR-006 feature brief exists as a file in this repo (checked: no
`features/`, no tracker, no `OCR-006-T05` reference anywhere except one
line at the end of T04). This document is the T05 deliverable itself: a
precise spec for *when* the app would call a vision-model fallback and
*how* its answer would be treated, reusing the mechanisms this codebase
already has rather than inventing new ones. **It is a design spec, not an
implementation.** Per T03 and T04, the OCR-006 gate is still not met, and
§5 below identifies a new blocking gap T04 didn't need to surface: there is
currently no vision-model provider this design could actually call from a
deployed server. Nothing here is wired up; this is what would be built if
and when the remaining gate items clear.

## 1. Trigger condition — when the fallback would even be considered

The existing pipeline already computes everything needed; no new signal is
required.

- `parseReceipt()` (`backend/Services/BillServices/receiptParser.js`)
  already returns `reviewReasons` (a subset of the `REVIEW_REASONS` enum)
  and `fieldConfidence` per field, using the existing
  `LOW_CONFIDENCE_THRESHOLD = 60`. **T05 reuses this threshold as-is** —
  there is no evidence from T01–T04 to justify a different number, and
  introducing one would create two sources of truth for "low confidence."
- `needsReview` (`amount.value === null || isLow(overallConfidence)`) is
  **deliberately narrower** than `reviewReasons` (existing comment in
  `receiptParser.js`) — it drives today's UI messaging and must not be
  widened by this feature. The fallback trigger is a **new, separate**
  predicate over `reviewReasons`, not a change to `needsReview`.
- **Trigger predicate:** fallback is *eligible* (subject to §2's opt-in
  gate) when `reviewReasons` intersects:
  `NO_AMOUNT_FOUND, AMBIGUOUS_AMOUNT, LOW_AMOUNT_CONFIDENCE, NO_DATE_FOUND, LOW_DATE_CONFIDENCE, LOW_OVERALL_CONFIDENCE, NO_TEXT_RECOGNISED`.
  `MERCHANT_LOOKS_LIKE_HEADING` is **excluded**: merchant is scored
  informational-only throughout T01/T02/T04, and triggering an external,
  privacy-sensitive call over a field that was never gated would be
  disproportionate.
- This matches T03 requirement #1's wording exactly ("send only when the
  deterministic pipeline has already flagged the receipt — `needsReview`,
  or `NO_AMOUNT_FOUND`/`NO_DATE_FOUND`/low field confidence"); this section
  is that requirement made precise enough to implement.

## 2. Per-user opt-in — reusing the SIA-001-T06 shape, inverted default

T03 requirement #1 is explicit: **default off**, separate from SIA
consent. `SiaPreference`/`siaPreferenceService.js` (opt-*out*, `enabled`
default `true`, fails open on a DB read error) is the closest existing
pattern, but its polarity is backwards for this feature and its
fail-open behaviour is wrong here too.

- **New model**, same shape as `SiaPreference` (one doc per `userId`,
  unique index), new field name (not `enabled` — reusing that name on an
  opt-in doc invites exactly the confusion this section exists to avoid),
  e.g. `visionFallbackOptIn: Boolean, default: false`.
- **New service**, same function shape as `siaPreferenceService.js`
  (`getPreference`, `isEnabledForUser`, `setEnabled`), but
  `isEnabledForUser` **fails closed**: a DB read error returns `false`,
  the opposite of `safeIsSiaEnabledForUser`'s documented fail-open
  reasoning. SIA fails open because the worst case is an unwanted chat
  reply; this feature's worst case is sending a receipt image (which T03
  §3 shows can carry a name, phone number, GSTIN, payment digits) to a
  third party the user never confirmed. Those are not symmetric risks, so
  the two features should not share a fail-safe direction even though they
  share a code shape.
- Gate order: check `reviewReasons` (§1, cheap, local, no I/O) before
  checking opt-in (§2, one DB read) before ever touching the circuit
  breaker or making a network call — cheapest, most-local checks first.

## 3. Treating the fallback's answer — nothing new, cites what's already decided

T04 measured accuracy; it did not, and could not, license skipping
existing safeguards. All of the following are **already-established rules
this design must follow**, not new decisions:

- **Draft only, never a silent write** (ADR-005, ADR-008 as paraphrased in
  T03 §1; T03 failure-mode row 1 and requirement #5). The vision model's
  suggestion is a second candidate shown alongside the OCR extraction when
  they disagree, exactly as T02's conclusion and T03's mitigation table
  both already specify. The user confirms before anything reaches the
  ledger.
- **Never invent, always re-validate** (ADR-002; T03 failure-mode row 1).
  A vision-model amount/date must pass the same deterministic checks the
  OCR path already applies — `parseAmountInput()`, the calendar-date
  validation, not-in-the-future — before it is even offered as a draft.
  T04's own prompt-loop bug (a model confidently reasoning itself into an
  ambiguous answer) is a concrete reminder that a fluent-looking response
  is not a validated one.
- **Vision model's own confidence field is a second, independent gate.**
  T04's prompt already asks for `"confidence": "high"|"medium"|"low"`. A
  `"low"` self-reported confidence should suppress the suggestion (do not
  even show a low-confidence AI guess next to a low-confidence OCR guess —
  that helps no one) rather than being surfaced as-is.
- **Crop and redact before sending** (T03 requirement #2/#3) and **no
  identity in the request** (requirement #4) apply unchanged; T04 sent
  whole images only because it ran entirely on the maintainer's own
  machine with no third party involved, which is not the shape of a real
  deployment.

## 4. Circuit breaker — reuse SIA-001-T04's module, one tuning call-out

`providerCircuitBreaker.js`'s state machine (`closed → open → half-open →
closed`, tripping only on `HEALTH_SIGNAL_CODES` such as
`PROVIDER_TIMEOUT`) applies directly; a vision-OCR call would report
outcomes into it exactly like SIA's LLM calls do, keyed by its own
provider name so its state is independent of SIA's.

**One parameter should not just be copied from SIA's defaults.** SIA's
`circuitBreakerFailureThreshold` (default 5) and `circuitBreakerCooldownMs`
(default 30000) assume a normally-reliable hosted API where consecutive
failures mean "something is actually wrong." T04 measured a **~29%
non-completion rate as the model's normal, expected behaviour** on a
`qwen3-vl:4b`/Ollama setup (6–9 of 21 receipts timed out at 600,000ms in
every run, for reasons unrelated to outages). If a similar local-model
setup were ever the deployed provider, using SIA's threshold-of-5 as-is
would trip the breaker during ordinary operation, not during an actual
incident. This is flagged as a tuning input for whichever provider is
eventually approved, not resolved here — the right threshold depends on
that provider's real completion rate, which for a hosted API (once one is
approved) would need to be re-measured; T04's ~71% figure is specific to
this local model and should not be assumed to transfer.

## 5. What still blocks real implementation

T03 already lists three unmet gate items (privacy approval, user demand,
corpus size) that this document does not change. It surfaces a fourth,
narrower gap that only became visible once T04 tried to get a real
answer: **the only provider T04 could evidence runs on the maintainer's
own laptop, unreachable from a deployed server.** Every hosted option T03
reviewed (Groq, OpenAI, Gemini) remains unapproved, and Groq's vision
model was deprecated mid-task, twice, in the last eight months — a second
live instance of T03's "model deprecation or churn" failure mode. So
today, there is no path from "this design" to "a running feature" that
does not first either (a) get one of T03's hosted providers through an
ADR, and re-run something like T04 against it since its accuracy was never
measured, or (b) stand up a self-hosted vision-inference service the
production backend can reach, which is an infrastructure decision this
task did not evaluate at all.

## Updated OCR-006 evidence gate status

| Gate item | Status | Change from T04 |
|---|---|---|
| A non-AI baseline is measured | Met (T02) | Unchanged |
| A vision model's accuracy is measured | Met for this corpus (T04) | Unchanged |
| **Trigger and threshold logic is specified** *(new, added by this task)* | **Met, as a spec**: §1–§4 above, all reusing existing mechanisms | New |
| Privacy/provider cost and failure modes are approved | Partially met: reviewed, not approved | Unchanged |
| Required data is consented, representative and large enough | Not met | Unchanged |
| **A deployable provider exists** *(new, surfaced by this task)* | **Not met** — see §5 | New, and currently the most concrete blocker |
| The experiment can be disabled without affecting core financial CRUD | Not assessed | Unchanged |

**Overall: still not met.** What T05 adds is that *if* a provider clears
governance, the trigger, opt-in, validation and circuit-breaker design are
already fully specified and reuse existing code shapes rather than
requiring new architecture — the remaining work from here is governance
(an accepted ADR) and infrastructure (a reachable provider), not further
design.

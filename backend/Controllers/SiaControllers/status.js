// SIA runtime-status controller -- Batch 3E.
//
// Answers exactly one question, for an authenticated caller: can SIA accept
// a new question right now? The whole point is that the frontend learns
// this BEFORE a user types and submits, instead of discovering a
// misconfiguration only from a failed answer.
//
// The public contract is deliberately the minimum that is useful:
//
//   200 { "success": true, "available": true }
//   200 { "success": true, "available": false }
//
// and nothing else. No provider name, model name, credential presence,
// environment-variable name, internal reason code, configuration detail, or
// stack trace is ever included -- an unauthenticated-but-curious caller (or
// an authenticated one) learns only whether the feature works, never
// anything about how it is deployed. `available: false` is intentionally
// indistinguishable between "disabled", "no provider", "no model", and "no
// credential": all four are operator concerns, not user-facing ones.
//
// This handler performs NO side effects whatsoever: no LLM call, no Report
// V3/analytics access, no MongoDB session read or write, no idempotency
// reservation, no rate-limit-relevant expensive work. It reads local
// configuration and returns. That is what makes it safe to call on panel
// open without consuming any of the ask endpoint's budget.
//
// Note that `available: true` reflects local configuration readiness only
// (see sia/readiness.js) -- it never means OpenAI was contacted or is
// currently reachable. A ready request can still fail later with the
// existing generic 503, which remains correct for a real provider failure.
"use strict";

const { isSiaReady } = require("../../sia/readiness");

const status = (req, res) => {
  // Deliberately not wrapped in try/catch: isSiaReady() is a synchronous,
  // side-effect-free local configuration read that has no throwing branch.
  // A speculative catch here would only risk converting a genuine
  // programming error into a silent, misleading "available: false".
  return res.status(200).json({
    success: true,
    available: isSiaReady(),
  });
};

module.exports = {
  status,
};

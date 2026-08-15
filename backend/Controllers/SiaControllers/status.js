// SIA runtime-status controller -- answers "can SIA accept a new question right now?" so the frontend learns this before the user submits, not only from a failed answer. Public contract: 200 {success:true, available:true|false}, nothing else -- no provider name, model, credential presence, env-var name, reason code, or stack trace; `available:false` is intentionally indistinguishable between disabled/no-provider/no-model/no-credential (operator concerns, not user-facing). No side effects: no LLM call, no Report V3/analytics access, no session read/write, no reservation -- safe to call on panel open. `available:true` reflects local configuration readiness only (sia/readiness.js), never that the provider was actually contacted; a ready request can still fail later with the existing generic 503.
"use strict";

const { isSiaReady } = require("../../sia/readiness");

const status = (req, res) => {
  // Deliberately not wrapped in try/catch: isSiaReady() is synchronous and side-effect-free with no throwing branch -- a speculative catch would only risk masking a genuine programming error as a misleading "available: false".
  return res.status(200).json({
    success: true,
    available: isSiaReady(),
  });
};

module.exports = {
  status,
};

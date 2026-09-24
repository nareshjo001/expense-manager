"use strict";

// OCR-005-T06 -- structured audit-event emission for duplicate-decision
// outcomes, plus the pure rate-computation math that would let this
// feature's false-positive/override rates be measured from real usage.
// There is no live traffic to measure against in this sandbox, so this
// module is built the same way every other cron/observability task here
// handles that: emit the real event shape now, prove the measurement math
// is correct against synthetic fixtures (see
// tests/duplicateDecisionAudit.test.js), and let real traffic feed
// `computeDuplicateDecisionRates` once an event store exists.
//
// Same pattern as Services/BillServices/receiptSecurity.service.js's
// emitReceiptAuditEvent and Services/AuthServices/security.service.js's
// emitAuthAuditEvent -- structured console.info(JSON.stringify(...))
// logging, any user/receipt-identity field hashed via fingerprint() before
// it's ever logged, an ISO occurredAt timestamp, a featureId. The
// requestId line below is copied verbatim from emitReceiptAuditEvent --
// don't re-derive that extraction differently here.
const { fingerprint } = require("../AuthServices/security.service");
const { DUPLICATE_STATUSES, DUPLICATE_REASON_CODES } = require("../../utils/duplicateDetectionRules");

const emitDuplicateDecisionEvent = ({ req, receiptId, decision, matchedReasonCode }) => {
  console.info(JSON.stringify({
    type: "duplicate_decision_event",
    featureId: "OCR-005",
    decision,
    matchedReasonCode,
    receiptIdHash: fingerprint(receiptId),
    userHash: fingerprint(req?.userId),
    requestId: String(req?.get?.("X-Request-ID") || "").slice(0, 128) || undefined,
    occurredAt: new Date().toISOString(),
  }));
};

const round4 = (value) => Math.round(value * 10000) / 10000;

// PURE -- no I/O. Takes an array of plain event objects shaped like what
// emitDuplicateDecisionEvent logs (`{ decision, matchedReasonCode }`) and
// returns the two rates that matter for judging this feature's real-world
// accuracy:
//
//   - overrideRate: the fraction of ALL decisions where the user was shown
//     a duplicate flag and said "no, this is genuinely new"
//     (CONFIRMED_NEW) -- an override of the system's flag.
//   - exactMatchOverrideRate: the same override, narrowed to decisions
//     whose matchedReasonCode was EXACT_FILE_MATCH -- the strongest
//     possible false-positive signal, since EXACT_FILE_MATCH means the
//     uploaded bytes were literally identical; a user still overriding
//     that is the clearest sign the feature (or the user) got it wrong.
//
// Never divides by zero: both rates are 0 (never NaN) when there's
// nothing to divide by. Both are rounded to 4 decimal places so float
// noise never makes an equality assertion flaky.
function computeDuplicateDecisionRates(events) {
  const list = Array.isArray(events) ? events : [];
  const totalDecisions = list.length;

  if (totalDecisions === 0) {
    return { totalDecisions: 0, overrideRate: 0, exactMatchOverrideRate: 0 };
  }

  const overrideCount = list.filter((e) => e && e.decision === DUPLICATE_STATUSES.CONFIRMED_NEW).length;
  const exactMatchEvents = list.filter(
    (e) => e && e.matchedReasonCode === DUPLICATE_REASON_CODES.EXACT_FILE_MATCH
  );
  const exactMatchOverrideCount = exactMatchEvents.filter(
    (e) => e.decision === DUPLICATE_STATUSES.CONFIRMED_NEW
  ).length;

  return {
    totalDecisions,
    overrideRate: round4(overrideCount / totalDecisions),
    exactMatchOverrideRate:
      exactMatchEvents.length === 0 ? 0 : round4(exactMatchOverrideCount / exactMatchEvents.length),
  };
}

module.exports = {
  emitDuplicateDecisionEvent,
  computeDuplicateDecisionRates,
};

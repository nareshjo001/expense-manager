"use strict";

// Structured audit-event emission for duplicate-decision outcomes, plus the pure rate-computation math that would let this feature's false-positive/override rates be measured from real usage.
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

// PURE -- no I/O. Takes an array of plain event objects shaped like what emitDuplicateDecisionEvent logs (`{ decision, matchedReasonCode }`) a.
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

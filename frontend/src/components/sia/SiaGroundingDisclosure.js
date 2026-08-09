import React, { useState } from "react";

// Batch 3F: the compact, collapsed-by-default disclosure rendered under an
// assistant answer that shows which BALENISA analytics summaries were
// provided to SIA as grounding context. Server-owned data only -- this
// component never invents, reorders, or relabels anything; it only decides
// whether the supplied `grounding` is safe to render and, if so, whether it
// is currently expanded.
//
// Deliberately fails closed: `isValidGrounding` is the single gate every
// caller must pass through (SiaPanel.js checks it before even mounting this
// component for a message), so a missing, malformed, or legacy (pre-3F)
// message can never crash the transcript or render an empty/broken
// disclosure.
export function isValidGrounding(grounding) {
  if (!grounding || typeof grounding !== "object") return false;
  if (!Array.isArray(grounding.sources)) return false;
  if (grounding.sources.length === 0) return false;
  return grounding.sources.every(
    (source) =>
      source &&
      typeof source === "object" &&
      typeof source.key === "string" &&
      source.key.trim() !== "" &&
      typeof source.label === "string" &&
      source.label.trim() !== "" &&
      (source.period === undefined || source.period === null || typeof source.period === "string")
  );
}

let disclosureIdCounter = 0;
function nextDisclosureId() {
  disclosureIdCounter += 1;
  return `sia-grounding-${disclosureIdCounter}`;
}

// One collapsed/expanded boolean per rendered instance (React state is
// naturally scoped per component instance, so multiple assistant messages
// in the same transcript -- and a message re-rendered after session
// resumption -- each get their own independent toggle with no shared or
// leaked state).
const SiaGroundingDisclosure = ({ grounding }) => {
  const [contentId] = useState(nextDisclosureId);
  const [expanded, setExpanded] = useState(false);

  if (!isValidGrounding(grounding)) return null;

  const sources = grounding.sources;
  const count = sources.length;
  const summaryText = `BALENISA data supported this answer (${count} ${count === 1 ? "source" : "sources"})`;

  const toggle = () => setExpanded((prev) => !prev);

  return (
    <div className="sia-grounding">
      <button
        type="button"
        className="sia-grounding-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={toggle}
      >
        <span className="sia-grounding-toggle-text">{summaryText}</span>
        <span className="sia-grounding-caret" aria-hidden="true">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div id={contentId} className="sia-grounding-panel">
          <p className="sia-grounding-explainer">
            These BALENISA summaries were provided to SIA as context for this answer. They informed the
            response but do not mean every part of the answer came directly from each one.
          </p>
          <ul className="sia-grounding-list">
            {sources.map((source) => (
              <li key={source.key} className="sia-grounding-item">
                <span className="sia-grounding-label">{source.label}</span>
                {typeof source.period === "string" && source.period.trim() !== "" && (
                  <span className="sia-grounding-period">{source.period}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SiaGroundingDisclosure;

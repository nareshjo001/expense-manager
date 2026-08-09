import React from "react";
import { useSiaLauncher } from "./SiaLauncherContext";
import "./SiaAskButton.css";

// Mirrors SiaEntryPoint.js's OWN isSiaEnabled() check exactly (same env
// var, same exact-lowercase-"true" contract). Deliberately duplicated
// rather than imported: importing from SiaEntryPoint.js would pull in its
// entire module graph (SiaPanel -> SiaSessionList -> the sia session API
// layer, which itself imports the shared axios instance) into every place
// this button is used, purely to reach a two-line boolean check -- exactly
// the "no new shared module for two lines" tradeoff SiaEntryPoint.js's own
// blockedByAvailability duplication already makes for the same reason.
function isSiaEnabled() {
  return process.env.REACT_APP_SIA_ENABLED === "true";
}

// Batch 3G: the one reusable contextual "Ask SIA" button. Every placement
// (see monthlyInsights/Header.js's Spending Trend card and
// BudgetIntelligence.js) renders this SAME component with a fixed,
// developer-authored `suggestionId` and `label` -- never raw text, a
// metric, an amount, a category name, or any other card-supplied value.
// `label` is rendered as the button's own visible text, which is therefore
// also its accessible name (no separate aria-label needed, and none is
// used, so a screen reader or voice-control user is never told something
// different from what is shown).
//
// Renders nothing at all when SIA itself is disabled (matches
// SiaEntryPoint's own build-flag gate exactly) or when no
// SiaLauncherProvider is mounted above it in the tree -- a missing
// provider is a configuration error, not something this button should ever
// crash on.
// `tone` is an explicit, narrowly-scoped appearance switch -- NOT a new
// color, contextual metric, or card-supplied value. It exists solely
// because this button's default styling (SiaAskButton.css) uses
// `color: inherit` so it automatically matches whichever text color is
// already correct for its surrounding card. That works for
// monthlyInsights/Header.js's Spending Trend card (a saturated gradient
// with `color: white` in both themes) but NOT for BudgetIntelligence.js's
// inner report card, whose background stays hard-coded white in both
// themes while the inherited app text color (`--text-color`) turns
// near-white in dark theme -- producing illegible near-white-on-white
// text. `tone="light-surface"` opts a placement into a fixed, always-dark
// text color instead of inheriting, for exactly that one fixed-white-card
// case. Omitting `tone` (the Header placement) is completely unaffected.
const SiaAskButton = ({ suggestionId, label, className, tone }) => {
  const launcher = useSiaLauncher();

  if (!isSiaEnabled()) return null;
  if (!launcher) return null;

  const handleClick = () => {
    launcher.openSiaWithQuestion(suggestionId);
  };

  const toneClass = tone === "light-surface" ? "sia-ask-btn--light-surface" : "";
  const classes = ["sia-ask-btn", toneClass, className].filter(Boolean).join(" ");

  return (
    <button type="button" className={classes} onClick={handleClick}>
      {label}
    </button>
  );
};

export default SiaAskButton;

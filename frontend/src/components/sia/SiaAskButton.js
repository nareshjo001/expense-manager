import React from "react";
import { useSiaLauncher } from "./SiaLauncherContext";
import "./SiaAskButton.css";

// Mirrors SiaEntryPoint.js's OWN isSiaEnabled() check exactly (same env
function isSiaEnabled() {
  return process.env.REACT_APP_SIA_ENABLED === "true";
}

// Batch 3G: the one reusable contextual "Ask SIA" button. Every placement
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

import React from "react";

// CRA only embeds env vars prefixed REACT_APP_ at build time. Read once at
// module load, matching every other REACT_APP_* usage in this codebase
// (see frontend/src/api/axios.js, App.js). Disabled by default: only the
// exact lowercase string "true" enables this launcher -- any other value
// ("1", "TRUE", "yes", missing, etc.) keeps it hidden. This is a visibility
// control only; the backend's own SIA_ENABLED remains the authoritative
// server-side safety gate regardless of this flag's value.
const SIA_ENABLED = process.env.REACT_APP_SIA_ENABLED === "true";

// M4-3: an intentionally hidden launcher scaffold. Rendered only inside
// LandingPage.js's existing authenticated tree, so this component never
// inspects auth state, JWTs, or localStorage itself -- authenticated
// placement is guaranteed by where it is mounted, not by this component.
// It calls no API and no mutation hook (see M4-2's useSiaAskMutation) and
// renders no panel, input, answer, loading, or error state -- M4-4 wires
// this button's onOpen callback to SiaPanel.
const SiaEntryPoint = ({ onOpen }) => {
  if (!SIA_ENABLED) {
    return null;
  }

  const handleClick = () => {
    if (typeof onOpen === "function") {
      onOpen();
    }
  };

  return (
    <button type="button" className="sia-entry-point" onClick={handleClick}>
      Ask SIA
    </button>
  );
};

export default SiaEntryPoint;

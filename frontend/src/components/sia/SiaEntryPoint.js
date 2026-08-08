import React, { useContext, useState } from "react";
import { ThemeContext } from "../contexts/ThemeContext";
import SiaPanel from "./SiaPanel";

// M4-3: CRA only embeds env vars prefixed REACT_APP_ at build time. Checked
// fresh on every render rather than cached as a module-level constant, so
// this component's tests can flip the flag via a plain process.env
// assignment without jest.resetModules()/a fresh require -- resetting
// Jest's module registry would also reload React itself, risking a second
// React instance and "Invalid hook call" errors now that this component
// uses hooks (useState/useContext, both needed to own open/close state).
// Disabled by default: only the exact lowercase string "true" enables this
// launcher -- any other value ("1", "TRUE", "yes", missing, etc.) keeps it
// hidden. This is a visibility control only; the backend's own SIA_ENABLED
// remains the authoritative server-side safety gate regardless of this
// flag's value.
function isSiaEnabled() {
  return process.env.REACT_APP_SIA_ENABLED === "true";
}

// M4-3 scaffold, M4-4 integration: owns whether the panel is open. Rendered
// only inside LandingPage.js's existing authenticated tree, so this
// component never inspects auth state, JWTs, or localStorage itself --
// authenticated placement is guaranteed by where it is mounted. Closed
// state renders the "Ask SIA" launcher button; open state renders SiaPanel
// INSTEAD of the button (never both), so every open is a fresh SiaPanel
// mount with no leftover question/answer state from a previous session.
//
// Reads the app's existing ThemeContext (light-theme/dark-theme, see
// components/contexts/ThemeContext.js) defensively -- SiaEntryPoint/SiaPanel
// render as siblings of LandingPage.js's themed app-container, not
// descendants of it, so the theme value isn't otherwise available here.
// Falls back to "light-theme" if no ThemeProvider is present (e.g. in an
// isolated unit test), which never throws.
const SiaEntryPoint = ({ onOpen }) => {
  const [isOpen, setIsOpen] = useState(false);
  const themeContext = useContext(ThemeContext) || {};
  const theme = themeContext.theme || "light-theme";

  if (!isSiaEnabled()) {
    return null;
  }

  const handleOpen = () => {
    setIsOpen(true);
    if (typeof onOpen === "function") {
      onOpen();
    }
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <div className={`sia-root ${theme}`}>
      {isOpen ? (
        <SiaPanel onClose={handleClose} />
      ) : (
        <button type="button" className="sia-entry-point" onClick={handleOpen}>
          Ask SIA
        </button>
      )}
    </div>
  );
};

export default SiaEntryPoint;

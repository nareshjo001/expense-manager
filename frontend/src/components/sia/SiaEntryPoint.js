import React, { useContext, useEffect, useRef, useState } from "react";
import { ThemeContext } from "../contexts/ThemeContext";
import SiaPanel from "./SiaPanel";
import { useSiaConversation } from "./useSiaConversation";

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

// M4-3 scaffold, M4-4 integration, Batch 3C conversation ownership.
//
// Rendered only inside LandingPage.js's existing authenticated tree, so
// this component never inspects auth state, JWTs, or localStorage itself --
// authenticated placement is guaranteed by where it is mounted.
//
// Batch 3C: this component now OWNS the conversation state (via
// useSiaConversation) rather than leaving it inside SiaPanel. SiaPanel is
// still unmounted while closed -- it is pure presentation -- but the
// transcript, active session id, composer text and any in-flight request
// survive close/reopen because they live here instead. Nothing is written
// to localStorage/sessionStorage, so a page refresh deliberately starts a
// fresh local conversation, with server-side history as the explicit
// recovery path.
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
  const launcherRef = useRef(null);
  const shouldRefocusLauncher = useRef(false);

  // Mounted unconditionally so an in-flight request is never lost merely
  // because the user closed the panel.
  const conversation = useSiaConversation();

  // Focus can only move to the launcher AFTER it has been re-rendered, so
  // this runs as an effect rather than inline in the close handler (where
  // the ref is still null because the button does not exist yet).
  useEffect(() => {
    if (!isOpen && shouldRefocusLauncher.current && launcherRef.current) {
      launcherRef.current.focus();
      shouldRefocusLauncher.current = false;
    }
  }, [isOpen]);

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
    // Return focus to the control that opened the panel, once it exists
    // again (see the effect above).
    shouldRefocusLauncher.current = true;
    setIsOpen(false);
  };

  return (
    <div className={`sia-root ${theme}`}>
      {isOpen ? (
        <SiaPanel onClose={handleClose} conversation={conversation} />
      ) : (
        <button
          type="button"
          className="sia-entry-point"
          onClick={handleOpen}
          ref={launcherRef}
        >
          Ask SIA
        </button>
      )}
    </div>
  );
};

export default SiaEntryPoint;

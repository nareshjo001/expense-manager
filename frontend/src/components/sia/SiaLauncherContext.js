import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import SiaEntryPoint from "./SiaEntryPoint";
import { SIA_SUGGESTIONS } from "./siaSuggestions";

// Batch 3G: the shared contextual launcher.
const SiaLauncherContext = createContext(null);

export function useSiaLauncher() {
  return useContext(SiaLauncherContext);
}

export const SiaLauncherProvider = ({ children }) => {
  const entryPointRef = useRef(null);
  const location = useLocation();

  // A stable callback (empty dependency array): identity never changes
  const openSiaWithQuestion = useCallback((suggestionId) => {
    const entryPoint = entryPointRef.current;
    if (!entryPoint) return; // Not mounted (e.g. SIA disabled) -- no-op.

    // Resolve the id ONLY through the centralized, developer-authored
    const suggestion = SIA_SUGGESTIONS.find((s) => s.id === suggestionId);
    if (!suggestion) return;

    entryPoint.openWithSuggestion(suggestion.text);
  }, []);

  const contextValue = useMemo(() => ({ openSiaWithQuestion }), [openSiaWithQuestion]);

  return (
    <SiaLauncherContext.Provider value={contextValue}>
      {children}
      <SiaEntryPoint
        ref={entryPointRef}
        hideLauncher={
          location.pathname === "/add" ||
          location.pathname === "/budgets" ||
          location.pathname === "/rules" ||
          location.pathname.startsWith("/rules/") ||
          location.pathname === "/sia-settings" ||
          location.pathname.startsWith("/sia-settings/") ||
          location.pathname === "/notification-preferences" ||
          location.pathname.startsWith("/notification-preferences/") ||
          location.pathname === "/notifications" ||
          location.pathname.startsWith("/notifications/") ||
          location.pathname === "/export" ||
          location.pathname.startsWith("/export/") ||
          location.pathname === "/import" ||
          location.pathname.startsWith("/import/") ||
          location.pathname === "/recurring" ||
          location.pathname.startsWith("/recurring/") ||
          location.pathname === "/receipts" ||
          location.pathname.startsWith("/receipts/")
        }
      />
    </SiaLauncherContext.Provider>
  );
};

export default SiaLauncherContext;

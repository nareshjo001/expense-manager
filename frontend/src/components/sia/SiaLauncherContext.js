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
      <SiaEntryPoint ref={entryPointRef} hideLauncher={location.pathname === "/add"} />
    </SiaLauncherContext.Provider>
  );
};

export default SiaLauncherContext;

import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import SiaEntryPoint from "./SiaEntryPoint";
import { SIA_SUGGESTIONS } from "./siaSuggestions";

// Batch 3G: the shared contextual launcher.
//
// A contextual button (e.g. monthlyInsights/Header.js's Spending Trend
// card, or BudgetIntelligence.js) lives far away from SIA's own tree in
// LandingPage.js, but must be able to open the SAME global SIA
// entry point and safely prefill its composer. This module is the ONLY
// bridge between the two.
//
// Deliberately narrow: the public context value below carries exactly one
// stable function, `openSiaWithQuestion(suggestionId)` -- never the
// conversation object, never raw question text, never any card-supplied
// metric/amount/category/context/grounding/intent/provenance. A card can
// only ever request one of the fixed, centrally-defined suggestions in
// siaSuggestions.js by its `id`; every other input is looked up, not
// trusted. See SiaAskButton.js for the consuming side.
//
// SiaLauncherProvider does NOT lift SiaEntryPoint's isOpen/conversation/
// availability state out of that component -- SiaEntryPoint keeps owning
// all of that exactly as before (see SiaEntryPoint.js and its unchanged
// test suite). Instead, this Provider talks to a single mounted
// SiaEntryPoint instance through a ref and its one imperative method,
// openWithSuggestion(). SiaEntryPoint is rendered directly here, inside
// this Provider, not exposed through the public context -- a consumer of
// useSiaLauncher() can never reach the conversation object, only the one
// action.
const SiaLauncherContext = createContext(null);

export function useSiaLauncher() {
  return useContext(SiaLauncherContext);
}

export const SiaLauncherProvider = ({ children }) => {
  const entryPointRef = useRef(null);

  // A stable callback (empty dependency array): identity never changes
  // across composer keystrokes, message updates, availability refetches,
  // session restoration, or panel open/close, because it never closes over
  // any of that reactive state directly -- it only reads
  // entryPointRef.current at call time, which always points at the single
  // mounted SiaEntryPoint's LATEST imperative handle (SiaEntryPoint's own
  // useImperativeHandle is redefined every render, so the handle itself is
  // always current; only the ref's identity here needs to stay stable, and
  // it does).
  const openSiaWithQuestion = useCallback((suggestionId) => {
    const entryPoint = entryPointRef.current;
    if (!entryPoint) return; // Not mounted (e.g. SIA disabled) -- no-op.

    // Resolve the id ONLY through the centralized, developer-authored
    // registry. An unknown or malformed id fails closed: no state
    // mutation, no crash, and nothing is ever opened or prefilled from
    // caller-supplied text.
    const suggestion = SIA_SUGGESTIONS.find((s) => s.id === suggestionId);
    if (!suggestion) return;

    entryPoint.openWithSuggestion(suggestion.text);
  }, []);

  const contextValue = useMemo(() => ({ openSiaWithQuestion }), [openSiaWithQuestion]);

  return (
    <SiaLauncherContext.Provider value={contextValue}>
      {children}
      <SiaEntryPoint ref={entryPointRef} />
    </SiaLauncherContext.Provider>
  );
};

export default SiaLauncherContext;

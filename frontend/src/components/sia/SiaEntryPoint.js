import React, { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { HiSparkles } from "react-icons/hi2";
import { ThemeContext } from "../contexts/ThemeContext";
import SiaPanel from "./SiaPanel";
import { useSiaConversation, PANEL_MODE } from "./useSiaConversation";
import { useSiaStatusQuery, isSiaAvailableResponse } from "../../hooks/queries/useSiaStatusQuery";

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
// Batch 3G: `ref` is new and purely additive -- forwardRef/useImperativeHandle
// expose exactly one imperative method, `openWithSuggestion(text)`, so the
// shared contextual launcher (SiaLauncherContext.js's SiaLauncherProvider)
// can open this SAME entry point and safely prefill it from a card far away
// in the tree, WITHOUT lifting isOpen/conversation/availability state out of
// this component and WITHOUT exposing the full conversation object through
// a public React Context. Every existing caller that renders
// `<SiaEntryPoint onOpen={...} />` with no ref keeps working completely
// unchanged -- this component's own state ownership and visible behavior
// (the flag gate, the open/close wiring, the onOpen callback) are untouched.
const SiaEntryPoint = forwardRef(({ onOpen, hideLauncher = false }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const themeContext = useContext(ThemeContext) || {};
  const theme = themeContext.theme || "light-theme";
  const launcherRef = useRef(null);
  const shouldRefocusLauncher = useRef(false);

  // Mounted unconditionally so an in-flight request is never lost merely
  // because the user closed the panel.
  const conversation = useSiaConversation();

  // Batch 3E: runtime availability. Owned HERE, not in SiaPanel, for the
  // same reason the conversation is -- SiaPanel unmounts on close, so a
  // panel-owned query would re-request on every reopen. Living here means
  // one request per mounted app session (then served from cache until
  // stale), and it is gated on the build-time flag below so a
  // SIA-disabled build issues no request at all.
  const statusQuery = useSiaStatusQuery(isSiaEnabled());
  const isCheckingAvailability = statusQuery.isLoading || statusQuery.isFetching;
  // Fail closed: anything other than an unambiguous success/available pair
  // (network error, non-2xx, malformed body, still loading) means new
  // questions are blocked. History stays readable regardless.
  const isSiaAvailable = statusQuery.isSuccess && isSiaAvailableResponse(statusQuery.data);
  // Mirrors SiaPanel.js's OWN blockedByAvailability computation exactly
  // (see that file) -- duplicated deliberately rather than imported, since
  // it is a two-line pure boolean and importing it would create a
  // presentation-detail coupling in the opposite direction (SiaPanel
  // depending on SiaEntryPoint, or a new shared module for two lines).
  const isAvailabilityKnown = isSiaAvailable !== undefined || isCheckingAvailability !== undefined;
  const blockedByAvailability = isAvailabilityKnown && (isCheckingAvailability === true || isSiaAvailable !== true);

  // Batch 3G: an explicit, monotonically increasing contextual-launch focus
  // signal (see SiaPanel.js's effect keyed on this exact prop). `mode`
  // alone cannot reliably refocus the composer when the panel is already
  // open, already in conversation mode, or a second contextual button is
  // clicked while a first click's prefill is still showing -- none of
  // those transitions necessarily change `mode`.
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);

  // Batch 3G remediation: SiaPanel unmounts entirely on close (see above),
  // so any "have I already handled this version" bookkeeping kept INSIDE
  // SiaPanel is lost on close and starts fresh at the next mount -- which
  // let an ordinary, non-contextual reopen replay an already-consumed
  // contextual focus request (the audit's finding). This ref lives here,
  // in SiaEntryPoint, which never unmounts while the app session is alive,
  // so the "last handled" bookkeeping survives every SiaPanel close/reopen.
  // It is intentionally a ref (not state): acknowledging a version must
  // never itself trigger a render.
  const lastHandledFocusRequestVersionRef = useRef(0);

  // Focus can only move to the launcher AFTER it has been re-rendered, so
  // this runs as an effect rather than inline in the close handler (where
  // the ref is still null because the button does not exist yet).
  useEffect(() => {
    if (!isOpen && shouldRefocusLauncher.current && launcherRef.current) {
      launcherRef.current.focus();
      shouldRefocusLauncher.current = false;
    }
  }, [isOpen]);

  // Batch 3G contextual-launcher contract (see SiaLauncherContext.js for
  // the id-resolution/validation side of this): opens the panel, returns to
  // conversation mode if history is currently shown, prefills the composer
  // ONLY when it is genuinely safe to do so, and always requests focus.
  // Every check here reads this render's OWN latest state directly (this
  // function is redefined on every render of this component, exactly like
  // any other handler in this file), so it can never act on a stale
  // snapshot of the composer/pending/failed/availability state.
  useImperativeHandle(
    ref,
    () => ({
      openWithSuggestion: (text) => {
        if (typeof text !== "string" || text.trim() === "") return;

        setIsOpen(true);

        if (conversation.mode === PANEL_MODE.HISTORY) {
          conversation.setMode(PANEL_MODE.CONVERSATION);
          conversation.selectHistorySession(null);
        }

        const canPrefill =
          conversation.input.trim() === "" &&
          !conversation.isBusy &&
          !conversation.failed &&
          !blockedByAvailability;

        if (canPrefill) {
          conversation.setInput(text);
        }

        setFocusRequestVersion((v) => v + 1);
      },
    }),
    [conversation, blockedByAvailability]
  );

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
        <SiaPanel
          onClose={handleClose}
          conversation={conversation}
          // The launcher itself is never hidden by backend unavailability
          // -- users must always be able to open SIA and read previous
          // conversations. Only NEW submissions are gated.
          isAvailable={isSiaAvailable}
          isCheckingAvailability={isCheckingAvailability}
          onRetryAvailability={statusQuery.refetch}
          focusRequestVersion={focusRequestVersion}
          lastHandledFocusRequestVersionRef={lastHandledFocusRequestVersionRef}
          // Workstream 3: GET /sia/status's additive
          // capabilities.voiceInput block, read from the SAME status query
          // this component already owns -- no second request. Undefined
          // until a successful response arrives, which SiaPanel treats the
          // same fail-closed way isAvailable/isCheckingAvailability are
          // treated above (voice controls simply don't render yet).
          voiceCapabilities={statusQuery.data?.capabilities?.voiceInput}
        />
      ) : !hideLauncher ? (
        <button
          type="button"
          className="sia-entry-point"
          onClick={handleOpen}
          ref={launcherRef}
        >
          <HiSparkles aria-hidden="true" />
          <span>Ask SIA</span>
        </button>
      ) : null}
    </div>
  );
});

SiaEntryPoint.displayName = "SiaEntryPoint";

export default SiaEntryPoint;
export { isSiaEnabled };

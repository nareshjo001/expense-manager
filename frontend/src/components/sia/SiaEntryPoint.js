import React, { forwardRef, Suspense, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { HiSparkles } from "react-icons/hi2";
import { ThemeContext } from "../contexts/ThemeContext";

// FE-003-T04 -- SiaPanel (conversation UI, session list, voice recording
// controls) is lazy-loaded: it's only needed once a user actually opens
// "Ask SIA", so it shouldn't ship in the main bundle for every session.
// SiaPanel.css is imported HERE (eagerly), not in SiaPanel.js, because it
// also styles .sia-root/.sia-entry-point -- the always-rendered launcher
// button below -- which must stay styled even before the panel chunk loads.
import "./SiaPanel.css";
import { useSiaConversation, PANEL_MODE } from "./useSiaConversation";
import { useSiaStatusQuery, isSiaAvailableResponse } from "../../hooks/queries/useSiaStatusQuery";
// FE-003-T06 -- a standalone loader so it can also be called early, on
// hover/focus of the launcher button below, giving the chunk a head start
// before the user actually clicks (webpack's import() cache makes the
// later, real load a no-op if it already resolved).
const loadSiaPanel = () => import(/* webpackChunkName: "sia" */ "./SiaPanel");
const SiaPanel = React.lazy(loadSiaPanel);

// M4-3: CRA only embeds env vars prefixed REACT_APP_ at build time. Checked
function isSiaEnabled() {
  return process.env.REACT_APP_SIA_ENABLED === "true";
}

// M4-3 scaffold, M4-4 integration, Batch 3C conversation ownership.
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
  const statusQuery = useSiaStatusQuery(isSiaEnabled());
  const isCheckingAvailability = statusQuery.isLoading || statusQuery.isFetching;
  // Fail closed: anything other than an unambiguous success/available pair
  const isSiaAvailable = statusQuery.isSuccess && isSiaAvailableResponse(statusQuery.data);
  // Mirrors SiaPanel.js's OWN blockedByAvailability computation exactly
  const isAvailabilityKnown = isSiaAvailable !== undefined || isCheckingAvailability !== undefined;
  const blockedByAvailability = isAvailabilityKnown && (isCheckingAvailability === true || isSiaAvailable !== true);

  // Batch 3G: an explicit, monotonically increasing contextual-launch focus
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);

  // Batch 3G remediation: SiaPanel unmounts entirely on close (see above),
  const lastHandledFocusRequestVersionRef = useRef(0);

  // Focus can only move to the launcher AFTER it has been re-rendered, so
  useEffect(() => {
    if (!isOpen && shouldRefocusLauncher.current && launcherRef.current) {
      launcherRef.current.focus();
      shouldRefocusLauncher.current = false;
    }
  }, [isOpen]);

  // Batch 3G contextual-launcher contract (see SiaLauncherContext.js for
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
        <Suspense fallback={<div className="sia-panel-loading" role="status" aria-live="polite">Loading…</div>}>
          <SiaPanel
            onClose={handleClose}
            conversation={conversation}
            // The launcher itself is never hidden by backend unavailability
            isAvailable={isSiaAvailable}
            isCheckingAvailability={isCheckingAvailability}
            // FE-001-T08 -- previously SiaPanel had no way to tell a genuine
            // status-query failure apart from a clean "available: false"
            // response; both collapsed into the same "unavailable" copy.
            // Fail-closed behavior (blockedByAvailability) is unchanged --
            // this only lets the panel pick more accurate wording.
            isAvailabilityError={statusQuery.isError}
            onRetryAvailability={statusQuery.refetch}
            focusRequestVersion={focusRequestVersion}
            lastHandledFocusRequestVersionRef={lastHandledFocusRequestVersionRef}
            // Workstream 3: GET /sia/status's additive
            voiceCapabilities={statusQuery.data?.capabilities?.voiceInput}
          />
        </Suspense>
      ) : !hideLauncher ? (
        <button
          type="button"
          className="sia-entry-point"
          onClick={handleOpen}
          onMouseEnter={loadSiaPanel}
          onFocus={loadSiaPanel}
          onTouchStart={loadSiaPanel}
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

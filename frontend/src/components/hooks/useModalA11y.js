import { useEffect, useRef } from "react";

// Shared accessibility behavior for overlay-style confirmation/edit dialogs
// (DeleteAlert, SaveRuleAlert, IncomeModal, the budget-edit and custom-date
// -range overlays, etc). These were plain divs with no dialog semantics at
// all: a screen reader announced them as ordinary page content, Tab could
// leave the dialog into the (still-focused, still-interactive) page behind
// it, and there was no way to dismiss one with Escape. This hook is the
// fix, applied uniformly instead of copy-pasted into each modal:
//   - moves focus into the dialog when it opens
//   - traps Tab/Shift+Tab focus within the dialog while it's open
//   - closes on Escape
//   - restores focus to whatever triggered the dialog when it closes
// `active` lets a component that already computes an isOpen-like flag pass
// it straight through instead of conditionally rendering around the hook
// call (hooks can't be called conditionally).
export function useModalA11y(dialogRef, onClose, active = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const dialogNode = dialogRef.current;
    const previouslyFocused = document.activeElement;

    const getFocusable = () => {
      if (!dialogNode) return [];
      return Array.from(
        dialogNode.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    };

    const initialFocusTarget = getFocusable()[0] || dialogNode;
    initialFocusTarget?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;

      const focusables = getFocusable();
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active, dialogRef]);
}

import { useEffect, useRef } from "react";

// Shared accessibility behavior for overlay-style confirmation/edit dialogs (DeleteAlert, SaveRuleAlert, IncomeModal, the budget-edit and custom-date -range overlays, etc).
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

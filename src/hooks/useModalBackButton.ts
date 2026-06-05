import { useEffect, useRef } from "react";

/**
 * Intercepts the browser/OS back button while a modal is open and calls
 * onClose instead of navigating away.
 *
 * Usage patterns:
 *
 *   1. Modal is conditionally rendered (the common case):
 *
 *        {isOpen && <Modal onClose={...}>...</Modal>}
 *        // inside Modal:
 *        useModalBackButton(onClose);
 *
 *      The hook mounts when the modal opens and unmounts when it closes —
 *      no enabled flag needed.
 *
 *   2. Modal component is always rendered, visibility gated by `isOpen`:
 *
 *        // inside Modal:
 *        useModalBackButton(onClose, isOpen);
 *        if (!isOpen) return null;
 *
 *      Pass `isOpen` as the second arg so the hook only pushes a phantom
 *      history entry when the modal is actually visible. Without this,
 *      every always-rendered modal silently consumes one back-press on
 *      page mount.
 */
// ── Shared modal stack ───────────────────────────────────────────────────────
// Modals can nest (e.g. the "How posts work" help opens on top of the News
// panel). History-based back interception has to be stack-aware or the layers
// stomp each other:
//
//   • Only the TOP modal reacts to a real back-press (inner closes first).
//   • When a modal closes via its X / scrim, its cleanup pops the phantom
//     entry with history.back(). That emits a popstate an OUTER modal would
//     otherwise mistake for a user back-press and close on. `suppressNextPop`
//     marks that single programmatic pop so the outer layer ignores it.
//
// The ids are per-mounted-instance; the array is module-global on purpose.
const modalStack: symbol[] = [];
let suppressNextPop = false;

export function useModalBackButton(onClose: () => void, enabled: boolean = true) {
  const onCloseRef = useRef(onClose);

  // Keep the ref current without touching it during render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;

    const id = Symbol("modal");
    modalStack.push(id);

    // Push a phantom entry so back has something to pop.
    window.history.pushState({ modal: true }, "");

    // Spurious popstate guard: Next.js / React may fire popstate during their
    // own history churn on mount. Until things settle we re-push instead of
    // treating it as a user back-press.
    let settled = false;
    const settleId = setTimeout(() => {
      settled = true;
    }, 100); // 100ms is long enough for any framework-level history churn

    // Set when WE close via the back button, so cleanup knows the phantom was
    // already popped by the navigation and must NOT history.back() again
    // (doing so would pop an outer modal's phantom).
    let closedByBack = false;

    const handlePopState = (e: PopStateEvent) => {
      // Only the topmost modal handles a pop. Outer layers bail without
      // stopping propagation so the event reaches the top modal's listener.
      if (modalStack[modalStack.length - 1] !== id) return;

      // Top modal owns this event — stop Next.js's bubble-phase navigation.
      e.stopImmediatePropagation();

      // A programmatic pop from an inner modal's cleanup — not a user action.
      if (suppressNextPop) {
        suppressNextPop = false;
        return;
      }

      if (!settled) {
        // Spurious popstate during mount — re-push so the intercept holds.
        window.history.pushState({ modal: true }, "");
        return;
      }

      // Real user back-press — close this (topmost) modal.
      closedByBack = true;
      onCloseRef.current();
    };

    // capture: true ensures we run before Next.js's bubble-phase listener.
    window.addEventListener("popstate", handlePopState, { capture: true });

    return () => {
      clearTimeout(settleId);
      window.removeEventListener("popstate", handlePopState, { capture: true });
      const idx = modalStack.lastIndexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);

      // Closed by X / scrim (not the back button): the phantom entry is still
      // in history, so pop it. If another modal is still open underneath, flag
      // the resulting popstate as programmatic so it doesn't close that one.
      if (!closedByBack && window.history.state?.modal) {
        if (modalStack.length > 0) suppressNextPop = true;
        window.history.back();
      }
    };
  }, [enabled]); // re-run when the modal toggles open/closed
}

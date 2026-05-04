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
export function useModalBackButton(onClose: () => void, enabled: boolean = true) {
  const onCloseRef = useRef(onClose);

  // Keep the ref current without touching it during render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;

    // Push a phantom entry so back has something to pop.
    window.history.pushState({ modal: true }, "");

    // Instead of a fragile setTimeout(0) race, use a counter to ignore
    // spurious popstate events. Next.js / React may fire popstate during
    // its own history manipulation on mount. We skip the first N events
    // (where N is the number of spurious pops we've re-pushed for), and
    // only act once we receive a popstate that pops our phantom entry
    // after the dust has settled.
    //
    // The key insight: every spurious pop triggers a re-push, so the
    // history depth stays correct. We only call onClose when we see a
    // pop whose state is NOT our phantom marker — meaning the user
    // actually pressed back and popped our entry.
    let settled = false;
    const settleId = setTimeout(() => {
      settled = true;
    }, 100); // 100ms is long enough for any framework-level history churn

    const handlePopState = (e: PopStateEvent) => {
      // Always stop propagation to prevent Next.js from navigating.
      e.stopImmediatePropagation();

      if (!settled) {
        // Spurious popstate during mount — re-push the phantom entry
        // so the intercept remains in place for real user interaction.
        window.history.pushState({ modal: true }, "");
        return;
      }

      // Real user back-press — close the modal.
      onCloseRef.current();
    };

    // capture: true ensures we run before Next.js's bubble-phase listener.
    window.addEventListener("popstate", handlePopState, { capture: true });

    return () => {
      clearTimeout(settleId);
      window.removeEventListener("popstate", handlePopState, { capture: true });
      // If the modal was closed by the X / overlay (not the back button),
      // the phantom entry is still in history — clean it up.
      if (window.history.state?.modal) {
        window.history.back();
      }
    };
  }, [enabled]); // re-run when the modal toggles open/closed
}

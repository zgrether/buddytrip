import { useEffect, useRef } from "react";
import { pushMarker, isOwnPop } from "@/lib/historyMarker";

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

    // Push a phantom entry so back has something to pop. `myDepth` is what makes
    // the pop testable for ownership (historyMarker.ts) — the modal STACK alone
    // can't do it, because the stack only knows about modals, and the entry above
    // us may belong to the settings overlay, an in-page screen, the game panel, or
    // the tab sentinel.
    let myDepth = pushMarker("modal", { modal: true });

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
      // Consume the one-shot programmatic-pop marker FIRST, whoever we are: it was
      // set for exactly this pop, and if an ownership check below returns early it
      // would otherwise stay latched and swallow the NEXT real back-press.
      const wasProgrammatic = suppressNextPop;
      if (wasProgrammatic) suppressNextPop = false;

      // Only the topmost modal handles a pop. Outer layers bail without
      // stopping propagation so the event reaches the top modal's listener.
      if (modalStack[modalStack.length - 1] !== id) return;

      // Not our entry — something ABOVE this modal was popped (an in-page screen,
      // the settings overlay, the game panel, or the tab sentinel). Return WITHOUT
      // stopping propagation so the real owner still hears it. This has to come
      // before stopImmediatePropagation, or a foreign pop dies here.
      //
      // Depth now also covers what `suppressNextPop` was invented for — an inner
      // modal's cleanup pops its OWN entry, and we land on ours, which reads as
      // not-our-pop. The flag is kept as the belt to that suspenders, since it
      // also covers a programmatic pop of an entry we never tagged.
      if (!isOwnPop(e, myDepth)) return;

      // Top modal owns this event — stop Next.js's bubble-phase navigation.
      e.stopImmediatePropagation();

      // A programmatic pop from an inner modal's cleanup — not a user action.
      // Our own phantom is untouched (the inner one was popped), so do NOT
      // re-push: that would leave this modal holding two entries and needing two
      // back-presses to close.
      if (wasProgrammatic) return;

      if (!settled) {
        // Spurious popstate during mount — re-push so the intercept holds. This IS
        // a new entry, so re-claim a depth for it.
        myDepth = pushMarker("modal", { modal: true });
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

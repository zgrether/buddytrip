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

/**
 * Should unmount pop the phantom history entry?
 *
 * Extracted from the cleanup so the branch is reachable without a DOM — this
 * suite is `environment: "node"`, so the hook can never be mounted, and the one
 * condition with a real failure mode was therefore untestable. It is not a
 * description of the cleanup; the cleanup CALLS it.
 *
 * Three ways the phantom is already gone, and popping again would eat an entry
 * that belongs to something else:
 *  - `closedByBack` — the back-press that closed us popped it.
 *  - `consumed` — the caller navigated over it (see `consumeMarker`).
 *  - the current entry isn't ours — `state.modal` is how we know it still is.
 */
export function shouldPopPhantom(o: {
  closedByBack: boolean;
  consumed: boolean;
  historyState: unknown;
}): boolean {
  if (o.closedByBack || o.consumed) return false;
  return (o.historyState as { modal?: boolean } | null | undefined)?.modal === true;
}

export function useModalBackButton(onClose: () => void, enabled: boolean = true) {
  const onCloseRef = useRef(onClose);
  // Set by `consumeMarker` — see the return value below.
  const consumedRef = useRef(false);

  // Keep the ref current without touching it during render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;

    const id = Symbol("modal");
    modalStack.push(id);
    consumedRef.current = false;

    // Push a phantom entry so back has something to pop. `myDepth` is what makes
    // the pop testable for ownership (historyMarker.ts) — the modal STACK alone
    // can't do it, because the stack only knows about modals, and the entry above
    // us may belong to the settings overlay, an in-page screen, the game panel, or
    // the tab sentinel.
    let myDepth = pushMarker("modal", { modal: true });

    // Spurious popstate guard: Next.js / React may fire popstate during their
    // own history churn on mount. Until things settle we re-push instead of
    // treating it as a user back-press.
    //
    // Tied to two animation frames rather than a wall-clock guess (was
    // `setTimeout(..., 100)`). Genuine mount-time churn is synchronous JS
    // work and resolves within a frame or two; 100ms turned out to be long
    // enough for a FAST real back-press (an automated one especially — no
    // human hesitation between actions) to land inside the window and get
    // mistaken for churn, which SWALLOWS it: the branch below re-pushes the
    // phantom instead of closing, and since the caller only ever issues one
    // back-press, nothing closes the modal afterward (confirmed: the exact
    // failure signature of e2e/chat-action.spec.ts's mobile back-close case,
    // reproduced identically on `main` pre-dating this fix — a real bug, not
    // test flake). Two rAFs still comfortably outlasts synchronous churn
    // while cutting the collision window roughly 3x versus the fixed timer.
    let settled = false;
    let settleFrame1 = 0;
    let settleFrame2 = 0;
    settleFrame1 = requestAnimationFrame(() => {
      settleFrame2 = requestAnimationFrame(() => {
        settled = true;
      });
    });

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
      cancelAnimationFrame(settleFrame1);
      cancelAnimationFrame(settleFrame2);
      window.removeEventListener("popstate", handlePopState, { capture: true });
      const idx = modalStack.lastIndexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);

      // Closed by X / scrim (not the back button): the phantom entry is still
      // in history, so pop it. If another modal is still open underneath, flag
      // the resulting popstate as programmatic so it doesn't close that one.
      //
      // `consumedRef` opts out: the caller navigated over the phantom instead of
      // dismissing it, so there is nothing left to pop — see `consumeMarker`.
      if (shouldPopPhantom({ closedByBack, consumed: consumedRef.current, historyState: window.history.state })) {
        if (modalStack.length > 0) suppressNextPop = true;
        window.history.back();
      }
    };
  }, [enabled]); // re-run when the modal toggles open/closed

  return {
    /**
     * Hand the phantom entry over to a navigation, so cleanup does NOT pop it.
     *
     * A modal whose action LEAVES the page is not the same as one that closes.
     * Closing pops the phantom to get back where you were; navigating wants the
     * destination to take the phantom's slot. Doing both is the bug this exists
     * to prevent — unmounting the modal runs this cleanup, whose
     * `history.back()` races the router and can undo the navigation before it
     * commits, so the button reads as doing nothing at all.
     *
     * The `window.history.state?.modal` guard alone is NOT enough: it is only
     * false once the router has actually written its own history entry, and in
     * the App Router that happens asynchronously, after the RSC payload for the
     * destination resolves. React unmounts the modal in the same commit as the
     * state update that hid it — long before.
     *
     * **The caller must REPLACE, not push.** `consumeMarker()` leaves the
     * phantom in place; `router.replace` then overwrites it, so back from the
     * destination lands where the modal was opened from. A push would strand
     * the phantom as a dead entry costing an extra back-press.
     */
    consumeMarker: () => {
      consumedRef.current = true;
    },
  };
}

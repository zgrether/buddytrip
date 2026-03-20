import { useEffect, useRef } from "react";

/**
 * Intercepts the browser/OS back button while a modal is open and calls
 * onClose instead of navigating away.
 *
 * Usage: call this hook at the top of any full-screen modal component.
 * Because modals are conditionally rendered, the hook mounts when the modal
 * opens and unmounts when it closes — no `isOpen` parameter needed.
 */
export function useModalBackButton(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Push a phantom entry so back has something to pop.
    window.history.pushState({ modal: true }, "");

    // Defer activation to ignore any spurious popstate Next.js fires during
    // its own history manipulation on mount.
    let active = false;
    const activateId = setTimeout(() => {
      active = true;
    }, 0);

    const handlePopState = (e: PopStateEvent) => {
      // Use capture phase (registered below) so we run before Next.js's own
      // popstate listener. stopImmediatePropagation prevents Next.js from
      // treating this as a navigation event.
      e.stopImmediatePropagation();

      if (active) {
        onCloseRef.current();
      } else {
        // Spurious popstate on mount — re-push the phantom entry so the
        // intercept remains in place when the user presses back for real.
        window.history.pushState({ modal: true }, "");
      }
    };

    // capture: true ensures we run before Next.js's bubble-phase listener.
    window.addEventListener("popstate", handlePopState, { capture: true });

    return () => {
      clearTimeout(activateId);
      window.removeEventListener("popstate", handlePopState, { capture: true });
      // If the modal was closed by the X / overlay (not the back button),
      // the phantom entry is still in history — clean it up.
      if (window.history.state?.modal) {
        window.history.back();
      }
    };
  }, []); // intentionally empty — only runs on mount/unmount
}

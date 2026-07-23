"use client";

import { useEffect } from "react";

/**
 * Registers the deliberately-minimal service worker (public/sw.js — PWA
 * Phase 1). Production-only: in dev a registered SW outlives the dev
 * server and confuses HMR sessions, and there's nothing to test — the
 * SW has no behavior beyond existing so push can attach later.
 *
 * Renders nothing; mounted once from Providers.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the app is fully functional without the SW, and a
      // registration error isn't actionable by the user.
    });
  }, []);

  return null;
}

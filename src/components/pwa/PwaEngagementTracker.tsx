"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ENGAGE_DELAY_MS, markEngaged } from "@/lib/pwaInstall";

/**
 * Marks the session "engaged" once the user has actually used the app — a
 * navigation, or ~30s dwell (PWA install follow-up). This is the in-session
 * engagement gate the install banner (and the beforeinstallprompt capture
 * script) key off, replacing return-visit counting: a first-time invited
 * member at peak motivation shouldn't be asked to come back N times, but we
 * still don't ambush someone who just landed.
 *
 * Mounted once at app root (Providers), on every route. Renders nothing.
 * markEngaged() is idempotent, so the timer and nav paths can both fire.
 */
export function PwaEngagementTracker() {
  const pathname = usePathname();
  const first = useRef(true);

  // ~30s dwell in this session → engaged.
  useEffect(() => {
    const t = setTimeout(() => markEngaged(), ENGAGE_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // Any navigation after the initial render → engaged (they're using the app).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    markEngaged();
  }, [pathname]);

  return null;
}

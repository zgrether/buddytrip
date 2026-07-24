"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ENGAGE_DELAY_MS, markEngaged } from "@/lib/pwaInstall";

/**
 * Marks the user "engaged" once they've actually used the app — a navigation,
 * or ~30s dwell (PWA install follow-up). markEngaged persists the flag
 * (localStorage), so this only needs to fire once ever; the banner and the
 * beforeinstallprompt capture script both key off it. Replaces return-visit
 * counting: a first-time invited member at peak motivation shouldn't be asked
 * to come back N times, but we still don't ambush someone who just landed and
 * hasn't done anything yet.
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

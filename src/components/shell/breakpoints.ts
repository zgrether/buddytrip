"use client";

import { useEffect, useState } from "react";

/**
 * The shell's two desktop breakpoints, and why they are where they are.
 *
 * The mockup is drawn at a 980px frame and doesn't answer this — it's a Phase 5
 * decision. Both numbers are derived from the widths the layout actually needs,
 * not from taste:
 *
 * ── SHELL (1024px / Tailwind `lg`) — rail + tab strip ────────────────────────
 * The rail is 246px. Below ~1024 the remaining content column drops under
 * ~700px, at which point the trip grids fall back to one column anyway and the
 * rail is costing more than it gives. At 1024 content gets ~760px, which is a
 * genuine two-column surface.
 *
 * ── CHAT COLUMN (1280px / Tailwind `xl`) — chat beside the content ───────────
 * The chat column is a fixed 340px. At 1024 that would leave the main column
 * ~400px — narrower than the phone layout it replaced, and too tight for the
 * leaderboard's team rows and game rows. 1280 leaves ~1010px, so the board gets
 * ~630px alongside chat's 340px and both are usable.
 *
 * BELOW 1280, Chat stays a full-width TAB even though the rail is showing. That
 * is deliberate: a cramped side-by-side is worse than a good full-width surface,
 * and it keeps one behaviour ("chat replaces the content") rather than three.
 *
 * ── These drive DATA, not TREES ──────────────────────────────────────────────
 * Layout itself is CSS (`lg:` / `xl:` classes) on ONE tree, so resizing across a
 * breakpoint reflows without unmounting anything — no lost scroll, no refetch,
 * no remount. This hook exists only for things CSS cannot express: whether to
 * ENABLE a query, and which view the main column should show while Chat occupies
 * the side. Using it to pick between two trees would reintroduce the remount.
 */
export const SHELL_DESKTOP_PX = 1024;
export const CHAT_COLUMN_PX = 1280;

function useMediaMin(px: number): boolean {
  // False on the server and on the first client render, so hydration matches;
  // the effect corrects it before paint-relevant work.
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return matches;
}

/** Rail + tab strip are showing. */
export const useIsShellDesktop = () => useMediaMin(SHELL_DESKTOP_PX);

/** Chat renders as a side column rather than replacing the content. */
export const useIsChatColumn = () => useMediaMin(CHAT_COLUMN_PX);

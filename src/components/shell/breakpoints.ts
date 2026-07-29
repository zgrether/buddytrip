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

/**
 * ── Cup two-column geometry — the ONE numeric source ─────────────────────────
 *
 * Score entry is a DESIGNED interface at a fixed 412px (the Pixel 7 Pro viewport
 * and the supported mobile floor — see STYLE_GUIDE.md §Widths). It does not
 * stretch at any viewport. The scoreboard column absorbs the difference by
 * flexing between 380 and 560, so there is no cliff where a few pixels cost the
 * whole second column, and nothing grows to fill: leftover space is margin.
 *
 * Two columns therefore need `380 + 16 + 412 = 808` of CONTENT width.
 *
 * ── Why content width and not a viewport breakpoint ──────────────────────────
 * A viewport number would have to bake in the rail (246) and the stage padding
 * (32), and it would then be wrong the moment either changes — the mockup's own
 * ~1046 figure assumes a 206px rail and is 40px optimistic against this codebase.
 * Measuring the space the columns actually get is rail-independent and can't
 * drift. It is expressed as a CONTAINER query on the stage, so CSS and JS read
 * the same number from here rather than each carrying their own copy — two
 * sources for one threshold is the exact class of bug that produced the double
 * scrollbar (#752) and the two-pane disagreement before it.
 */
export const ENTRY_COL_PX = 412;
export const CUP_MAIN_MIN_PX = 380;
export const CUP_MAIN_MAX_PX = 560;
export const CUP_COL_GAP_PX = 16;
/** Content width at which the entry column can sit BESIDE the scoreboard. */
export const CUP_TWO_COL_PX = CUP_MAIN_MIN_PX + CUP_COL_GAP_PX + ENTRY_COL_PX; // 808

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

/**
 * Where the Chat surface mounts, given the current view and viewport. Pulled
 * out of `AppShell`'s render so the "exactly one location, never both, never
 * neither-when-active" contract is a pure function AppShell actually calls
 * (not logic re-derived in a test, which can drift from the real thing).
 *
 * The historical bug this guards: rendering Chat both inline AND in the
 * aside at once didn't just double-paint it — the aside's floating panel is
 * `position: fixed`, so an "invisible" duplicate still sat over the whole
 * app and swallowed every click, breaking four merge-blocking E2E specs.
 */
export type ChatMountLocation = "inline" | "aside" | "none";

export function chatMountLocation(
  effectiveView: "home" | "trip" | "cup" | "chat",
  chatIsColumn: boolean
): ChatMountLocation {
  if (effectiveView !== "chat") return "none";
  return chatIsColumn ? "aside" : "inline";
}

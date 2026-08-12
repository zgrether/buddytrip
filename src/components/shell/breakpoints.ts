"use client";

import { useEffect, useState } from "react";

/**
 * The shell's two desktop breakpoints, and why they are where they are.
 *
 * The mockup is drawn at a 980px frame and doesn't answer this — it's a Phase 5
 * decision. Both numbers are derived from the widths the layout actually needs,
 * not from taste:
 *
 * ── SHELL (1024px / Tailwind `lg`) — rail + top-bar tabs ─────────────────────
 * The rail was a flat 246px when this was derived. Below ~1024 the remaining content column
 * drops under ~700px, at which point the trip grids fall back to one column
 * anyway and the rail is costing more than it gives. At 1024 content gets
 * ~760px, which is a genuine two-column surface.
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
 * `RAIL_WIDTH_PX` USED TO LIVE HERE, and its removal is the point.
 *
 * It was introduced as "the ONE numeric source" for the rail's width, because
 * `TopNav`'s Trip/Cup tabs align to the rail's right edge and two hand-typed
 * `246`s would drift. The reasoning was right and the mechanism outlived it: the
 * rail's width became STATEFUL (a 62px strip plus a collapsible, draggable
 * column), and a constant cannot be the source of a number that changes at
 * runtime. `ContextRail` publishes `--bt-rail-width` and `TopNav` reads it; the
 * first-paint fallback is composed from `RAIL_STRIP_PX + RAIL_DEFAULT_PX` in
 * `rail/useRailWidth.ts`, which is where the rail's own numbers now live.
 *
 * Leaving the constant here would have recreated exactly the bug it was written
 * to prevent — a second 246, in a file whose comment claimed it was the
 * alignment source, that nothing aligned to any more.
 */

/**
 * ── The Cup two-column geometry USED TO LIVE HERE, and its removal is the fix ─
 *
 * Five constants — `ENTRY_COL_PX` (412), `CUP_MAIN_MIN_PX` (380),
 * `CUP_MAIN_MAX_PX` (560), `CUP_COL_GAP_PX` (16) and their sum
 * `CUP_TWO_COL_PX` (808) — described a layout where a fixed score-entry column
 * sat BESIDE the scoreboard, and this block called them "the ONE numeric
 * source" for it.
 *
 * There was no second column. A later change made the board `lg:hidden` the
 * moment a game opens ("drill-in REPLACES"), so Cup has been a single column
 * for some time; `CompetitionFace`'s own header comment still claimed
 * "DESKTOP MASTER–DETAIL … lg+ splits into [board | pane]" and was simply
 * false. All five constants had ZERO consumers, and the `@[808px]` container
 * query they justified appeared exactly once, where it set a `min-width` on the
 * single panel.
 *
 * The cost was not the dead code. It was that the 560 cap on both the board and
 * the game panel existed to leave room for a column that never arrives — so Cup
 * refused to use the width it had, while Trip beside it filled the content area.
 * That is the "Cup is stuck at 560" symptom, and it had a reason that had
 * stopped being true.
 *
 * If a two-column Cup is wanted again, rebuild it deliberately against whatever
 * the layout is then — do not restore these numbers on the strength of this
 * comment.
 */

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

/**
 * Chat renders as a persistent side column rather than a bottom sheet.
 *
 * Chat is an independent overlay (Phase 6), not a view, so this is the ONLY
 * thing that decides its placement — never gated on which tab is selected.
 * Below this breakpoint chat is a resizable sheet (`ChatSheet`) regardless of
 * which of the rail/tab-strip chrome is showing; the sheet and the aside
 * column are mutually exclusive by construction (`AppShell` renders exactly
 * one, chosen by this single boolean), so there is no width band where chat
 * is open but unreachable — the historical bug this replaces.
 */
export const useIsChatColumn = () => useMediaMin(CHAT_COLUMN_PX);

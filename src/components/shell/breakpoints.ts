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
 * ── CHAT COLUMN — now the SAME breakpoint, and that is the fix ───────────────
 * Chat's side column used to start at 1280 (`xl`) while the rail started at
 * 1024, on the reasoning that a fixed 340px column at 1024 would leave the main
 * column ~400px — too tight, and worse than a good full-width surface.
 *
 * That reasoning assumed a main column that could not give anything back. It
 * can now: the rail COLLAPSES to a 62px strip, so the space chat needs is
 * available at 1024 the moment the user wants it, and the desktop content area
 * is fluid rather than capped at a designed width.
 *
 * What the split actually produced was a 256px band where the rail, the tabs and
 * the whole desktop chrome were showing but chat still opened as a MOBILE bottom
 * sheet — one surface behaving as though it were on a phone while everything
 * around it had not been for 256px. Two breakpoints meant three behaviours; one
 * means two, which is what "desktop" and "mobile" were supposed to mean.
 *
 * So `CHAT_COLUMN_PX === SHELL_DESKTOP_PX`. They are kept as separate NAMES
 * because they answer different questions and a future split should be able to
 * re-diverge them without hunting call sites — but they are one number, defined
 * once, so they cannot drift apart by accident.
 *
 * ── These drive DATA, not TREES ──────────────────────────────────────────────
 * Layout itself is CSS (`lg:` / `xl:` classes) on ONE tree, so resizing across a
 * breakpoint reflows without unmounting anything — no lost scroll, no refetch,
 * no remount. This hook exists only for things CSS cannot express: whether to
 * ENABLE a query, and which view the main column should show while Chat occupies
 * the side. Using it to pick between two trees would reintroduce the remount.
 */
export const SHELL_DESKTOP_PX = 1024;
export const CHAT_COLUMN_PX = SHELL_DESKTOP_PX;

/**
 * ── The rail YIELDS BEFORE CHAT ─────────────────────────────────────────────
 *
 * Below this width the rail's list column is suppressed and only the 62px strip
 * remains, whatever width the user last dragged. Chat's column holds all the way
 * down to `SHELL_DESKTOP_PX`, so as the viewport narrows the order is:
 *
 *   ≥1330   rail (as dragged) + chat column
 *   1024..  rail STRIP only    + chat column
 *   <1024   no rail            + chat as a sheet
 *
 * The priority is a judgement — leaderboard-plus-chat beats
 * leaderboard-plus-rail, because you are watching scores and talking about them
 * while the rail is navigation you have already used — but the number is
 * derived. Chat's column is 340 and the content inset is 24 a side with a 24
 * gutter between the two columns, so with a full 358px rail the content column
 * gets `W − 358 − 48 − 340 − 24`. Asking for at least 560px of content (the
 * width the board was designed against) gives:
 *
 *     560 + 358 + 48 + 340 + 24 = 1330
 *
 * Below that, keeping the rail open costs more than it gives. For scale: at
 * 1024 with a full rail the content column would be **254px** — narrower than a
 * phone — while collapsing the rail leaves **550px**. So this is not only an
 * ordering preference; it is what makes chat-at-1024 viable at all, and #906
 * moving chat down to the rail's breakpoint is what created the need for it.
 *
 * 1330 is DEVICE-PENDING: the 560px content floor is the board's design width,
 * not a measured comfort threshold.
 */
export const RAIL_YIELD_PX = 1330;

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
 * There is room for the rail's LIST column, not just its strip.
 *
 * Read for the two things CSS cannot express on its own — the toggle button's
 * label/icon, and whether a strip entry paints as selected — so that a rail
 * suppressed by width reads the same as one collapsed by the button. The
 * suppression ITSELF is CSS (`ContextRail`), deliberately: it must not write to
 * the stored width, or narrowing the window once would silently overwrite the
 * width the user dragged and widening would never bring it back.
 */
export const useHasRailRoom = () => useMediaMin(RAIL_YIELD_PX);

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

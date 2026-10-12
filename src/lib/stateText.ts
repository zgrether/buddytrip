import type { CSSProperties } from "react";

/**
 * THE TWO STATE STYLES, in one place (Zach, 2026-10-12, on #1607's look).
 *
 * State is shown by STYLING, not by words: a result still in play and a result
 * that's settled read the same words ("2 UP thru 7" / "Won 3&2") in two
 * different looks, so no "Underway" or "F" is needed to say which is which.
 *
 *  - LIVE: primary text, semibold — still moving;
 *  - SETTLED: the green FINAL and HALVED already wear, regular weight — done.
 *
 * NEVER COLOUR ALONE. The weight changes with the colour, so the two states stay
 * apart for a reader who can't tell the green from the white (and in a
 * screenshot that loses the colour).
 *
 * Every surface that shows a live-or-settled result reads these. The match
 * card's and the Matches scoreboard's FINAL headers take `SETTLED_COLOR` for
 * their green: they are 10px capital labels with their own type ramp, not result
 * lines, so they keep their weight and share the colour.
 */
export const SETTLED_COLOR = "var(--color-bt-place-1-text)";

export const LIVE_TEXT: CSSProperties = { color: "var(--color-bt-text)", fontWeight: 600 };
export const SETTLED_TEXT: CSSProperties = { color: SETTLED_COLOR, fontWeight: 400 };

export const stateText = (settled: boolean): CSSProperties => (settled ? SETTLED_TEXT : LIVE_TEXT);

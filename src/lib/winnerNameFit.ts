import { WINNER_NAME_FLOOR_PX, WINNER_NAME_PX } from "./teamTextColor";

/**
 * How a WINNING name at a Final fits its column (#1703, Zach).
 *
 * It starts at 20px bold. If its longest single WORD is wider than the column, the
 * size drops just enough for that word to fit, but never below 14pt bold
 * (`WINNER_NAME_FLOOR_PX`), so the name stays large text and its bar stays 3 : 1.
 * A word still too wide at the floor breaks wherever it must (`breakAnywhere`)
 * rather than being cut off. No hyphenation: that depends on the name's language,
 * and a team name has none we can know.
 *
 * The WORD decides, not the whole name: the name wraps at its spaces, so only a
 * word wider than the column can overflow it.
 *
 * Pure, so the floor and the fallback are tested without a layout engine. The
 * measuring half lives in `useWinnerNameFit`.
 */
export interface WinnerNameFit {
  size: number;
  breakAnywhere: boolean;
}

/** Room left for rounding between the measured width and the laid-out one. */
export const FIT_SLACK_PX = 1;

export function winnerNameFit(
  /** The widest word of the name, measured at `WINNER_NAME_PX` bold. */
  longestWordPx: number,
  /** The column the name sits in, in px. */
  columnPx: number,
): WinnerNameFit {
  const room = columnPx - FIT_SLACK_PX;
  if (longestWordPx <= room) return { size: WINNER_NAME_PX, breakAnywhere: false };
  // Text width scales with font size, so this is the size at which the word fits.
  const size = Math.floor(((WINNER_NAME_PX * room) / longestWordPx) * 100) / 100;
  if (size >= WINNER_NAME_FLOOR_PX) return { size, breakAnywhere: false };
  return { size: WINNER_NAME_FLOOR_PX, breakAnywhere: true };
}

/** The size and wrap a fit sets on the name: the one place a fit becomes style. */
export function winnerNameStyle(fit: WinnerNameFit): { fontSize: number; overflowWrap?: "anywhere" } {
  return fit.breakAnywhere ? { fontSize: fit.size, overflowWrap: "anywhere" } : { fontSize: fit.size };
}

/** A name's words, split where the browser may wrap it: at whitespace. */
export function nameWords(name: string): string[] {
  return name.split(/\s+/).filter((w) => w.length > 0);
}

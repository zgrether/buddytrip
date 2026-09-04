/**
 * nameLadder — how a player's name is made to fit, stated once.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * A name steps DOWN until it fits, and the steps are applied PER NAME rather
 * than per card, so only the name that does not fit is affected:
 *
 *   1. Full name at the surface's base size.
 *   2. Full name one step smaller — 14, the size the rack group tiles already
 *      use (`RackGroupBuilder.tsx`), so this is an existing precedent rather
 *      than a new size.
 *   3. Initial + surname, as the floor. "Julie Ann Hackett" → "J. Hackett".
 *
 * Truncation should not be reachable for a realistic name once this is applied.
 * Callers keep an ellipsis as a backstop; it should never fire.
 *
 * ── Discrete steps, NOT a computed fit ─────────────────────────────────────
 *
 * The step is chosen from the name's LENGTH, and every name of a given length
 * gets the same answer. It is not measured, not fitted, and not continuous — a
 * slot whose text size depends on measuring one person's name makes the layout
 * unpredictable, and this repo has already rejected that once for team names.
 *
 * This IS what `MatchCard.tsx` already did for 1v1 (`len > 16 ? 13 : len > 12 ?
 * 15 : 17`) — the ladder existed, in one branch, and the 2v2 path never got it.
 * This module is that branch generalised, not a new idea.
 *
 * ── Why length and not measurement ─────────────────────────────────────────
 *
 * There is no layout engine available where this is decided (the render path is
 * SSR, and the test harness is `renderToStaticMarkup`). Measuring would mean a
 * post-layout effect and a reflow on every name, which is the continuous-fit
 * approach this deliberately avoids. So the thresholds are CALIBRATED
 * APPROXIMATIONS, tuned against the narrowest slot in the app — a match card's
 * name cell at 375 px, which is roughly 130 px of text.
 *
 * They are exported so they can be moved after someone looks at a real phone,
 * which is the only way to tell whether they are right.
 */

/** Longest name that fits at a surface's BASE size in the narrowest slot. */
export const STEP_1_MAX = 13;

/** Longest name that fits at `STEP_2_SIZE`. Beyond this, abbreviate. */
export const STEP_2_MAX = 20;

/** The one step-down size. The rack group tile's existing size, deliberately —
 *  a second bespoke size is how surfaces drift apart. */
export const STEP_2_SIZE = 14;

export type NameLadderStep = 1 | 2 | 3;

export interface FittedName {
  /** What to render. Equals the input at steps 1 and 2. */
  text: string;
  /** The size to render it at. */
  fontSize: number;
  /** Which rung was used — the assertable part. See the note on testing below. */
  step: NameLadderStep;
}

/**
 * "Julie Ann Hackett" → "J. Hackett". First initial plus the LAST token, so a
 * middle name is dropped rather than kept — a middle name is the cheapest thing
 * on the row to lose and the surname is what people are called by.
 *
 * A single-token name ("Cher") has nothing to abbreviate and is returned
 * unchanged; the caller still gets `step: 3`, because the ladder DID reach its
 * floor even though the floor happened to be the name itself. Reporting step 2
 * there would say "this fits at 14" about a name that may not.
 */
export function initialSurname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  const first = parts[0];
  const last = parts[parts.length - 1];
  // A first "name" that is already an initial ("J." / "J") must not become "J. .".
  const initial = first.replace(/\.$/, "").charAt(0).toUpperCase();
  return `${initial}. ${last}`;
}

/**
 * Pick the rung for one name.
 *
 * `baseSize` is the surface's own step-1 size — 17 on the match card and score
 * entry, 15 on the scorecard — because the ladder is one rule applied to three
 * surfaces, not one size imposed on them.
 *
 * Step 2 never makes a name BIGGER: a surface whose base is already at or below
 * `STEP_2_SIZE` keeps its base rather than growing on overflow, which would be
 * the opposite of stepping down.
 */
export function fitName(name: string, baseSize: number): FittedName {
  const full = (name ?? "").trim();
  const smaller = Math.min(baseSize, STEP_2_SIZE);

  if (full.length <= STEP_1_MAX) return { text: full, fontSize: baseSize, step: 1 };
  if (full.length <= STEP_2_MAX) return { text: full, fontSize: smaller, step: 2 };
  return { text: initialSurname(full), fontSize: smaller, step: 3 };
}

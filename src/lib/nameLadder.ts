/**
 * nameLadder — how a player's name is made to fit, stated once.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 *   1. Full name.
 *   2. Initial + surname — "Julie Ann Hackett" → "J. Hackett".
 *   3. The `truncate` ellipsis, as a backstop that should almost never fire.
 *
 * Applied PER NAME, so a long name beside a short one does not drag the short
 * one down.
 *
 * ── There is no size rung here any more, and that is the point ─────────────
 *
 * The first version had a middle rung that shrank the text. That work has moved
 * to CSS: each surface sizes its names with a `clamp()` keyed to the VIEWPORT,
 * exactly as `NAME_W` and `MARGIN_CHIP_W` already do. So the size question is
 * answered by how wide the screen is, and this module answers only the separate
 * question of whether the name still needs shortening.
 *
 * That split is what makes fitting viewport-INDEPENDENT: if the cell and the
 * font both scale with `vw`, then "does this name fit" stops being a pixel
 * comparison and becomes a RATIO — a width in `em` against a capacity in `em`.
 * A fixed pixel threshold can never have that property, which is why the first
 * two attempts were wrong on some phone or other whatever numbers they used.
 *
 * Keying the size to viewport is NOT the continuous scaling that was ruled out.
 * What was ruled out is scaling keyed to NAME LENGTH — a slot whose text size
 * depends on whose name is in it, so two cards side by side render differently
 * and nobody can predict either. Here every name on the screen is the same
 * size; only the screen changes it.
 *
 * ── Why character COUNT was the wrong unit, with the evidence ─────────────
 *
 * Measured in the app, at 14px, weight 600:
 *
 *   Bill Giesler     12 chars    81px    fits
 *   Brad Giesler     12 chars    93px    CUT
 *   Zach Grether     12 chars   100px    CUT
 *   JD Shumpert      11 chars   100px    CUT
 *
 * Same length, same rung, nineteen pixels apart — and an ELEVEN-character name
 * wider than a twelve. `l i t t` are half the width of `m w c h`. Sorted by
 * estimated width, the observed fits and cuts separate perfectly: everything
 * ≤84px fit, everything ≥91px was cut, no misordering. Sorted by length they
 * interleave. No length threshold can work; this is not a calibration problem.
 *
 * ── How wrong the estimate is, measured — and it is biased the SAFE way ───
 *
 * Summing per-character advances is what `measureText` does, so for a string
 * with no kerning pairs the estimate is EXACT — `Bill Giesler`, `Brad Giesler`,
 * `Matt Shelley`, `Bud Banks` all matched to 0.0px.
 *
 * But this stack DOES kern, which an earlier version of this comment claimed it
 * did not, on the strength of seven names that happened to contain no kerning
 * pairs. Measured across the real roster plus deliberate `Ta`/`Va` cases:
 *
 *     worst OVER-estimate    +3.4%   ("T. Varghese", "Toby Vance")
 *     worst UNDER-estimate   −0.5%   ("JD Shumpert")
 *
 * **Over-estimating is the safe direction** — it abbreviates a shade early,
 * where under-estimating truncates. The bias is strongly that way because
 * kerning only ever pulls glyphs closer, so a missed pair makes the estimate
 * too big, never too small. The −0.5% is rounding, not kerning.
 *
 * ── Where tolerance belongs, and where it does not ────────────────────────
 *
 * The capacity constants carry the margin, for two things: that −0.5% floor,
 * and CROSS-PLATFORM DRIFT — these advances came from one stack, and a device
 * resolving `-apple-system` to SF Pro or Roboto will differ by a few percent.
 *
 * Do NOT add slop to the summing. It is exact where it can be and conservative
 * where it cannot, and padding it would abbreviate names that fit.
 */

/**
 * Per-character advance width, in `em` — i.e. multiply by the font size in px
 * to get pixels. Sampled at 100px / weight 600 from the app's own stack and
 * divided by 100.
 *
 * Unlisted characters fall back to `n` (a mid-width lowercase letter), which is
 * the honest default for accented and non-Latin glyphs this table does not
 * cover — it will under-estimate wide CJK and over-estimate narrow marks, and
 * the backstop ellipsis is what catches those.
 */
const ADVANCE_EM: Record<string, number> = {
  a: 0.522, b: 0.603, c: 0.470, d: 0.603, e: 0.531, f: 0.345, g: 0.603,
  h: 0.582, i: 0.261, j: 0.261, k: 0.525, l: 0.261, m: 0.886, n: 0.583,
  o: 0.597, p: 0.603, q: 0.603, r: 0.370, s: 0.431, t: 0.361, u: 0.583,
  v: 0.507, w: 0.756, x: 0.501, y: 0.508, z: 0.464,
  A: 0.671, B: 0.604, C: 0.621, D: 0.717, E: 0.518, F: 0.502, G: 0.697,
  H: 0.735, I: 0.292, J: 0.396, K: 0.611, L: 0.489, M: 0.924, N: 0.767,
  O: 0.756, P: 0.584, Q: 0.756, R: 0.623, S: 0.544, T: 0.552, U: 0.703,
  V: 0.642, W: 0.966, X: 0.619, Y: 0.577, Z: 0.587,
  "0": 0.555, "1": 0.402, "2": 0.555, "3": 0.555, "4": 0.576, "5": 0.555,
  "6": 0.558, "7": 0.536, "8": 0.555, "9": 0.558,
  " ": 0.275, ".": 0.241, "'": 0.258, "-": 0.402,
};

const FALLBACK_EM = ADVANCE_EM.n;

/** A string's rendered width in `em`. Exact for the sampled stack (see above). */
export function estimateEm(text: string): number {
  let em = 0;
  for (const ch of text) em += ADVANCE_EM[ch] ?? FALLBACK_EM;
  return em;
}

/**
 * How many `em` of text each surface's name slot holds, with margin.
 *
 * Derived, not guessed: the match card's cell measures ~85px at a 375px
 * viewport and its font clamp resolves to ~13.9px there, so the true capacity
 * is ~6.1em. 6.0 is that, less ~2% for the cross-platform drift described
 * above.
 *
 * **This is the number to move after looking at a real phone.** It is tight for
 * the twelve-character `-ther` / `-lley` family (`Zach Grether` is 5.86em), so
 * lowering it starts abbreviating names that currently fit, and raising it
 * starts truncating them. That trade is the whole calibration.
 */
export const CARD_NAME_CAPACITY_EM = 6.0;

/** The scorecard's column is `clamp(92px, 25vw, 124px)` at a 15px base — ~6.2em
 *  at 375px, less the same margin. */
export const SCORECARD_NAME_CAPACITY_EM = 6.0;

/** Score entry gives the name most of a full-width row, so almost nothing needs
 *  shortening here. Generous on purpose: abbreviating where there is room is a
 *  loss of information for no gain. */
export const ENTRY_NAME_CAPACITY_EM = 11.0;

export type NameLadderStep = 1 | 2;

export interface FittedName {
  /** What to render. Equals the input at step 1. */
  text: string;
  /** Which rung — the assertable part, and deterministic. */
  step: NameLadderStep;
}

/**
 * "Julie Ann Hackett" → "J. Hackett". First initial plus the LAST token, so a
 * middle name is dropped rather than kept — a middle name is the cheapest thing
 * on the row to lose and the surname is what people are called by.
 *
 * A single-token name ("Cher") has nothing to abbreviate and is returned
 * unchanged.
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
 * Pick the rung for one name, against a surface's capacity in `em`.
 *
 * Deliberately has NO rung below "initial + surname". One name in sixteen from
 * the real trip roster (`Jason Schumacher` → `J. Schumacher`, 6.43em) still
 * exceeds the card's capacity and will meet the ellipsis. Adding a smaller-size
 * rung to rescue a single case would make every other name's outcome harder to
 * reason about, for a result — abbreviated and clipped by a few pixels — that
 * is legible anyway. If it grates on the device, that is the moment to revisit.
 */
export function fitName(name: string, capacityEm: number): FittedName {
  const full = (name ?? "").trim();
  if (estimateEm(full) <= capacityEm) return { text: full, step: 1 };
  return { text: initialSurname(full), step: 2 };
}

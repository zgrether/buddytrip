/**
 * The app's TYPE SCALE and its one eyebrow-label recipe.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `STYLE_GUIDE.md` §2 is called "Typography Tokens" and is entirely COLOUR —
 * sizes have always lived inside component recipes, so there has been nothing
 * for a new surface to be consistent WITH. Every surface therefore picks, and
 * they drift:
 *
 *   - The context rail accumulated five of the six app-wide uses of 9.5px
 *     before #902 cleaned them.
 *   - The bracket then reinvented 9.5px independently, months later, with no
 *     contact between the two. Same off-scale value, different surface.
 *
 * That second one is the argument for the scale EXISTING rather than being
 * re-counted whenever someone wonders. A value nobody can look up is a value
 * everyone re-derives.
 *
 * ── Derived, not invented ──────────────────────────────────────────────────
 * These are the sizes already in the codebase, ranked by how often they appear.
 * Nothing here is new. The counts are a SNAPSHOT (2026-08-16) and they move —
 * #902 measured the same seven rungs in a different order, with 11 dominant
 * where 13 now is. Treat the SET as the contract and the counts as evidence for
 * how it was arrived at, not as a spec.
 */

/**
 * The seven rungs, most-used first. Counts are inline `fontSize:` occurrences
 * across `src/` at the time of writing.
 *
 * Sizes outside this set are not forbidden by anything mechanical — see the note
 * at the bottom of this file — but each one is a surface choosing to be
 * different, and should say why.
 */
export const TYPE_SCALE = {
  /** 103 uses — body copy, the default. */
  body: 13,
  /** 74 — secondary body, dense rows, most subtitles. */
  bodyDense: 12,
  /** 37 — emphasis inside a row; small headings. */
  emphasis: 14,
  /** 36 — the eyebrow rung (see `EYEBROW`), and small numerals. */
  micro: 10,
  /** 34 — primary names on a dense board. */
  name: 15,
  /** 34 — captions, helper text, table headers. */
  caption: 11,
  /** 29 — the half-step between caption and bodyDense. */
  captionPlus: 12.5,
} as const;

/**
 * The ONE eyebrow-label recipe — the small, uppercase, letter-spaced header that
 * sits above or inside a card ("MATCH 1 · 1V1", "ROUND 1", "CONSOLATION").
 *
 * ── Derived from the majority of 26 existing eyebrows across 17 files ──────
 *   fontSize      10          9 of 26   (then 11 ×5, 9.5 ×4, 10.5 ×3, 9 ×2)
 *   letterSpacing 0.08em     13 of 26   (then 0.06em ×6, 0.1em ×2, 0.09em ×2)
 *   color         text-dim   16 of 26   (then owner ×2, warning ×2, text ×1)
 *   fontWeight    700        23 of 26
 *
 * Match play's card header already matched all four before this was written,
 * which is the strongest position to standardise from: the convention is the
 * majority made explicit, not a new opinion imposed on existing surfaces.
 *
 * `color` is deliberately NOT baked in — a status eyebrow legitimately overrides
 * it (the bracket's consolation label is `--color-bt-warning`, and news uses
 * `--color-bt-owner`). Spread this and override the one property:
 *
 *     <div style={{ ...EYEBROW, color: "var(--color-bt-warning)" }}>
 *
 * ── Separator ──────────────────────────────────────────────────────────────
 * Segments within one eyebrow are joined by a spaced middot — `A · B` — which is
 * what match play, the rack board and the news blocks all already do.
 */
export const EYEBROW = {
  fontSize: TYPE_SCALE.micro,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-bt-text-dim)",
} as const;

/** The separator between eyebrow segments. A constant so "· " vs " · " vs "•"
 *  is decided once rather than per surface. */
export const EYEBROW_SEPARATOR = " · ";

/**
 * ── Could this be enforced? (reported, deliberately not built) ─────────────
 * Two options, neither in scope for the PR that added this file:
 *
 *   1. An ESLint rule banning inline `fontSize:` literals outside this module.
 *      Catches the real failure mode (a surface picking a number) at the moment
 *      it is typed, which is the only time it is cheap to fix.
 *   2. A source-guard test in the shape of `TripIdProvider`'s — walk `src/`,
 *      collect every inline `fontSize:` literal, assert each is on a rung.
 *
 * Either needs an ALLOWLIST first: roughly a dozen off-scale values exist today
 * (9, 9.5, 10.5, 11.5, 16.5, 19, and the display sizes above 18), and some are
 * legitimate one-offs rather than drift. Landing a guard without triaging those
 * would either fail the build immediately or bake the drift in as "approved",
 * and the triage is the actual work.
 */

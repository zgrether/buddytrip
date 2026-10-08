import type { SlateResult } from "./pickemScoring";

/**
 * THE ONE PLACE a stored slate result becomes a word on screen.
 *
 * The stored value is `cancelled` (`pickem_slate_games.result`); the screen says
 * **Canceled** — US spelling, Zach's call (2026-10-08). The two differ by one
 * letter ON PURPOSE: a stored value is an identifier, not copy, the way
 * `co_admin` was a name in code while the screen said Organizer. Renaming a
 * value that RLS and four writers compare against, to fix a spelling, is the
 * highest-risk tier for a cosmetic gain (CLAUDE.md glossary).
 *
 * One mapping, so the one-letter split stays ONE split: every pick'em surface
 * that names a cancelled game reads its word from here — the results-entry
 * segment, the head-to-head chip, the settled status line and the runner's
 * instruction. `pickemResultWords.guard.test.ts` fails if a surface spells the
 * word itself.
 *
 * Only `cancelled` lives here. `push` is worded per surface on purpose ("Push"
 * on the segment, "Pushed" on the settled line) and is not a spelling question.
 */
export const SLATE_RESULT_WORD = {
  cancelled: "Canceled",
} as const satisfies Partial<Record<SlateResult, string>>;

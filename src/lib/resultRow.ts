/**
 * What a `game_results` row CARRIES — the row's own declaration, not a guess
 * about it (`game_results.value_kind`, migration 191, #826).
 *
 * Client-safe and dependency-free (CLAUDE.md #8), because the write side stamps
 * it and PR 3's pure award function will branch on it — and that function
 * cannot import a server module. The board's own reading of the same column
 * lives in `competitionLeaderboard`'s `declaredConvention`, which speaks the
 * board's vocabulary (`positions` / `points`) rather than the column's.
 *
 * ── The ambiguity this ends ────────────────────────────────────────────────
 *
 * `game_results` carries two currencies in two nullable columns, and until 191
 * the only way to tell them apart was to look at which column was null. That
 * inference lives in `rowConvention`, and a SECOND, different one lives in
 * `gameFinishNotify` (`position != null && raw_score === position`), because
 * `writeManualResults` mirrors a rank into `raw_score` and the first test alone
 * would read every manual placement as points. One question, two derivations,
 * in a codebase whose #24 catalogues eight incidents of exactly that.
 *
 * Deliberately JUST the type. A validator and a values array were written
 * alongside it and deleted unused: the column is NOT NULL with a CHECK, so the
 * database refuses a bad value before any TypeScript sees it, and an unused
 * export is the dead-metadata exit PR 1 committed to taking.
 */
export type ResultValueKind =
  /** The value is a RANK — read `position`, low wins. */
  | "rank"
  /** The value is POINTS already decided — read `raw_score`, high wins. */
  | "points";

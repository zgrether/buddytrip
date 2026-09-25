/**
 * The tables whose writes BROADCAST on `competition_events:{competitionId}`
 * (`broadcast_score_event`, CLAUDE.md #20) — the one list (#1432).
 *
 * Three readers depend on it, and each is held to it by something other than
 * memory:
 *
 *  - the client handler (`useRealtimeScoreEvents.BROADCAST_READERS`) is a
 *    `Record<BroadcastTable, …>`, so `tsc` refuses a table with no reader;
 *  - every format declares the tables that can hold its scores
 *    (`GameTypeDefinition.scoreTables: readonly BroadcastTable[]`), so `tsc`
 *    refuses a format naming a table that is not here — a new format's new
 *    score table has to be added HERE, and then the two checks below apply;
 *  - `broadcastRegistry.schema.test.ts` asserts this list EQUALS the tables that
 *    actually carry a broadcast trigger in the migrated schema
 *    (`_broadcast_triggers()`, migration 192), in both directions, with no
 *    allowlist. A table listed here without a trigger — the shape skins had
 *    until 192 — fails; so does a trigger nobody listed.
 *
 * Why this exists: the handler's invalidation list was patched one key at a time
 * after someone noticed a stale screen (bracketDraw, then matches.listByGame),
 * and three more were still missing — outcome-mode holes, skins holes and
 * pick'em results reached other devices only on a 20–60s poll. A hand-kept list
 * is how the next one gets missed.
 *
 * Client-safe: names only.
 */
export const BROADCAST_TABLES = [
  "games",
  "game_results",
  "score_entries",
  "match_hole_outcomes",
  "skins_hole_outcomes",
  "game_matches",
  "bracket_matches",
  "pickem_slate_games",
] as const;

export type BroadcastTable = (typeof BROADCAST_TABLES)[number];

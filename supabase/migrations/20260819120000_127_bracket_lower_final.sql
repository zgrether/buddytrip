-- 127 — `bracket_matches.bracket` admits the double-elimination structures.
--
-- Widens the CHECK that migration 112 created:
--
--     bracket text NOT NULL DEFAULT 'main' CHECK (bracket IN ('main', 'consolation'))
--
-- 112 was right for what existed. The column answers "which structure is this match
-- part of," and single elimination has exactly two answers. Double elimination adds two
-- more, so this is a widening of that decision rather than a reversal of it — 112's
-- shape (one column naming the structure, UNIQUE per game+bracket+round+slot) is what
-- makes the addition a one-line change instead of a schema rework.
--
-- ── Why `final` is its own value and not `main` round N+1 ───────────────────
-- Worth stating in the schema, because the constraint is where the decision is
-- enforced and a later reader will ask.
--
-- Bracket advancement has NO link column: position IS the link. A match's winner goes
-- to `slot ceil(s/2)` of the next round, seat A if the slot was odd and B if even
-- (`parentOf` in src/lib/bracketAdvance.ts). Every match in the structure obeys that
-- rule. As `main` round N+1, the grand final would be the ONLY match whose two entrants
-- do not come from round N slots 2s−1 and 2s — they arrive from different brackets —
-- so it would force a special case into the one rule that currently has none, at
-- exactly the place a reader would least expect an exception.
--
-- A distinct value keeps each rule total: within `main`, positional advancement always
-- holds; within `lower`, its own rule always holds; `final` is explicitly the
-- convergence, and is SUPPOSED to be seeded from elsewhere. It also matches what the
-- column already means — `consolation` set the precedent that a non-main structure
-- gets its own value.
--
-- And the grand final is not the last round of the winners' bracket in any case: an
-- entrant can reach it having lost, which no `main` match permits.
--
-- ── The if-necessary final needs nothing here ──────────────────────────────
-- It is round 2 of `final`, slot 1 — so the existing UNIQUE (game_id, bracket, round,
-- slot) separates the two finals with no new column. Its EXISTENCE stays derived, never
-- persisted: round 2 exists iff round 1 was won by the entrant who came through
-- `lower`. Consistent with the rest of the bracket engine, where the only thing a pick
-- writes is `winner_entrant_id` and every occupant above it is computed.
--
-- ── `consolation` and `lower` can never co-occur ───────────────────────────
-- A third-place play-off is a single-elimination concept; double elimination produces
-- 3rd structurally, and the consolation toggle hides under it. That is an invariant of
-- the SETUP surface, deliberately left as a comment rather than a constraint: encoding
-- it here would mean a CHECK spanning rows of the same game, which this column cannot
-- express and which the setup layer already prevents at the point of choice.
--
-- ── Risk ───────────────────────────────────────────────────────────────────
-- A widening cannot fail on existing rows: every current row is `main` or
-- `consolation`, both still admitted. No data is read, rewritten or deleted, and no
-- code path changes behaviour — `save_game_config` already inserts
-- `COALESCE(m->>'bracket','main')` straight from the payload and is value-agnostic, and
-- NO RLS policy branches on this value (all six bracket policies gate on trip
-- membership or role via `game_id`). Both were verified against the deployed database
-- before this was written, because a DB-value that RLS branches on is the one class
-- `tsc` cannot catch.

ALTER TABLE public.bracket_matches
  DROP CONSTRAINT IF EXISTS bracket_matches_bracket_check;

ALTER TABLE public.bracket_matches
  ADD CONSTRAINT bracket_matches_bracket_check
  CHECK (bracket IN ('main', 'lower', 'final', 'consolation'));

COMMENT ON COLUMN public.bracket_matches.bracket IS
  'Which STRUCTURE this match belongs to, not who is in it. '
  'main = winners'' bracket (single or double elim). '
  'lower = the second-life bracket (double elim only). '
  'final = the grand final; round 2 is the if-necessary final, and exists only when '
  'the lower-bracket entrant won round 1. '
  'consolation = single-elim 3rd-place play-off; never co-occurs with lower.';

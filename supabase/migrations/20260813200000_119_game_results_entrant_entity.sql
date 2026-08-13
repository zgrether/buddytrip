-- ════════════════════════════════════════════════════════════════════════════
-- 119 · `game_results` can hold an ENTRANT's placement
--
-- Widens the `entity_type` CHECK from ('user','team','play_group') to include
-- 'entrant'. Schema only — no reader ships here, per the Migration Workflow's
-- additive-first rule.
--
-- ── The problem this exists to solve ───────────────────────────────────────
-- A placement game stores ONE row per team with one `position`, and the
-- competition leaderboard derives points from that position at read time. That
-- shape is exactly right for every format whose competitors ARE the teams.
--
-- A bracket's competitors are ENTRANTS, and several entrants share a cup team.
-- Migration 116 made that structural: an entrant carries its own `team_id`,
-- which is what makes a 2v2 pairing unable to span two teams.
--
-- So a 6-entrant bracket across 2 teams has team A finishing 1st, 3rd and 5th.
-- One position per team cannot say that, and the previous shape forced a choice
-- between two wrong answers:
--   * collapse to the team's BEST place — which silently reverts #916, whose
--     whole point was that a bracket's place ceiling is its FIELD rather than
--     its team count ("an 8-place split over 8 entrants pays 1st, 2nd, the two
--     semi-final losers averaged across 3rd/4th, and the four quarter-final
--     losers averaged across 5th–8th"). Under the collapse those later places
--     are configurable and never paid.
--   * write summed POINTS instead of a position — which snapshots the payout at
--     finalize and breaks the property `save_game_config`'s FINALIZED block
--     leans on: re-pointing a finished game recomputes the leaderboard
--     correctly with nothing rewritten, precisely because points are derived.
--
-- Storing the entrant's own placement keeps both. The roll-up to teams becomes
-- a read-time derivation like every other points question, rather than a
-- decision baked into the write.
--
-- ── ENTRANT ROWS ARE STORAGE, NOT A MANDATE ────────────────────────────────
-- This does NOT mean a bracket must have a multi-place distribution. A
-- one-place split — winner takes all — is a perfectly ordinary bracket, and it
-- has to be the CHEAPEST path through this, not a special case bolted on the
-- side.
--
-- It is, and it falls out of the existing mechanism rather than a branch: every
-- entrant gets a row carrying its finishing place, the distribution decides
-- what each place is worth, and a one-element distribution simply pays place 1
-- and nothing else. No conditional, no "if single place then…" arm. The storage
-- records where everyone finished; the distribution — unchanged, shared with
-- every other placement format — decides what that is worth.
--
-- The tell that this has been got wrong later: a code path that reads the
-- distribution's LENGTH to decide how to write results. Length is the payout's
-- business, never the record's.
--
-- ── Why not an FK to bracket_entrants ──────────────────────────────────────
-- `entity_id` is deliberately un-FK'd across all four types: it already points
-- at `users`, `teams` or `play_groups` depending on `entity_type`, and a column
-- that means different tables in different rows cannot carry a foreign key. The
-- CHECK is what constrains it, exactly as before. Deleting a bracket's entrants
-- is only possible via the draw rebuild, which is refused once any winner
-- exists (HAS_PICKS) and therefore cannot strand a posted result.
--
-- ── No index ───────────────────────────────────────────────────────────────
-- Deliberately none. `game_results` is small, the leaderboard already reads it
-- by `game_id`, and entrant rows add at most one row per competitor per bracket
-- — tens, not thousands. Adding an index here on the strength of a guess is the
-- kind of unmeasured change CLAUDE.md's Index Creation section exists to
-- prevent; when there is a measurement, it can have one.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.game_results DROP CONSTRAINT IF EXISTS game_results_entity_type_check;

ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_entity_type_check
  CHECK (entity_type IN ('user', 'team', 'play_group', 'entrant'));

COMMENT ON COLUMN public.game_results.entity_type IS
  'What entity_id points at: user | team | play_group | entrant. '
  '''entrant'' is a bracket competitor (bracket_entrants.id) — several entrants '
  'can share a cup team, so their placements roll up to team points at READ '
  'time rather than being collapsed at write time (migration 119).';

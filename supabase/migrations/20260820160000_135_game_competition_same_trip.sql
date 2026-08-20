-- 135 — a game's competition lives in the game's trip, and scoring cannot be on
-- for a game that was never taken live.
--
-- Closes F10 and F11 of the RLS audit. Both are on `games`, both are invariants
-- rather than permissions, so both are enforced declaratively — which means they
-- also hold for the service-role client, where a policy would not.
--
-- ══ F10 — `games.competition_id` could point at ANOTHER trip's competition ══
--
-- Probed: a delegate reassigned their game's `competition_id` to a competition
-- belonging to a different trip, so the game's results would have been folded
-- into a cup nobody on that trip could see the source of. Moving `trip_id`
-- itself was already refused — the SELECT policy is evaluated against the new
-- row on UPDATE (CLAUDE.md #26) — but `competition_id` had no check at all:
-- the FK only required the competition to EXIST, not to be reachable.
--
-- Available to any Owner/Organizer through `games_write` too. No procedure does
-- it: `save_game_config` never repoints a game's competition.
--
-- ── Why a composite FK rather than a trigger ──────────────────────────────
--
-- "This game's competition is in this game's trip" is referential integrity, so
-- the FK system can state it directly once `competitions` exposes the pair:
--
--   FOREIGN KEY (competition_id, trip_id) REFERENCES competitions(id, trip_id)
--
-- A trigger would have to be written, ordered against the other triggers on
-- this table, and kept in step with them. This cannot be forgotten and cannot
-- be bypassed. Two details make it work:
--
--   • Standalone games (~40% of prod) carry a NULL `competition_id`. The default
--     MATCH SIMPLE means a row with ANY null in the referencing columns is not
--     checked, so those stay legal without a special case. Verified by probe,
--     not assumed.
--   • `ON DELETE SET NULL (competition_id)` — the COLUMN-SPECIFIC form, PG 15+
--     (prod is 17.6, checked). Plain `SET NULL` would try to null `trip_id` too,
--     which is NOT NULL, and every competition delete would fail. This preserves
--     exactly what migration 056 chose: deleting a competition orphans its games
--     rather than destroying them.
--
-- Both existing rows counts verified 0 before writing this: no game in prod or
-- local points outside its trip, so the constraint applies without a backfill.
--
-- Residual, named: a delegate can still move a game between competitions
-- WITHIN its own trip. That is ordinary configuration, reaches nothing the
-- caller could not already see, and is not what F10 reported.
--
-- ══ F11 — the "go-live triple" could be desynchronised ════════════════════
--
-- Probed: `scoring_enabled = true` written alone, leaving `status = 'pending'`
-- and `pairings_published_at` NULL — scoring open on a game that was never
-- announced.
--
-- ── The invariant is NOT the one CLAUDE.md #25 states, and #25 is wrong ───
--
-- #25 says the three columns "move TOGETHER, always" and that "there is no
-- legitimate state where one has moved and the others have not". Read against
-- the code that is false, and a trigger enforcing it would have broken the app:
--
--   games.finish        status='complete' + scoring_enabled=true, leaving
--                       pairings_published_at as it was
--   scores.upsertEntry  status pending→active ALONE (the first score flipping a
--                       game Live — the behaviour the glossary names)
--
-- `status` is its own lifecycle axis.
--
-- ── The rule this FIRST tried to impose was also wrong, and the tests said so ──
--
-- The obvious next candidate is `scoring_enabled ⇒ pairings_published_at IS NOT
-- NULL`. It fits every write path, and all 23 prod rows and 71 local rows
-- satisfy it. It was written, and it broke 47 tests.
--
-- The reason is a GUARD, not a write: `games.finish` has no live-ness check at
-- all. It will finalize a game sitting in `pending` that was never taken live,
-- and set `scoring_enabled = true` on the way past (deliberately — the comment
-- there explains it is so a later correction edit passes the score-entry gate).
-- So `complete + scoring_enabled + never published` is REACHABLE, the test
-- seeds were reproducing a real shortcut rather than fabricating an impossible
-- state, and prod showing zero such rows only meant nobody had taken it yet.
--
-- Recorded because the near-miss is the lesson: the writes were enumerated and
-- the invariant was still wrong, because what made it wrong was a procedure
-- that DOESN'T write two of the three columns and doesn't guard on them either.
--
-- ── What is actually enforced ─────────────────────────────────────────────
--
--   NOT (scoring_enabled AND pairings_published_at IS NULL AND status='pending')
--
-- "Scoring cannot be open on a game that has neither been announced nor
-- started." That is a statement about the domain, not a shape fitted to the
-- test suite: `pending` + never-published is a game that has not begun, and
-- scoring being open on it is the state F11 probed — a member who is a
-- participant can write `score_entries` (that policy gates on
-- `scoring_enabled`, never on `status`) to a game no one has been told about.
--
-- Finish's shortcut is untouched, because its result is `complete`: the game
-- happened and is being recorded, and `scoring_enabled` there is bookkeeping
-- for corrections rather than an open door.
--
-- Independent corroboration that this is the code's own rule and not a shape
-- fitted to the test suite: migration 126's `resetScoring` already writes
-- `status = CASE WHEN scoring_enabled THEN 'active' ELSE 'pending' END` — it
-- goes out of its way never to leave a game `pending` with scoring on. That
-- belief was already in the codebase; this only makes it enforceable.
--
-- A CHECK rather than a trigger: no subquery is needed, so it can be
-- declarative, and it therefore binds the service-role client too — which
-- matters here, because the one status write that bypasses RLS
-- (`scores.upsertEntry`'s admin flip) lives on this very table.

-- ── F10 ───────────────────────────────────────────────────────────────────

-- The composite FK needs its target to be unique as a PAIR. `id` is already the
-- primary key, so this adds no new restriction on the data — it exists solely
-- so the pair can be referenced.
ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_id_trip_key UNIQUE (id, trip_id);

COMMENT ON CONSTRAINT competitions_id_trip_key ON public.competitions IS
  'Redundant with the primary key as a uniqueness claim; exists so games can reference (id, trip_id) as a pair and be held to the same trip (migration 135).';

-- Supporting index for the referencing side. `games.competition_id` had NO
-- index at all, so every competition delete seq-scanned this table; the
-- composite FK leans on it harder. Plain CREATE INDEX is correct here — `games`
-- is 23 rows in prod, so the lock is sub-millisecond (CLAUDE.md Index Creation).
CREATE INDEX IF NOT EXISTS idx_games_competition_trip
  ON public.games (competition_id, trip_id);

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_competition_id_fkey;

ALTER TABLE public.games
  ADD CONSTRAINT games_competition_id_fkey
  FOREIGN KEY (competition_id, trip_id)
  REFERENCES public.competitions (id, trip_id)
  ON DELETE SET NULL (competition_id);

COMMENT ON CONSTRAINT games_competition_id_fkey ON public.games IS
  'A game''s competition must belong to the game''s trip. Replaces the single-column FK from migration 033/056, which required the competition to exist but not to be reachable — so competition_id could be repointed at another trip''s cup. Column-specific ON DELETE SET NULL preserves migration 056''s choice (deleting a competition orphans its games, never deletes them) without trying to null the NOT NULL trip_id (migration 135).';

-- ── F11 ───────────────────────────────────────────────────────────────────

ALTER TABLE public.games
  ADD CONSTRAINT games_scoring_requires_started_or_published
  CHECK (NOT (scoring_enabled
              AND pairings_published_at IS NULL
              AND status = 'pending'));

COMMENT ON CONSTRAINT games_scoring_requires_started_or_published ON public.games IS
  'Scoring cannot be open on a game that has neither been announced nor started. Refuses the F11 state — scoring_enabled written alone onto a pending, never-published game, which lets a participant write score_entries (that policy gates on scoring_enabled, never on status) to a game nobody has been told about. Deliberately does NOT require pairings in general: games.finish has no live-ness guard and sets scoring_enabled=true while finalizing a never-live game, so complete+scoring+unpublished is a real reachable state (migration 135; corrects the invariant CLAUDE.md #25 asserted).';

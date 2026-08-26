-- 146 — pick'em: the slate, the picks, and the one policy shape this schema has
--       never had before.
--
-- Pick'em spec Phase 0. This migration exists for ONE thing: a SELECT policy on
-- picks that has **no staff branch**. Everything else here is the minimum needed
-- to make that policy real, testable, and referentially sound.
--
-- ══ Why the policy is the whole point ═══════════════════════════════════════
--
-- The feature's one hard rule (spec §3.1): **nobody sees another participant's
-- sheet before the deadline — the Owner and the delegate included.** They are
-- participants too, and they hold the button that locks everyone else out. A
-- staff read here is not a leak in the abstract; it is the person who decides
-- when picking stops being able to read the room before deciding.
--
-- Every score-shaped policy in this schema carries the same escape hatch:
--
--     OR public.has_trip_role(g.trip_id, ARRAY['Owner','Organizer'])
--     OR public.is_game_delegate(g.id)
--
-- `score_entries_select` (068/136), `match_hole_outcomes_select` (075/136),
-- `game_results`, `game_matches` — all of them, and correctly, because a
-- scorecard is not secret and staff must be able to correct one.
--
-- **A pick before the deadline is secret.** So the policy below is the first in
-- this schema with no such branch, and the tests that ship with it
-- (`pickemPicksPolicy.rls.test.ts`) drive PostgREST with a real JWT rather than
-- going through tRPC — because a test that goes through the callers cannot see
-- a policy wider than its callers, which is the 2026-08-20 RLS audit's central
-- finding and the reason F1 survived three migrations that edited its own table.
--
-- The DANGER is not that the branch is hard to omit. It is that every existing
-- policy reads as the template, and a future edit "for consistency" reintroduces
-- it in one line. The guard against that is a test that FAILS when it comes
-- back, asserting staff blindness explicitly rather than asserting a member's.
--
-- ══ Why picks are not `score_entries` ═══════════════════════════════════════
--
-- Two independent reasons, either sufficient:
--
--   1. `score_entries_select` is trip-member-wide the moment `scoring_enabled`
--      is true, plus the staff branch above. Storing picks there publishes them.
--   2. Migration 135's CHECK refuses `scoring_enabled AND pairings_published_at
--      IS NULL AND status = 'pending'` — which is exactly "picks are open":
--      participants writing, pairings deliberately unset (§3.1: pairing before
--      the lock would let people tailor confidence to a known opponent), no
--      results yet. Migration 135 is NOT amended and `status` is NOT moved to
--      'active' early; the glossary reserves Live for what the first score
--      flips. Pick'em's participant-write phase gets its own gate instead.
--
-- ══ What this migration deliberately does NOT do ════════════════════════════
--
--   * No UI, no tRPC procedures — spec Phase 0.
--   * No `use_confidence` / `roll_up` / `pairing` settings columns. They belong
--     to Phase 2 and go on `pickem_games` when it renders them.
--   * No "submitted" record. Submitted-vs-edited is a Phase 3 fact (it drives
--     reminder skipping, which is deferred for want of a scheduler, and the
--     runner's count).
--   * No results table. Lock point 2 ("first result freezes the slate", spec §4)
--     cannot be enforced before results exist — Phase 5.
--   * No opinion on whether a default sheet is MATERIALISED at picks-open or
--     DERIVED from absence. Both work against this shape: a row is an explicit
--     pick, and Phase 3 decides whether the defaults are written. Nothing here
--     forecloses either.

-- ── pickem_games — the per-game lifecycle clock ────────────────────────────
--
-- Three timestamps, because the fairness rules key on three different moments
-- and a jsonb blob cannot be read safely from a policy: `(config->>'deadline')
-- ::timestamptz` fails to NULL on a typo, silently, and this is the one place
-- in the feature where failing quietly is unacceptable. Typed columns, so a
-- misspelling is a migration error instead of an open door.
--
-- Ids are `text` throughout, per CLAUDE.md's app-wide convention.
CREATE TABLE IF NOT EXISTS public.pickem_games (
  game_id text PRIMARY KEY REFERENCES public.games(id) ON DELETE CASCADE,
  -- State 1 → 2. NULL means "picks open soon" to every member, and per spec
  -- §3.1 rule 1 a member must not be able to tell 1a (nothing added) from 1b
  -- (a finished slate, unpublished) — which is what the slate SELECT policy
  -- below enforces by reading this column.
  picks_opened_at timestamptz,
  -- Optional. Its absence means picks stay open until the runner locks by hand.
  picks_deadline timestamptz,
  -- The manual "Lock picks now". The ONLY explicit transition — the deadline
  -- itself is evaluated lazily (spec §7.1), because nothing in this stack can
  -- fire a timed event: no vercel.json cron, no edge functions, no pg_cron.
  picks_locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pickem_games IS
  'Per-game pick''em lifecycle clock. Read by the picks and slate RLS policies, so its columns are typed rather than jsonb: a policy that reads a mistyped jsonb key fails to NULL silently, and these three columns are what stands between a participant and someone else''s sheet (migration 146).';
COMMENT ON COLUMN public.pickem_games.picks_locked_at IS
  'Manual "Lock picks now" — the only EXPLICIT lock transition. The deadline is evaluated lazily at every read and write (pickem_picks_revealed / pickem_picks_open) because no scheduler exists to fire it.';

-- ── pickem_slate_games — the contests being predicted ──────────────────────
CREATE TABLE IF NOT EXISTS public.pickem_slate_games (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  -- Slate order sets the confidence range (1..N) and the display order. Not
  -- UNIQUE within the game: reordering a list under a unique constraint needs a
  -- temporary value per swap, and `games.display_order` (108) already set the
  -- precedent of a plain integer.
  display_order integer NOT NULL,
  away_team text NOT NULL,
  home_team text NOT NULL,
  -- Free text, not numeric: the runner types what the book shows ("−3.5",
  -- "+1.5", "PK") and nothing computes with it. Picks are made against the
  -- spread by the PICKER, not by the app.
  spread text,
  -- Display and ordering ONLY (spec §5.1) — nothing validates the deadline
  -- against it. `text`, matching `games.tee_time` (037), and for the same
  -- reason: there is no timezone column anywhere in this schema, so a stored
  -- instant could not be rendered as a local kickoff anyway.
  kickoff text,
  note text,
  -- Spec §2.3. Scoring is `confidence × multiplier`, and NOTHING downstream
  -- branches on the settings: confidence off fixes its term at 1, and an unset
  -- multiplier is 1. Hence the default — setting nothing must produce a normal
  -- game. Phase 2 owns the UI for this column; it lives here now because the
  -- table is being created here and a same-week ALTER for one column is noise.
  multiplier numeric NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pickem_slate_games_game
  ON public.pickem_slate_games (game_id, display_order);

-- Exists so `pickem_picks` can reference the PAIR and be held to one game. See
-- the composite FK below for why that matters. Redundant with the primary key
-- as a uniqueness claim — the same move migration 135 made for competitions.
--
-- Added conditionally rather than as DROP-IF-EXISTS-then-ADD, which is the
-- idiom used elsewhere in this repo for FKs and is WRONG for this one: the
-- composite FK on `pickem_picks` depends on this constraint's index, so the
-- drop fails with "cannot drop constraint ... because other objects depend on
-- it" the second time the file is run. Replay-from-zero (what CI enforces)
-- would never have caught that — on an empty database the drop is a no-op and
-- nothing depends on anything yet. Found by re-running the file against a
-- database that already had it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pickem_slate_games_id_game_key'
       AND conrelid = 'public.pickem_slate_games'::regclass
  ) THEN
    ALTER TABLE public.pickem_slate_games
      ADD CONSTRAINT pickem_slate_games_id_game_key UNIQUE (id, game_id);
  END IF;
END $$;

COMMENT ON TABLE public.pickem_slate_games IS
  'The contests a pick''em game predicts. Order sets the confidence range 1..N. Hidden from non-staff members until picks open, so nobody can tell an empty slate from a finished-but-unpublished one (spec §3.1; migration 146).';

-- ── pickem_picks — one participant's call on one slate game ────────────────
CREATE TABLE IF NOT EXISTS public.pickem_picks (
  id text PRIMARY KEY,
  -- DENORMALISED from the slate game, and load-bearing: every policy on this
  -- table has to reach the lifecycle clock and the owning trip, and doing that
  -- through a join to `pickem_slate_games` would make the picks policy depend
  -- on the slate policy — which deliberately hides rows before picks open. A
  -- policy that reads through another policy is a policy whose behaviour
  -- changes when the other one does.
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  slate_game_id text NOT NULL,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- 'away' | 'home' rather than a boolean: the RESULT model is four-valued
  -- (away/home/push/cancelled, spec §6) and sharing one vocabulary between the
  -- pick and the outcome is what lets "did this pick win?" be an equality test
  -- instead of a mapping. A boolean would also be the exact shape spec §13's
  -- "a suite that only ever sets a winner" warns about.
  pick text NOT NULL CHECK (pick IN ('away', 'home')),
  -- NULL when the game runs with `use_confidence` off. NOT a stored 1: the
  -- partial unique index below forbids duplicate ranks, and sixteen picks all
  -- storing 1 would collide with it. Scoring reads `COALESCE(confidence, 1)`,
  -- which is the same formula with the term fixed — never a branch (spec §14).
  confidence integer CHECK (confidence IS NULL OR confidence >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set by the WRITER, not by a trigger — the same arrangement `score_entries.
  -- submitted_at` has. There is no touch trigger anywhere in this schema and
  -- adding the first one here would be a convention this table invented alone.
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One call per person per contest.
  UNIQUE (slate_game_id, user_id),

  -- The slate game must belong to the game this pick claims. Without it,
  -- `game_id` is an unchecked assertion and every policy below reads a
  -- lifecycle clock that may belong to a different game — i.e. the caller
  -- chooses which deadline applies to them. A composite FK states it once and
  -- cannot be forgotten, the way migration 135 did for games/competitions.
  FOREIGN KEY (slate_game_id, game_id)
    REFERENCES public.pickem_slate_games (id, game_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pickem_picks_game_user
  ON public.pickem_picks (game_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pickem_picks_slate_game
  ON public.pickem_picks (slate_game_id);

-- No duplicate confidence values within one participant's sheet. Enforced
-- SERVER-side and independently of the client (spec §13) — the drag list makes
-- duplicates unconstructible in the UI, but the UI is not authoritative and a
-- direct PostgREST write bypasses it entirely.
--
-- A partial index rather than a table constraint, because `confidence IS NULL`
-- is the legitimate `use_confidence = off` shape and NULLs are distinct under a
-- plain UNIQUE anyway; being explicit says which of the two reasons is meant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pickem_picks_confidence
  ON public.pickem_picks (game_id, user_id, confidence)
  WHERE confidence IS NOT NULL;

COMMENT ON TABLE public.pickem_picks IS
  'One participant''s pick on one slate game. THE table whose SELECT policy has no staff branch: before the lock, a row is readable by its owner and by nobody else — not the Owner, not an Organizer, not a game delegate (spec §3.1; migration 146).';
COMMENT ON COLUMN public.pickem_picks.confidence IS
  'The participant''s rank for this pick, 1..N, unique within their sheet (uq_pickem_picks_confidence). NULL when the game runs with confidence off; scoring reads COALESCE(confidence, 1) so the formula never branches on the setting.';

-- ── The lifecycle predicates ───────────────────────────────────────────────
--
-- SECURITY DEFINER for the same reason `is_trip_member` is: a policy on picks
-- must not depend on the caller being able to READ `pickem_games` under its own
-- policy, or the two policies become coupled and tightening one silently
-- changes the other. STABLE, so `now()` is the transaction timestamp and a
-- single statement cannot see the deadline pass halfway through.
--
-- These two are NOT inverses, deliberately. Before picks open neither is true:
-- nothing may be written and nothing is revealed. That is state 1, and an
-- inverse pair could not express it.

CREATE OR REPLACE FUNCTION public.pickem_picks_open(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.pickem_games pg
     WHERE pg.game_id = p_game_id
       AND pg.picks_opened_at IS NOT NULL
       AND pg.picks_locked_at IS NULL
       AND (pg.picks_deadline IS NULL OR now() <= pg.picks_deadline)
  );
$function$;

CREATE OR REPLACE FUNCTION public.pickem_picks_revealed(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.pickem_games pg
     WHERE pg.game_id = p_game_id
       AND pg.picks_opened_at IS NOT NULL
       AND (pg.picks_locked_at IS NOT NULL
            OR (pg.picks_deadline IS NOT NULL AND now() > pg.picks_deadline))
  );
$function$;

COMMENT ON FUNCTION public.pickem_picks_open(text) IS
  'Is this pick''em game accepting picks right now? Opened, not hand-locked, and either no deadline or the deadline has not passed. Evaluated lazily at every write because no scheduler exists to fire the deadline (migration 146).';
COMMENT ON FUNCTION public.pickem_picks_revealed(text) IS
  'Are this game''s sheets readable by other members yet? Opened AND (hand-locked OR past its deadline). The inverse of neither pickem_picks_open nor anything else: before picks open, both predicates are false — nothing writable, nothing revealed.';

-- Establishes no caller identity of its own, so it must not be reachable by
-- anon (the standing rule from migrations 143 and the REVOKE-from-PUBLIC
-- sweep). `authenticated` needs EXECUTE because policy expressions are
-- evaluated as the calling role.
REVOKE ALL ON FUNCTION public.pickem_picks_open(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pickem_picks_open(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pickem_picks_open(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pickem_picks_open(text) TO service_role;

REVOKE ALL ON FUNCTION public.pickem_picks_revealed(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pickem_picks_revealed(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pickem_picks_revealed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pickem_picks_revealed(text) TO service_role;

-- ── RLS: pickem_games ──────────────────────────────────────────────────────
--
-- The ORDINARY shape, and correctly so: the clock is not secret. Members need
-- the deadline to render the countdown, and knowing when picks close tells
-- nobody anything about what anyone picked.
ALTER TABLE public.pickem_games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pickem_games_select ON public.pickem_games;
CREATE POLICY pickem_games_select ON public.pickem_games
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                  WHERE g.id = pickem_games.game_id
                    AND public.is_trip_member(g.trip_id)));

DROP POLICY IF EXISTS pickem_games_write ON public.pickem_games;
CREATE POLICY pickem_games_write ON public.pickem_games
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                  WHERE g.id = pickem_games.game_id
                    AND (public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                         OR public.is_game_delegate(g.id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                  WHERE g.id = pickem_games.game_id
                    AND (public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                         OR public.is_game_delegate(g.id))));

-- ── RLS: pickem_slate_games ────────────────────────────────────────────────
--
-- This one enforces spec §3.1's FIRST fairness rule, and it is easy to miss
-- that a policy is what enforces it. "Members can't tell 1a from 1b" is not a
-- rendering decision: if a member could SELECT slate rows before picks open,
-- they could COUNT them, and the difference between "the runner has added
-- nothing" and "the runner has sixteen games and isn't ready" is exactly a row
-- count. Anyone with the publishable anon key and a session can issue that
-- count against PostgREST directly; no screen is involved.
--
-- So: staff see the slate they are building at any time; everyone else sees it
-- only once picks are open. Note this branch is the OPPOSITE of the picks
-- policy's — here staff visibility is the point, because the slate is theirs.
ALTER TABLE public.pickem_slate_games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pickem_slate_games_select ON public.pickem_slate_games;
CREATE POLICY pickem_slate_games_select ON public.pickem_slate_games
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.games g
     WHERE g.id = pickem_slate_games.game_id
       AND public.is_trip_member(g.trip_id)
       AND (public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
            OR public.is_game_delegate(g.id)
            -- Not `pickem_picks_open`: once picks LOCK, the slate must stay
            -- readable — the board renders one row per slate game for the rest
            -- of the game's life. Opened-ever is the right test, and it is the
            -- moment the slate itself freezes (spec §4, lock point 1).
            OR EXISTS (SELECT 1 FROM public.pickem_games pg
                        WHERE pg.game_id = pickem_slate_games.game_id
                          AND pg.picks_opened_at IS NOT NULL))));

DROP POLICY IF EXISTS pickem_slate_games_write ON public.pickem_slate_games;
CREATE POLICY pickem_slate_games_write ON public.pickem_slate_games
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                  WHERE g.id = pickem_slate_games.game_id
                    AND (public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                         OR public.is_game_delegate(g.id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                  WHERE g.id = pickem_slate_games.game_id
                    AND (public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                         OR public.is_game_delegate(g.id))));

-- ── RLS: pickem_picks — the one with no staff branch ───────────────────────
ALTER TABLE public.pickem_picks ENABLE ROW LEVEL SECURITY;

-- READ. Two branches and no third:
--
--   * your own row, always — you can always see your own sheet;
--   * anyone's row, once the game's picks are revealed (hand-locked or past
--     the deadline) — which is what makes the board possible.
--
-- There is NO `has_trip_role(...)` and NO `is_game_delegate(...)` here. That
-- omission is the feature. Do not add one "for consistency" with the score
-- policies: the Owner and the delegate are participants who hold the lock
-- button, and a staff read is precisely the abuse the rule names.
--
-- Trip membership is required on BOTH branches, not just the reveal branch —
-- someone removed from the trip stops reading its data, including their own
-- picks. Putting it in the shared EXISTS rather than duplicating it into each
-- branch is also what makes that non-optional as the policy is edited later.
DROP POLICY IF EXISTS pickem_picks_select ON public.pickem_picks;
CREATE POLICY pickem_picks_select ON public.pickem_picks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.games g
     WHERE g.id = pickem_picks.game_id
       AND public.is_trip_member(g.trip_id)
       AND (pickem_picks.user_id = (auth.uid())::text
            OR public.pickem_picks_revealed(pickem_picks.game_id))));

-- WRITE. Own row only, and only while picks are open — for EVERYONE.
--
-- "The Owner's own sheet locks at the deadline like everyone else's" (spec
-- §13) is this clause: no staff branch on the write either, so the person who
-- pressed Lock cannot keep editing after pressing it. That is a different
-- claim from the read rule and fails differently, so it is tested separately.
--
-- WITH CHECK repeats USING rather than delegating: USING governs which existing
-- rows are reachable, WITH CHECK what a row may become, and an UPDATE that
-- moved `user_id` to someone else would satisfy the first and must fail the
-- second. (CLAUDE.md #26 means the SELECT policy above independently refuses
-- that too — Postgres evaluates SELECT policies against the NEW row on UPDATE
-- — but relying on a SELECT policy to enforce a write rule is exactly the
-- coupling #26 warns is invisible in the policy text.)
DROP POLICY IF EXISTS pickem_picks_write ON public.pickem_picks;
CREATE POLICY pickem_picks_write ON public.pickem_picks
  FOR ALL TO authenticated
  USING (
    pickem_picks.user_id = (auth.uid())::text
    AND public.pickem_picks_open(pickem_picks.game_id)
    AND EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = pickem_picks.game_id
                   AND public.is_trip_member(g.trip_id)))
  WITH CHECK (
    pickem_picks.user_id = (auth.uid())::text
    AND public.pickem_picks_open(pickem_picks.game_id)
    AND EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = pickem_picks.game_id
                   AND public.is_trip_member(g.trip_id)));

COMMENT ON POLICY pickem_picks_select ON public.pickem_picks IS
  'Own row always; anyone''s row once picks are revealed. NO staff branch — unlike every score-shaped policy in this schema, an Owner/Organizer/delegate reads nothing here before the lock, because they are participants holding the lock button (spec §3.1). Adding has_trip_role or is_game_delegate here reintroduces the exact abuse the feature promises not to allow; pickemPicksPolicy.rls.test.ts fails if it returns.';
COMMENT ON POLICY pickem_picks_write ON public.pickem_picks IS
  'Own row, while picks are open, for everyone including staff — so the Owner''s own sheet locks at the deadline exactly as everyone else''s does. The open-ness test is lazy (pickem_picks_open reads now()) because no scheduler exists to fire the deadline.';

-- ── The guest merge MUST learn about the new person-referencing table ───────
--
-- CLAUDE.md's standing rule, and the direction that fails SILENTLY: the merge
-- ends by DELETEing the guest, so a table it does not know about is
-- cascade-deleted (`pickem_picks.user_id` is ON DELETE CASCADE) with no error
-- anywhere. A placeholder who was given a default sheet, then signs up, would
-- arrive at a real account with an empty sheet and no indication anything was
-- lost.
--
-- ── Why this one moves WHOLE SHEETS rather than rows ──────────────────────
--
-- Every other collision in this function is resolved per row, because every
-- other table's unique key is a single fact (one vote, one membership, one
-- delegate grant). A sheet is not: `pickem_picks` carries TWO unique keys —
-- (slate_game_id, user_id) and the partial (game_id, user_id, confidence) —
-- and a row-by-row merge can satisfy the first while violating the second, or
-- satisfy both and still produce a sheet with a rank used twice and another
-- missing. Half of one person's opinions spliced into half of another's is not
-- a sheet anyone submitted.
--
-- So the unit is the GAME: if the real account already has picks in a game,
-- its sheet wins whole and the guest's is dropped whole. Otherwise the guest's
-- sheet moves intact. The real account is the surviving identity, the same
-- precedence the nine collision-handled tables above use.
CREATE OR REPLACE FUNCTION public.merge_guest_pickem_picks(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.pickem_picks gp
   WHERE gp.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.pickem_picks rp
                  WHERE rp.game_id = gp.game_id AND rp.user_id = p_real_id);
  UPDATE public.pickem_picks SET user_id = p_real_id WHERE user_id = p_ghost_id;
END;
$$;

COMMENT ON FUNCTION public.merge_guest_pickem_picks(text, text) IS
  'The pick''em arm of merge_guest_to_real_user, split out so the sheet-level (not row-level) collision rule can carry its own explanation. Called only from that function; never granted to a client role (migration 146).';

REVOKE ALL ON FUNCTION public.merge_guest_pickem_picks(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_guest_pickem_picks(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.merge_guest_pickem_picks(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_guest_pickem_picks(text, text) TO service_role;

-- Re-declared in full because plpgsql has no append. Body lifted VERBATIM from
-- migration 112 (its last redefinition) with exactly one line added, rather than
-- retyped — this function runs inside the signup trigger, so a transcription slip
-- in a table name breaks signup for every invited user (the failure migration 023
-- was written to fix).
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- ── Trip + planning era ────────────────────────────────────────────────────
  -- UNIQUE (trip_id, user_id): drop the ghost's row when the real user is
  -- already a member of that trip, then move what's left.
  DELETE FROM public.trip_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.trip_members r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.trip_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (idea_id, user_id) — the real user's existing vote wins.
  DELETE FROM public.idea_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.idea_votes r
                  WHERE r.idea_id = g.idea_id AND r.user_id = p_real_id);
  UPDATE public.idea_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (window_id, user_id).
  DELETE FROM public.date_poll_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.date_poll_votes r
                  WHERE r.window_id = g.window_id AND r.user_id = p_real_id);
  UPDATE public.date_poll_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (expense_id, user_id).
  DELETE FROM public.expense_splits g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.expense_splits r
                  WHERE r.expense_id = g.expense_id AND r.user_id = p_real_id);
  UPDATE public.expense_splits SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id, visibility) — read receipts, NEW coverage (CASCADE).
  DELETE FROM public.chat_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.chat_reads r
                  WHERE r.trip_id = g.trip_id AND r.visibility = g.visibility
                    AND r.user_id = p_real_id);
  UPDATE public.chat_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.news_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.news_reads r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.news_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (circle_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.circle_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.circle_members r
                  WHERE r.circle_id = g.circle_id AND r.user_id = p_real_id);
  UPDATE public.circle_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Unconstrained on user_id — plain moves.
  UPDATE public.messages          SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses          SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.archived_ideas    SET user_id         = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)
  UPDATE public.news_posts        SET author_id       = p_real_id WHERE author_id       = p_ghost_id; -- NEW (CASCADE)
  -- push_subscriptions is UNIQUE on `endpoint`, not user_id, so this is safe:
  -- a ghost and a real account cannot share an endpoint.
  UPDATE public.push_subscriptions SET user_id        = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)

  -- Authorship / audit columns (SET NULL if the ghost were deleted).
  UPDATE public.quick_info_tiles     SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.users                SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.invites              SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.schedule_items       SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.schedule_items       SET confirmed_by = p_real_id WHERE confirmed_by = p_ghost_id; -- NEW
  UPDATE public.logistics_items      SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.idea_lodging_options SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.circles              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.courses              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW

  -- ── Competition / scoring era ──────────────────────────────────────────────
  -- PK (competition_id, user_id) — one team per person per competition.
  DELETE FROM public.team_assignments g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.team_assignments r
                  WHERE r.competition_id = g.competition_id AND r.user_id = p_real_id);
  UPDATE public.team_assignments SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- UNIQUE (game_id, user_id) — rostered participation. Its CASCADE FK would
  -- otherwise delete these rows with the ghost.
  DELETE FROM public.game_participants g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_participants r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_participants SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (game_id, user_id) — NEW coverage (CASCADE): delegate grants.
  DELETE FROM public.game_delegates g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_delegates r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_delegates SET user_id    = p_real_id WHERE user_id    = p_ghost_id; -- NEW
  UPDATE public.game_delegates SET granted_by = p_real_id WHERE granted_by = p_ghost_id; -- NEW

  -- PK (entrant_id, user_id) — NEW (migration 112): bracket entrant membership.
  -- Collision-safe in the same shape as game_delegates above: if the guest and
  -- the real account are BOTH in the same entrant (an owner pairs a placeholder
  -- with the person it stands for, then that person signs up), a plain UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails for that user. The
  -- real account is the surviving identity, so the guest's losing row goes first.
  --
  -- Without this the row CASCADES away with the guest and the entrant silently
  -- loses a partner — a 2v2 pairing quietly becomes a 1-player entrant, and the
  -- bracket keeps running with it.
  DELETE FROM public.bracket_entrant_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.bracket_entrant_members r
                  WHERE r.entrant_id = g.entrant_id AND r.user_id = p_real_id);
  UPDATE public.bracket_entrant_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Polymorphic (type,id) pairs — user-typed rows ONLY; team / play_group rows
  -- are a different identity space and must not be touched.
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type      = 'user';
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- JSONB match sides — NEW. Unreachable by `SET col = value`; the id lives
  -- inside the document. Guarded on type='user' so play_group sides are left
  -- intact (their members moved via game_participants above).
  UPDATE public.game_matches
     SET side_a = jsonb_set(side_a, '{id}', to_jsonb(p_real_id))
   WHERE side_a ->> 'type' = 'user' AND side_a ->> 'id' = p_ghost_id;
  UPDATE public.game_matches
     SET side_b = jsonb_set(side_b, '{id}', to_jsonb(p_real_id))
   WHERE side_b ->> 'type' = 'user' AND side_b ->> 'id' = p_ghost_id;

  -- Pick'em sheets — NEW (migration 146). Delegated so the sheet-level
  -- collision rule (whole sheets, not rows: pickem_picks carries TWO unique
  -- keys, and a row-wise merge can satisfy one while breaking the other) keeps
  -- its explanation next to the code that implements it.
  PERFORM public.merge_guest_pickem_picks(p_ghost_id, p_real_id);

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$$;

COMMENT ON FUNCTION public.merge_guest_to_real_user(text, text) IS
  'Reassign every person-reference from a guest row to a real account, then delete the guest. '
  'Runs inside the signup trigger (handle_new_user) AND, via link_guest_to_account, from '
  'ghostCrew.update''s auto-link branch. MUST cover every table with a person reference — a new '
  'such table has to be added here, or the ghost DELETE will cascade its rows away or null them out. '
  'Migration 146 added the pick''em arm (delegated to merge_guest_pickem_picks).';

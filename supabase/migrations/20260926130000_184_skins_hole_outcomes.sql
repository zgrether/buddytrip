-- ════════════════════════════════════════════════════════════════════════════
-- 184 · Skins: where a hole's winner is recorded
--
-- One row per DECIDED hole per GROUPING. A hole with no row has not been
-- entered; a hole with a `tied` row was played and nobody took it. Those two
-- must not render or compute the same way, which is the whole reason `result`
-- exists beside `winner_user_id` — see below.
--
-- ── Nothing that exists can hold this ──────────────────────────────────────
--
-- `match_hole_outcomes` (075) cannot, three ways, each blocking on its own:
--   · `result` is `CHECK (result IN ('side_a','side_b','halved'))` — a closed
--     two-sided enum in which a WINNER is not nameable. `side_a` is a position
--     in a match, not a person.
--   · `match_id` is `NOT NULL REFERENCES game_matches(id)`, and skins has no
--     matches. A `game_matches` row carries exactly two side slots anyway.
--   · the write path re-asserts both — `matchOutcomes.upsertOutcome` zods the
--     same three-value enum and RLS runs through `can_score_match`, which
--     resolves entirely through `game_matches.side_a`/`side_b`.
--
-- `score_entries` cannot either: a winner id is text and `value` is `integer`.
-- The only integer encoding available is "skins won per player per hole", which
-- is a DERIVED result wearing an entry's clothes — and it makes a tied hole and
-- an unplayed hole indistinguishable, which the carryover fold specifically has
-- to tell apart to know whether the pot rolls.
--
-- ── EMPTY IS NOT UNKNOWN, encoded rather than remembered ───────────────────
--
-- A nullable `winner_user_id` alone would make `NULL` mean both "tied" and
-- "nobody has entered this hole", and `sideBets.ts` already names that same
-- distinction explicitly for the same reason ("Carryover survives an UNDECIDED
-- hole rather than resetting on it: a hole left unscored is not a halved hole").
-- So the discriminator is its own column and the pairing is a CHECK, not a
-- convention: `won` requires a winner, `tied` forbids one. A row that says
-- nothing is not insertable.
--
-- ── `grouping_id` is a play_group, FK'd, and that has a consequence ────────
--
-- The grouping IS the competition boundary — one carryover state per grouping,
-- and a tie in one does not touch another's pot. There is no new partition here
-- and `play_groups` keeps meaning exactly what 035 says it means.
--
-- The FK is `ON DELETE CASCADE`, which is the right cascade and NOT a licence to
-- delete groups: `save_game_config`'s groupings clean-replace DELETEs every
-- `play_groups` row and re-inserts with fresh `gen_random_uuid()` ids, so a
-- groupings save would take the recorded skins with it. Migration 185 refuses
-- that save outright once a skins game has outcomes — the guard belongs in the
-- RPC that would do the damage, next to the matchups guard it mirrors, rather
-- than in a trigger here that would also fire on the `games` cascade and make a
-- played game undeletable.
--
-- `submitted_by` is audit only, never a gate — the same contract
-- `score_entries.submitted_by` carries.
--
-- ── The two FKs into `public.users` point in OPPOSITE directions ───────────
--
-- Migration 027's policy is "authorship SET NULL, transient rows CASCADE", and
-- 129 added a coverage guard because `score_entries.submitted_by` had arrived
-- with the DEFAULT (NO ACTION) and made every account that had ever entered a
-- score undeleteable in production (#993). So:
--
--   · `submitted_by`   -> SET NULL. It is authorship. Losing it costs an audit
--                         trail and nothing else.
--   · `winner_user_id` -> NO ACTION, and therefore a DELIBERATELY BLOCKING FK,
--                         declared as such in `userDeleteFks.coverage.test.ts`.
--
-- The second needs its reason stated, because "blocking" reads as the careless
-- option and here it is the considered one. Since migration 130, deleting an
-- ACCOUNT converts the `users` row to a placeholder and never deletes it, so a
-- blocking FK cannot break account deletion. The only thing that still deletes a
-- row is `delete_orphan_guest_user`, which catches `foreign_key_violation` ON
-- PURPOSE — being blocked there is the DESIRED outcome, and the placeholder
-- survives with its history rather than taking it along.
--
-- That is exactly the case here, and it is the `expense_splits` argument in a
-- different currency: a placeholder who won holes is part of what happened in
-- that grouping. CASCADE would delete those rows and turn played holes into
-- unplayed ones — a card with gaps in it, and a grouping whose awarded skins
-- silently stop adding up to what it played for. SET NULL is not available at
-- all: it would violate the `won` half of the result-shape CHECK below, so the
-- delete would fail anyway, and with a far less legible error.
--
-- ── NOT hashed, deliberately ───────────────────────────────────────────────
--
-- `configHash` (#16) fingerprints CONFIG, and score-derived fields are excluded
-- on purpose so entering scores never churns the hash. This table is a score
-- store, exactly like `match_hole_outcomes`, which is likewise absent from
-- `HASH_COLS`. The config half of skins is the GROUPINGS, and `play_groups` is
-- already hashed.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.skins_hole_outcomes (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  grouping_id text NOT NULL REFERENCES public.play_groups(id) ON DELETE CASCADE,
  hole_number integer NOT NULL,
  -- The discriminator. 'won' = one player took the hole outright; 'tied' = it
  -- was played and carried. Absence of a row = not entered.
  result text NOT NULL CHECK (result IN ('won', 'tied')),
  -- NO ACTION (the default, spelled out), which makes this a DELIBERATELY
  -- BLOCKING FK into `public.users` — see the note below.
  winner_user_id text REFERENCES public.users(id) ON DELETE NO ACTION,
  -- SET NULL: authorship, per migration 027's policy. `score_entries.submitted_by`
  -- arrived with the default NO ACTION and made every account that had entered a
  -- score undeleteable (#993, fixed in 129); this is that lesson applied at the
  -- point the column is created rather than after someone hits it.
  submitted_by text REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grouping_id, hole_number),
  CONSTRAINT skins_hole_outcomes_result_shape CHECK (
    (result = 'won'  AND winner_user_id IS NOT NULL) OR
    (result = 'tied' AND winner_user_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_skins_hole_outcomes_game_id
  ON public.skins_hole_outcomes (game_id);

COMMENT ON TABLE public.skins_hole_outcomes IS
  'Who won each hole of a skins game, per grouping. No stroke scores and no handicaps — the group applies strokes in their heads and records the winner. A missing row is an unplayed hole; a row with result=''tied'' is a played hole that carried, and the two must stay distinguishable because the carryover fold branches on it.';

-- ── can_score_skins_grouping ────────────────────────────────────────────────
--
-- "Is the caller in THIS grouping?" — the MEMBER tier only; owner / organizer /
-- delegate are the policy's other OR-branches, exactly as in `score_entries_write`.
--
-- Deliberately NOT a branch of `can_score_unit`. That function answers "may this
-- caller write a score for this PARTICIPANT", and a skins outcome has no
-- participant — it names a grouping and a hole, and its winner is an OUTPUT of
-- the write rather than its subject. `can_score_match` (076) split out from
-- `can_score_unit` for the same reason and says so: an outcome is
-- container-scoped, not participant-scoped, so there is no participant_type
-- dispatch to do.
--
-- It takes the CALLER as its subject, which is what keeps it safe to expose
-- (CLAUDE.md #28): change who is asking and the answer moves. `p_game_id` is
-- carried so the grouping cannot be borrowed from another game.
CREATE OR REPLACE FUNCTION public.can_score_skins_grouping(
  p_game_id text,
  p_grouping_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text := (auth.uid())::text;
BEGIN
  IF me IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM game_participants gp
    JOIN play_groups pg ON pg.id = gp.play_group_id AND pg.game_id = p_game_id
    WHERE gp.game_id = p_game_id
      AND gp.user_id = me
      AND gp.play_group_id = p_grouping_id
  );
END;
$$;

COMMENT ON FUNCTION public.can_score_skins_grouping(text, text) IS
  'Whether an ordinary MEMBER may record a skins hole outcome for this grouping — true only when the caller is in it. Owner/Organizer/delegate bypass this entirely (see skins_hole_outcomes_write). Separate from can_score_unit because a skins outcome names a grouping and a hole, not a participant (migration 184).';

REVOKE ALL ON FUNCTION public.can_score_skins_grouping(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_score_skins_grouping(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_score_skins_grouping(text, text) TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.skins_hole_outcomes ENABLE ROW LEVEL SECURITY;

-- SELECT: any trip member — read parity with `score_entries` and
-- `match_hole_outcomes`. Viewing a card is not the concern.
DROP POLICY IF EXISTS skins_hole_outcomes_select ON public.skins_hole_outcomes;
CREATE POLICY skins_hole_outcomes_select ON public.skins_hole_outcomes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = skins_hole_outcomes.game_id AND public.is_trip_member(g.trip_id)
    )
  );

-- WRITE: the same three-branch shape `score_entries_write` (136) uses —
-- Owner/Organizer, this game's delegate, or a member of the grouping once
-- scoring is enabled. `submitted_by = auth.uid()` in the WITH CHECK mirrors
-- `score_entries_write` too: audit provenance is asserted, not trusted.
DROP POLICY IF EXISTS skins_hole_outcomes_write ON public.skins_hole_outcomes;
CREATE POLICY skins_hole_outcomes_write ON public.skins_hole_outcomes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = skins_hole_outcomes.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_skins_grouping(skins_hole_outcomes.game_id,
                                                  skins_hole_outcomes.grouping_id))
        )
    )
  )
  WITH CHECK (
    skins_hole_outcomes.submitted_by = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = skins_hole_outcomes.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_skins_grouping(skins_hole_outcomes.game_id,
                                                  skins_hole_outcomes.grouping_id))
        )
    )
  );

-- ── _reset_game_scoring must delete these ───────────────────────────────────
--
-- Migration 125's entire argument, arriving one table later. Its level-1 model
-- is "the game as it was when READY: fully configured, nothing played", and 125
-- had to ADD `match_hole_outcomes` to it because those rows ARE the score in
-- outcome mode and were reachable by no cascade at that level. Migration 162
-- then had to add pick'em for the same reason, calling it "the sixth shape".
-- This is the seventh, and it is the same case exactly: it is the whole of a
-- skins game's score, and level 1 does not delete `play_groups`, so nothing
-- would take it away.
--
-- Getting this wrong would also DEADLOCK the groupings guard migration 185
-- adds: skins outcomes that "Reset scores" cannot clear would freeze the
-- groupings of that game forever, and the refusal would name an action the
-- reader had already taken.
--
-- Body is 162's, verbatim, with one DELETE added — generated from that file
-- rather than transcribed, and diffed to prove the addition is the only change.
-- The first hand-typed attempt reproduced 125's body instead and silently
-- dropped #895's go-live triple, which is why this is worth saying.
CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $reset$
BEGIN
  -- Everything PLAYED, in every shape it is stored in (125, 162).
  DELETE FROM public.game_results        WHERE game_id = p_game_id;
  DELETE FROM public.score_entries       WHERE game_id = p_game_id;
  DELETE FROM public.match_hole_outcomes WHERE game_id = p_game_id;
  -- The whole of a SKINS game's score (184). Same case as the line above:
  -- these rows ARE the score for this format, and they cascade only via
  -- `play_groups`, which level 1 does not delete.
  DELETE FROM public.skins_hole_outcomes WHERE game_id = p_game_id;

  -- The sixth shape (159). A pick'em game stores its outcomes HERE and nowhere
  -- above — no score_entries, no match_hole_outcomes — so omitting it made this
  -- sweep a no-op on the entire format.
  UPDATE public.pickem_slate_games
     SET result = NULL
   WHERE game_id = p_game_id;

  UPDATE public.game_matches
     SET result = NULL, margin = NULL, status = 'pending'
   WHERE game_id = p_game_id;

  UPDATE public.bracket_matches
     SET winner_entrant_id = NULL
   WHERE game_id = p_game_id;

  -- The go-live triple, kept consistent (#895 / #25). `status` follows the
  -- switch rather than being forced to 'pending' beside an enabled game.
  UPDATE public.games
     SET corrections_open = false,
         status = CASE WHEN scoring_enabled THEN 'active' ELSE 'pending' END
   WHERE id = p_game_id;
END;
$reset$;
-- ── merge_guest_to_real_user must know about the two person columns ────────
--
-- CLAUDE.md's standing rule, and the direction that fails SILENTLY: the merge
-- ends by DELETEing the guest, so a person-reference it does not cover is either
-- cascade-deleted or nulled with nothing raised. `winner_user_id` CASCADEs, so a
-- placeholder who won holes would have those holes vanish from the card the
-- moment they signed up — and every pot downstream of them would recompute to a
-- different answer, which is worse than a missing name because it looks correct.
--
-- Body is 146's, verbatim, with one block added — generated and diffed, same as
-- the reset above.
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

  -- Skins hole winners — NEW (migration 184). `winner_user_id` CASCADEs, so
  -- without this a placeholder's won holes are DELETED at signup, and the
  -- carryover downstream of them then recomputes to a different answer. No
  -- collision handling, and that is checked rather than assumed: the only
  -- UNIQUE key on the table is (grouping_id, hole_number), which carries no
  -- user id, so the guest and the real account cannot both hold one.
  UPDATE public.skins_hole_outcomes SET winner_user_id = p_real_id WHERE winner_user_id = p_ghost_id;
  UPDATE public.skins_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

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

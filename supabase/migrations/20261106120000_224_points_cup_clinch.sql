-- 224 · A points cup's clinch can name a person, and a tie can be broken.
--
-- WHAT CHANGES (docs/CLINCH_AND_PODIUM.md §4 and §5, one file as the spec asks):
--   - competitions.clinch_notified_user_id: the push claim for a teamless race,
--     whose units are people. At most one of it and clinch_notified_team_id is
--     set (a CHECK).
--   - claim_clinch_notification_user / release_clinch_claim_user: the same
--     compare-and-swap as migration 107, on the new column.
--   - competitions.tiebreak_order: unit ids (teams, or people in a teamless race)
--     in the order an Owner or Organizer set. Read only to order units that are
--     exactly tied at final. It has no effect on points.
--   - merge_guest_to_real_user learns both, in the same migration, because a guest
--     can be a teamless race's unit.
--
-- WHY A SECOND COLUMN: clinch_notified_team_id has a foreign key to teams (migration
-- 099), so a person could never be claimed. Dropping that key would lose the
-- ON DELETE SET NULL recovery it gives a deleted team, so the person gets a column
-- of its own with the same recovery. text, per the app-wide text-PK convention:
-- users.id is text, and a uuid FK onto it errors at migration time.
--
-- REVERSES nothing, and widens one thing: migration 107's claim also clears the
-- person column now, so the CHECK cannot refuse a team claim on a competition that
-- once held a person's. A race plays as teams or people and its first result locks
-- which, so that is a backstop rather than a path anyone takes.
--
-- SAFE TO ADD: both columns are nullable with no default, so this rewrites no row,
-- and the CHECK holds for every existing row because the new column is null.
-- Additive and idempotent, and it replays cleanly from zero.

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS clinch_notified_user_id text,
  ADD COLUMN IF NOT EXISTS tiebreak_order text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitions_clinch_notified_user_id_fkey'
      AND conrelid = 'public.competitions'::regclass
  ) THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_clinch_notified_user_id_fkey
      FOREIGN KEY (clinch_notified_user_id)
      REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitions_clinch_notified_one_unit'
      AND conrelid = 'public.competitions'::regclass
  ) THEN
    ALTER TABLE public.competitions
      ADD CONSTRAINT competitions_clinch_notified_one_unit
      CHECK (num_nonnulls(clinch_notified_team_id, clinch_notified_user_id) <= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.competitions.clinch_notified_user_id IS
  'Push bookkeeping ONLY: the person a "cup clinched" notification has already been '
  'sent for, in a teamless race. The people counterpart of clinch_notified_team_id; '
  'at most one of the two is set. Clinch STATE stays derived and is never stored.';

COMMENT ON COLUMN public.competitions.tiebreak_order IS
  'Unit ids (team ids, or user ids in a teamless race) in the order an Owner or '
  'Organizer set after a tiebreaker. Read only to order units exactly tied at final; '
  'it has no effect on points. Null means ties stand as shared places.';

create or replace function public.claim_clinch_notification(
  p_competition_id text,
  p_team_id text
)
returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  update public.competitions
     set clinch_notified_team_id = p_team_id,
         clinch_notified_user_id = null
   where id = p_competition_id
     and clinch_notified_team_id is distinct from p_team_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Claim the right to announce a PERSON as the clincher. TRUE exactly once per
-- (competition, person) until released. Migration 107 has the reasoning: the
-- predicate sits in one statement's WHERE because a compare-and-swap is falsified
-- by the write it guards.
create or replace function public.claim_clinch_notification_user(
  p_competition_id text,
  p_user_id text
)
returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  update public.competitions
     set clinch_notified_user_id = p_user_id,
         clinch_notified_team_id = null
   where id = p_competition_id
     and clinch_notified_user_id is distinct from p_user_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Release a person's claim the caller still believes is held: a compare-and-swap,
-- so a stale releaser cannot wipe a fresh claim.
create or replace function public.release_clinch_claim_user(
  p_competition_id text,
  p_expected_user_id text
)
returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  update public.competitions
     set clinch_notified_user_id = null
   where id = p_competition_id
     and clinch_notified_user_id = p_expected_user_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.claim_clinch_notification_user(text, text) from public, anon, authenticated;
revoke execute on function public.release_clinch_claim_user(text, text) from public, anon, authenticated;
grant execute on function public.claim_clinch_notification_user(text, text) to service_role;
grant execute on function public.release_clinch_claim_user(text, text) to service_role;

-- The guest merge, verbatim from migration 209 but for the competitions block.
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Without this the row CASCADES away with the guest and the entrant loses a
  -- member by ACCIDENT: a signup is not a departure. (A partner who LEAVES is a
  -- different case, and there the remaining partner plays on — ruling 8,
  -- migration 209 — so a one-member entrant is not itself the fault. This
  -- comment used to call it one, which the ruling reversed.)
  DELETE FROM public.bracket_entrant_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.bracket_entrant_members r
                  WHERE r.entrant_id = g.entrant_id AND r.user_id = p_real_id);
  UPDATE public.bracket_entrant_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Polymorphic (type,id) pairs — user-typed rows ONLY; team / play_group rows
  -- are a different identity space and must not be touched.
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  -- UNIQUE (game_id, entity_type, entity_id) — 194. The placeholder and the
  -- real account can both have a result in one game (both were added to it;
  -- game_participants above handles the same case). The real account's row
  -- wins, as it does for every other collision here — without this the UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails.
  DELETE FROM public.game_results g
   WHERE g.entity_type = 'user' AND g.entity_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_results r
                  WHERE r.game_id = g.game_id AND r.entity_type = 'user' AND r.entity_id = p_real_id);
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

  -- Credited rosters — NEW (migration 203). The person is a KEY of
  -- `games.credited_roster`, unreachable by `SET col = value` just like the
  -- match sides above. If the guest and the real account are BOTH keys (both
  -- were on the cup roster when the game finalized), the real account's entry
  -- wins, as it does for every other collision here; otherwise the guest's
  -- team moves to the real account. Without this a placeholder's finished
  -- games would credit the real person as teamless on their next re-finalize.
  UPDATE public.games
     SET credited_roster = CASE
           WHEN credited_roster ? p_real_id THEN credited_roster - p_ghost_id
           ELSE (credited_roster - p_ghost_id)
                || jsonb_build_object(p_real_id, credited_roster -> p_ghost_id)
         END
   WHERE credited_roster ? p_ghost_id;

  -- Re-credits — NEW (migration 204). Both person columns: the person whose
  -- credit moved, and the Owner who moved it. No collision handling, checked
  -- rather than assumed: the table's only UNIQUE key is its `id`.
  UPDATE public.game_recredits SET user_id       = p_real_id WHERE user_id       = p_ghost_id;
  UPDATE public.game_recredits SET recredited_by = p_real_id WHERE recredited_by = p_ghost_id;

  -- Trip departures — NEW (migration 205). PK (trip_id, user_id): when both
  -- the guest and the real account have left the same trip, the real
  -- account's record wins, as every other collision here; otherwise the
  -- guest's departure moves to the real account. Without this the guest's
  -- deletion below CASCADEs the record away and their history loses its name.
  DELETE FROM public.trip_departures g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.trip_departures r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.trip_departures SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Pick'em sheets — NEW (migration 146). Delegated so the sheet-level
  -- collision rule (whole sheets, not rows: pickem_picks carries TWO unique
  -- keys, and a row-wise merge can satisfy one while breaking the other) keeps
  -- its explanation next to the code that implements it.
  PERFORM public.merge_guest_pickem_picks(p_ghost_id, p_real_id);

  -- Competitions — NEW (migration 224). A teamless race's unit is a person, so a
  -- guest can hold its clinch claim and sit in its tiebreak order. The claim's FK
  -- would otherwise null it at the DELETE below, and the same clinch would be
  -- announced twice. tiebreak_order is a text[] no FK sees: if both accounts are
  -- in it, the real account's position stands and the guest's goes, so one person
  -- never holds two places.
  UPDATE public.competitions SET clinch_notified_user_id = p_real_id WHERE clinch_notified_user_id = p_ghost_id;
  UPDATE public.competitions
     SET tiebreak_order = CASE
           WHEN p_real_id = ANY (tiebreak_order) THEN array_remove(tiebreak_order, p_ghost_id)
           ELSE array_replace(tiebreak_order, p_ghost_id, p_real_id)
         END
   WHERE p_ghost_id = ANY (tiebreak_order);

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_guest_to_real_user(text, text) FROM PUBLIC, anon, authenticated;

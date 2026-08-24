-- 142: delete_orphan_guest_user must see a match SEAT, which no foreign key can
--
-- ── What this reverses, and why now (rule 5) ────────────────────────────────
--
-- Migration 016 created `delete_orphan_guest_user` to free a removed guest's
-- email for reuse. Its guard is `NOT EXISTS (trip_members)` plus an
-- `EXCEPTION WHEN foreign_key_violation` arm, and 131's comment restates the
-- reasoning: a guest who "still holds history a foreign key can see" keeps
-- their `users` row.
--
-- That is a precise description of the guard AND of its blind spot. The one
-- reference to a person that NO foreign key can see is the match seat:
-- `game_matches.side_a/side_b` store `{type,id}` inside JSONB, so there is no
-- constraint to violate and no cascade to fire. The delete therefore succeeds
-- and leaves a side ref naming a `users` row that no longer exists.
--
-- ── The failure it produces is silent until a save, then illegible (#1032) ──
--
-- A dangling seat renders as the `?? "Player"` fallback (#952/#1016) and is
-- otherwise invisible. The bite comes later: `save_game_config`'s
-- clean-replace calls `_write_game_side`, which INSERTs a `game_participants`
-- row for every side it writes, and that DOES have a foreign key —
--
--   insert or update on table "game_participants" violates foreign key
--   constraint "game_participants_user_id_fkey"
--
-- — a raw Postgres error carrying no `CODE:` prefix, so `games.saveConfig`'s
-- unwrap regex misses it and the person is told "That change couldn't be
-- saved. Reload and try again." Reloading cannot help; the row is still there.
-- Observed in production: an owner deleting the visibly-broken match was
-- refused because of a SECOND, invisibly-broken one.
--
-- ── Why the FUNCTION and not the caller ────────────────────────────────────
--
-- Its only caller, `ghostCrew.remove`, already runs `clearTripParticipation`
-- first and its comment says exactly why: "The match SEAT is not covered by
-- the cascade at all in either case — a `{type,id}` inside JSONB is invisible
-- to every FK." So the invariant is currently held by ONE caller remembering
-- to vacate first, while the function that can violate it does not know about
-- it — CLAUDE.md #24's shape, and the reason the same bug keeps being found in
-- a new place. A second caller, or a direct RPC call, reintroduces it.
--
-- Refuse rather than vacate, deliberately: refusing keeps the `users` row,
-- which is the SAME outcome the existing foreign_key_violation arm produces
-- and the same one migration 130 chose for account deletion. Vacating here
-- would make a cleanup function silently edit a game's pairings, which is the
-- caller's decision to take, not this function's.
--
-- ── Not the cause of the production orphan, and that is worth writing down ──
--
-- The one dangling ref found in production (repaired by hand, 2026-08-24) was
-- NOT produced by this path. It came from the OLD `handle_user_delete`, which
-- hard-deleted `public.users` and let the FK children cascade while the JSONB
-- ref survived. Migration 130 replaced that with placeholder conversion, so
-- that route is already closed — evidence: `users.deleted_at IS NOT NULL`
-- counts ZERO in production, meaning no account has been deleted since 130
-- landed, and the orphaned match was created 2026-08-19 13:25, hours before
-- 130's own timestamp.
--
-- So this migration closes a hole that is currently REACHABLE but has not yet
-- been walked, rather than the one that already was. Stated plainly so nobody
-- later reads it as the fix for the incident and concludes the incident's own
-- cause is still open.

CREATE OR REPLACE FUNCTION public.delete_orphan_guest_user(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_guest = true
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_members tm WHERE tm.user_id = p_user_id
      )
      -- The seat no FK can see. Checked for BOTH sides, and only for
      -- `type = 'user'`: a doubles side names a `play_group`, whose own id is
      -- never a users id, so comparing it here would be comparing two id
      -- spaces that cannot collide.
      AND NOT EXISTS (
        SELECT 1 FROM public.game_matches gm
         WHERE (gm.side_a ->> 'type' = 'user' AND gm.side_a ->> 'id' = p_user_id)
            OR (gm.side_b ->> 'type' = 'user' AND gm.side_b ->> 'id' = p_user_id)
      );
EXCEPTION
  WHEN foreign_key_violation THEN
    -- They still hold history a foreign key CAN see: an expense they paid for,
    -- a split they are part of (both ON DELETE RESTRICT, migration 131), or a
    -- score they submitted. Keep the users row — the placeholder survives with
    -- its history intact, which is the same outcome account deletion produces
    -- (migration 130). The trip removal the owner performed still stands.
    --
    -- NOT a catch-all: only foreign_key_violation is swallowed, so any other
    -- failure still surfaces. The seat check above is a WHERE clause rather
    -- than another exception arm precisely because it raises nothing to catch.
    NULL;
END;
$function$;

-- ── Reachable by anon, which is what makes the caller-side invariant moot ───
--
-- Postgres grants EXECUTE to PUBLIC by default, and migration 016 added
-- `authenticated` on top without revoking it — so this SECURITY DEFINER
-- function, which deletes rows, was callable by `anon`. That is the same
-- REVOKE-FROM-PUBLIC shape the 2026-08-20 RLS audit closed elsewhere, and it
-- is in scope here rather than filed separately: a guard that lives in the
-- function is only worth more than a guard that lives in the caller if the
-- function cannot be invoked by someone the caller never routed through.
REVOKE ALL ON FUNCTION public.delete_orphan_guest_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_orphan_guest_user(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_orphan_guest_user(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_orphan_guest_user(text) TO service_role;

-- 078 · Guest-merge: reassign the four SCORING tables (audit finding #5, PRE-LAUNCH).
--
-- merge_guest_to_real_user runs inside the handle_new_user signup trigger. It
-- reassigned 10 tables but OMITTED the game-scoring tables — a signup-breaking gap,
-- not just stranded history, because the final ghost DELETE hits these FKs:
--   * game_participants.user_id  -> users  ON DELETE CASCADE
--       Without reassigning first, the ghost's participant rows are SILENTLY
--       DELETED on merge (the game loses them + their derived match/rack state).
--   * score_entries.submitted_by -> users  ON DELETE NO ACTION (RESTRICT-like)
--       If the guest ever SUBMITTED a score, the ghost DELETE is BLOCKED -> the
--       function raises -> handle_new_user raises -> the signup transaction rolls
--       back -> the real account is never created. A guest who scored one hole
--       cannot sign up. This maps exactly onto BBMI (guests score, then sign up).
--   * score_entries.participant_id / game_results.entity_id / match_hole_outcomes
--       .submitted_by  (no FK) -> stranded/dangling under the ghost id.
--
-- FIX: reassign all five guest-user columns BEFORE the DELETE, in lockstep with the
-- existing 10 (all-or-nothing: a plpgsql function body is one transaction, so any
-- failure rolls the whole merge back — the CLAUDE.md guest-merge rule).
--
-- POLYMORPHIC SAFETY (audit #2/#3): score_entries.participant_id and
-- game_results.entity_id are polymorphic (participant_type ∈ user|play_group;
-- entity_type ∈ user|team|play_group). Reassign ONLY the user-typed rows — never
-- rewrite a play_group participant or a team-entity result. game_participants.team_id
-- (the no-FK column, audit #4) is deliberately NOT touched here.
--
-- CONFLICT-SAFETY: handle_new_user creates the real user IMMEDIATELY BEFORE calling
-- this, so p_real_id owns ZERO rows at merge time. Plain UPDATEs therefore cannot
-- violate the unique indexes (game_participants(game_id,user_id),
-- score_entries(game_id,participant_id,unit_label); match_hole_outcomes(match_id,
-- hole_number) isn't even user-keyed). This is the SAME invariant the existing 10
-- UPDATEs already rely on (none use ON CONFLICT).
--
-- SECURITY: preserves SECURITY DEFINER + `SET search_path = ''`. CREATE OR REPLACE
-- keeps the mig-066 ACL, but we re-assert the REVOKE below to keep this migration
-- self-contained (a SECURITY DEFINER core must never be PUBLIC/anon/authenticated-
-- executable).

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- ── existing reassignments (unchanged) ────────────────────────────────────
  UPDATE public.trip_members     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_votes       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes  SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.messages         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses         SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.quick_info_tiles SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.users            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.invites          SET created_by      = p_real_id WHERE created_by      = p_ghost_id;

  -- ── NEW: game-scoring reassignments (audit #5) — MUST precede the DELETE ───
  -- Rostered participation (its CASCADE FK would otherwise delete these rows).
  UPDATE public.game_participants   SET user_id        = p_real_id WHERE user_id        = p_ghost_id;
  -- Per-hole scores: the scored identity (user-typed rows ONLY; play_group rows are
  -- left untouched) + the submitter/audit column (whose NO ACTION FK is what would
  -- otherwise BLOCK the ghost delete and break signup).
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  -- Final per-entity results (user-typed rows ONLY; team / play_group untouched).
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type = 'user';
  -- Match-play per-hole outcome submitter/audit column.
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- ── remove the now-empty ghost ────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

-- Re-assert the SECURITY DEFINER lockdown (mig 066) — self-contained, idempotent.
REVOKE EXECUTE ON FUNCTION public.merge_guest_to_real_user(text, text) FROM PUBLIC, anon, authenticated;

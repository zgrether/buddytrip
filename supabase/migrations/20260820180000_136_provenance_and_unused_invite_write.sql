-- 136 — you cannot sign a score as somebody else, and nobody can rewrite an
-- invite through a policy no procedure has ever used.
--
-- Closes F3, F6 and F7 of the RLS audit. One theme: each is a policy admitting
-- a write that NO procedure makes. That is the #985 shape — the callers were
-- always right, the policies were simply wider than them, and nothing failed
-- because the app never did the thing they permitted.
--
-- ══ F3 — `invites` was writable by any member of the trip ═════════════════
--
--   "system can update invites"  FOR UPDATE TO public  USING (true)
--
-- From `001_initial_schema.sql`; never revisited in the 135 migrations since.
-- The name says what it was for — the signup trigger stamping `accepted_at` —
-- but `handle_new_user` is SECURITY DEFINER and has never needed a policy to
-- do it. The policy served nothing and admitted everything.
--
-- Probed: a plain Member rewrote their own trip's invite — `role` Member →
-- Organizer, `email` redirected to an address they controlled, `accepted_at`
-- cleared, token readable. Anon and non-members were refused, but only because
-- the SELECT policy wouldn't surface the row to find; nothing about the UPDATE
-- policy itself stopped them.
--
-- Every production write to `invites` was enumerated before dropping this, and
-- there are exactly three, all INSERT or SELECT:
--   inviteLink.resolveInviteLink   SELECT (service role)
--   inviteToken.ensureInviteToken  SELECT + INSERT   ← added by #999 AFTER the
--                                                      audit; re-checked here
--   tripMembers.inviteByEmail      INSERT
-- Not one UPDATE. Dropping the policy therefore removes a capability nothing
-- uses: with no UPDATE policy, RLS refuses the verb outright, and the signup
-- trigger is untouched because SECURITY DEFINER does not consult policies.
--
-- Deliberately a DROP rather than a narrowing. A tightened UPDATE policy would
-- be a rule about who may do something nobody does — inventing a permission to
-- constrain it. If a real invite-editing feature ever lands it can add the
-- policy it actually needs, and will have to say who may use it.
--
-- ══ F6 / F7 — `submitted_by` was forgeable ═══════════════════════════════
--
-- Probed: a member wrote a legitimate score for their own unit while stamping
-- `submitted_by` as the trip Owner. The write policies never mentioned the
-- column, so any value passed.
--
-- Provenance here is deliberate, not incidental — migration 129 exists purely
-- to preserve it across an account deletion ("the score survives, the
-- provenance does not... any reader must tolerate a null submitter"). A column
-- worth a migration to keep honest is worth refusing a forged value.
--
-- Both writers set it to the acting user and there are only two, both
-- user-scoped: `scores.upsertEntry` and `matchOutcomes.upsertHoleOutcome`.
--
-- ── WITH CHECK only, never USING — the part that would have broken things ──
--
-- These are FOR ALL policies, so the same expression currently serves both
-- clauses. The new term goes in WITH CHECK ONLY, because USING governs which
-- EXISTING rows a caller may reach:
--
--   • an Owner correcting or deleting a member's score reaches a row whose
--     `submitted_by` is that member — adding the term to USING would refuse it
--   • migration 129 leaves `submitted_by` NULL on rows whose submitter deleted
--     their account; those rows must stay correctable
--
-- Both would have failed as a permission error on a legitimate action, which
-- is the failure mode worth avoiding: the audit's own rule is that a policy
-- should match its callers, and over-tightening misses it in the other
-- direction. The DELETE paths are unaffected for the same reason — DELETE
-- consults USING alone.
--
-- The upserts re-stamp `submitted_by` to the acting user on conflict, so a
-- staff correction records the corrector and satisfies the check. Verified by
-- probe rather than by reading the upsert.

-- ── F3 ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "system can update invites" ON public.invites;

COMMENT ON TABLE public.invites IS
  'Invitations to a trip. Deliberately has NO update policy: nothing in the app updates an invite, and the one UPDATE that exists (handle_new_user stamping accepted_at) is SECURITY DEFINER and bypasses RLS. The policy dropped here was FOR UPDATE TO public USING (true) — from migration 001, unused for its whole life, and enough for any member to rewrite their trip''s invites (migration 136, closing audit F3).';

-- ── F6 ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS score_entries_write ON public.score_entries;
CREATE POLICY score_entries_write ON public.score_entries
  AS PERMISSIVE FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = score_entries.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_unit(score_entries.game_id,
                                        score_entries.participant_id,
                                        score_entries.participant_type))
        )
    )
  )
  WITH CHECK (
    score_entries.submitted_by = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = score_entries.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_unit(score_entries.game_id,
                                        score_entries.participant_id,
                                        score_entries.participant_type))
        )
    )
  );

COMMENT ON POLICY score_entries_write ON public.score_entries IS
  'Unchanged on who may write (staff, game delegate, or a member scoring their own unit on a scoring-enabled game). Adds, to WITH CHECK only, that a row must be signed by the caller — submitted_by was previously unconstrained, so a member could attribute their score to the Owner. WITH CHECK only is deliberate: USING governs which existing rows are reachable, and staff must still correct or delete a score somebody else submitted, including one whose submitter has since deleted their account and left it NULL (migration 136, closing audit F6).';

-- ── F7 ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS match_hole_outcomes_write ON public.match_hole_outcomes;
CREATE POLICY match_hole_outcomes_write ON public.match_hole_outcomes
  AS PERMISSIVE FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_match(match_hole_outcomes.game_id,
                                         match_hole_outcomes.match_id))
        )
    )
  )
  WITH CHECK (
    match_hole_outcomes.submitted_by = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.games g
      WHERE g.id = match_hole_outcomes.game_id
        AND public.is_trip_member(g.trip_id)
        AND (
          public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
          OR public.is_game_delegate(g.id)
          OR (g.scoring_enabled = true
              AND public.can_score_match(match_hole_outcomes.game_id,
                                         match_hole_outcomes.match_id))
        )
    )
  );

COMMENT ON POLICY match_hole_outcomes_write ON public.match_hole_outcomes IS
  'The match-play twin of score_entries_write, and closed for the same reason: submitted_by was unconstrained, so a hole result could be signed as somebody else. Same WITH CHECK-only placement, same reason — staff correction and deletion read USING (migration 136, closing audit F7, which the audit could only read from the policy text).';

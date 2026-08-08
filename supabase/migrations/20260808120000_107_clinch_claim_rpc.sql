-- 107 · Move the clinch-notification compare-and-swap into Postgres.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- The claim was a PostgREST mutation carrying its own CAS predicate as a filter:
--
--   .update({ clinch_notified_team_id: teamId })
--   .eq("id", competitionId)
--   .or("clinch_notified_team_id.is.null,clinch_notified_team_id.neq.<team>")
--   .select("id")
--
-- On the DEPLOYED PostgREST, a mutation's `or=(…)` filter is applied in the
-- scope of the RETURNING projection, not the UPDATE's WHERE. That makes this
-- shape unable to work, in two different ways depending on the select:
--
--   select=id                      → 42703, "column competitions.
--                                    clinch_notified_team_id does not exist",
--                                    naming a column that plainly exists
--   select=id,clinch_notified_…    → no error, but ZERO rows returned: after
--                                    `SET clinch_notified_team_id = teamId` the
--                                    row no longer satisfies `IS NULL OR <>
--                                    teamId`, so the projection filters out the
--                                    very row just written
--
-- The second is worse than the first. The write LANDS and reports itself as
-- lost, so the caller reads it as "already claimed" and sends nothing — a
-- silent false negative where there had been a loud error. Both were observed
-- in production, in that order.
--
-- The predicate is falsified BY THE WRITE IT GUARDS. That is not a bug in the
-- filter; it is what a compare-and-swap means. A CAS cannot be expressed as a
-- post-image filter at all, so it does not belong in PostgREST.
--
-- Note this NEVER failed in any test: the identical request returns rows on the
-- local stack's PostgREST 14.5 and misbehaves on the deployed one. Verified in
-- both directions. Doing the CAS in SQL removes the version-dependence along
-- with the bug — `IS DISTINCT FROM` is exactly the intent, expressed natively,
-- with no filter-encoding layer to reinterpret it.
--
-- ── Exactly-once is preserved, and is the whole point ────────────────────────
-- A single UPDATE with the predicate in its WHERE is atomic: concurrent callers
-- serialize on the row, and exactly one sees a non-zero row count. That is the
-- property migration 099 introduced and #839/#841 depend on; this changes where
-- it is enforced, not what it guarantees.
--
-- Both functions are additive and idempotent (CREATE OR REPLACE), and replay
-- cleanly from zero.

-- Claim the right to announce `p_team_id` as the clincher.
-- TRUE exactly once per (competition, team) until released.
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
  -- `IS DISTINCT FROM` is null-safe: it is TRUE when the column is NULL (the
  -- state every FIRST clinch starts in) and TRUE when it holds a different
  -- team. A bare `<>` would be NULL — and therefore not matched — for the null
  -- case, silently losing every first claim.
  update public.competitions
     set clinch_notified_team_id = p_team_id
   where id = p_competition_id
     and clinch_notified_team_id is distinct from p_team_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Release a claim the caller still believes it holds.
-- The expected value makes this a compare-and-swap too, NOT a blind clear: a
-- stale releaser whose view of the row has been overtaken must lose, or it
-- would wipe a fresh claim and let one clinch announce twice (the race
-- `reconcileClinchClaim.test.ts` pins).
create or replace function public.release_clinch_claim(
  p_competition_id text,
  p_expected_team_id text
)
returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  -- Plain `=` is correct here, unlike the claim's `IS DISTINCT FROM`: the
  -- caller only ever invokes this with a non-null observed value, and there is
  -- nothing to release when the column is already NULL.
  update public.competitions
     set clinch_notified_team_id = null
   where id = p_competition_id
     and clinch_notified_team_id = p_expected_team_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Supabase auto-grants EXECUTE to PUBLIC on new functions, which would put the
-- cup's announcement bookkeeping in reach of any authenticated caller. Revoke,
-- then grant only the role that actually runs these — the notify path is
-- service-role by nature (it reads other users' prefs and subscriptions, which
-- own-row RLS cannot express).
revoke execute on function public.claim_clinch_notification(text, text) from public, anon, authenticated;
revoke execute on function public.release_clinch_claim(text, text) from public, anon, authenticated;
grant execute on function public.claim_clinch_notification(text, text) to service_role;
grant execute on function public.release_clinch_claim(text, text) to service_role;

comment on function public.claim_clinch_notification(text, text) is
  'Atomic CAS for the clinch announcement claim (migration 107). Replaces a PostgREST or() filter that could not express a compare-and-swap: on the deployed PostgREST the filter is applied to the post-update projection, so the write always excluded the row it had just written.';
comment on function public.release_clinch_claim(text, text) is
  'Atomic conditional release of the clinch claim (migration 107). Expected-value guard keeps a stale releaser from wiping a fresh claim.';

-- 143: the un-guarded SECURITY DEFINER functions are not callable by anon
--
-- ── The one that matters: `_write_game_results` ────────────────────────────
--
-- PROVEN EXPLOITABLE against a local stack before this migration was written.
-- An UNAUTHENTICATED caller, holding only the publishable anon key (which ships
-- in the client bundle and is public by design), wrote a `game_results` row:
--
--   POST /rest/v1/rpc/_write_game_results   → 204
--   game_results: sec-res-1 | user | pos=1 | raw=99
--
-- `game_results` is what `computeCompetitionLeaderboard` rolls up, so this is
-- standings manipulation by anyone who can read the JS bundle — no membership,
-- no session, no trip.
--
-- The shape is a near-miss, not an oversight of the whole pattern. The
-- wrapper/core split is CORRECT and deliberate: `write_game_results` calls
-- `assert_game_edit` and then delegates to `_write_game_results`, which carries
-- no identity check of its own because it is only ever meant to be reached
-- through that wrapper. The sibling cores are locked exactly as intended —
--
--   _reset_game_scoring      → postgres=X  service_role=X
--   _reset_game_to_skeleton  → postgres=X  service_role=X
--   _write_game_results      → postgres=X  service_role=X  anon=X   ← the bug
--
-- — so the anomaly is a grant to `anon` on a function that is not even granted
-- to `authenticated`. Nothing wants that combination; it can only be a slip.
-- Confirmed by contrast at the wire: as anon, `_reset_game_scoring` returns
-- 401 and `_write_game_results` returned 204.
--
-- The wrapper keeps working. It is SECURITY DEFINER and owned by `postgres`,
-- so it executes the core as the owner and never consults the caller's grants.
-- `_write_game_results` has no application caller of its own (grep: none).
--
-- ── The other four: no identity check, and no reason to be public ──────────
--
-- Found by the same sweep — public SECURITY DEFINER functions that establish
-- no caller identity and were reachable by `anon`/PUBLIC:
--
--   increment_member_email_count  writes  — bumps per-member email counters
--   record_api_call               writes  — the golf-course API daily cap;
--                                           an anon caller can burn the quota
--   trip_has_any_member           reads   — "is this trip empty?", which is a
--                                           claiming primitive while #991 is
--                                           open (no ownership column, so a
--                                           zero-member trip can be claimed)
--   user_delete_blocking_fks      reads   — schema metadata
--
-- All four are called only from authenticated tRPC procedures, or from a policy
-- scoped to `{authenticated}` (`trip_members_insert` uses
-- `trip_has_any_member`), so `authenticated` keeps EXECUTE and nothing else
-- needs it.
--
-- ── What this migration deliberately does NOT do ───────────────────────────
--
-- It does not strip PUBLIC/anon from the ~20 OTHER public SECURITY DEFINER
-- functions that also carry the default PUBLIC grant. Those all establish
-- identity internally (`assert_game_edit`, `is_trip_member`, `has_trip_role`,
-- the reset wrappers, `save_game_config`, …), so a PUBLIC grant on them is
-- defence-in-depth rather than a live hole — `auth.uid()` is NULL for anon and
-- every one of them refuses.
--
-- And revoking `anon` from them is NOT free, which is the finding that scoped
-- this migration. Many RLS policies are declared `TO PUBLIC` (the default when
-- no `TO` clause is written) and call those same helpers — `score_entries_write`
-- calls `is_trip_member` / `has_trip_role` / `is_game_delegate` / `can_score_unit`,
-- and there are 23 such pairings. For a role that can reach the table at all,
-- losing EXECUTE turns policy evaluation into an ERROR rather than an empty
-- result, so a blanket revoke risks converting silent no-ops into 500s on paths
-- nobody has enumerated. That deserves its own change with its own verification,
-- not a rider on a security fix that needs to ship.

-- ── The proven hole ────────────────────────────────────────────────────────
-- Match the sibling cores exactly: owner + service_role, nothing else.
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) TO service_role;

-- ── The four with no identity check ───────────────────────────────────────
REVOKE ALL ON FUNCTION public.increment_member_email_count(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_member_email_count(text, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.increment_member_email_count(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_member_email_count(text, text[]) TO service_role;

REVOKE ALL ON FUNCTION public.record_api_call(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_api_call(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_api_call(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_api_call(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.trip_has_any_member(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_has_any_member(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_has_any_member(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trip_has_any_member(text) TO service_role;

REVOKE ALL ON FUNCTION public.user_delete_blocking_fks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_delete_blocking_fks() FROM anon;
GRANT EXECUTE ON FUNCTION public.user_delete_blocking_fks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_delete_blocking_fks() TO service_role;

-- 212 · `_public_relations()` — what is in `public`, read from the migrated schema (#1440)
--
-- Two guards need the relations that ACTUALLY exist once every migration has
-- run, not the migration text:
--
--   1. EVERY VIEW IS `security_invoker`. A view owned by `postgres` (which
--      bypasses RLS) runs as its owner unless it says otherwise, so a view
--      without the option hands every trip's rows to whoever can select from
--      it — and with the Data API grants, that includes the anonymous key. And
--      the option is fragile: a `CREATE OR REPLACE VIEW` without
--      `WITH (security_invoker = true)` RESETS it to owner security (confirmed
--      on the local stack, PostgreSQL 17.6, 2026-09-25). A remembered rule
--      cannot see a later migration dropping the clause; this reads the setting.
--      A MATERIALIZED view can never be invoker-security — it stores its rows,
--      and RLS never sees the read — so none may exist in `public` at all.
--   2. THE GRANTS GUARD'S CONTROL. `migrationGrants.guard.test.ts` parses the
--      migrations for the tables a replay ends with and checks each states its
--      grants (migration 211, and every CREATE TABLE after it). A parser that
--      silently missed a table would pass; comparing its list with this one
--      makes a miss fail.
--
-- The issue designed this as `_public_views()`; it reads every relation kind
-- instead, so the one function serves both guards. Same shape as
-- `_broadcast_triggers()` (migration 192):
--   - SECURITY INVOKER: run as `service_role`, a plain read of `pg_class` sees
--     every relation; DEFINER would be a stronger privilege for nothing
--     (CLAUDE.md #28).
--   - `security_invoker` read through `pg_options_to_table`, cast to boolean,
--     so `true` / `on` / `1` / `yes` all count and no one spelling is matched.
--   - Revoked from PUBLIC, anon and authenticated; service_role only. The
--     leading underscore also puts it under `anonCallableRpcs.test.ts`'s rule.

CREATE OR REPLACE FUNCTION public._public_relations()
RETURNS TABLE (relation_name text, relkind text, security_invoker boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.relname::text AS relation_name,
         c.relkind::text AS relkind,
         coalesce(
           (SELECT o.option_value::boolean
              FROM pg_catalog.pg_options_to_table(c.reloptions) o
             WHERE o.option_name = 'security_invoker'),
           false
         ) AS security_invoker
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public._public_relations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._public_relations() FROM anon;
REVOKE ALL ON FUNCTION public._public_relations() FROM authenticated;
GRANT EXECUTE ON FUNCTION public._public_relations() TO service_role;

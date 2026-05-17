-- ============================================================
-- 016: Security lint fixes
--
-- Fixes Supabase linter findings:
--   ERROR: round_results view uses security_invoker=false (SECURITY DEFINER)
--   WARN:  5 functions missing SET search_path
--   WARN:  series_update WITH CHECK (true) — intentional for ownership transfer
--   WARN:  trips_insert WITH CHECK (true) — intentional, any user can create
-- ============================================================

-- 1. Fix round_results view: set security_invoker = true so RLS of the
--    querying user is enforced, not the view creator.
ALTER VIEW round_results SET (security_invoker = true);

-- 2. Fix mutable search_path on all flagged functions by recreating them
--    with SET search_path = ''.

-- 2a. trip_status — computed column function
CREATE OR REPLACE FUNCTION trip_status(t trips) RETURNS text AS $$
  SELECT CASE
    WHEN t.end_date IS NOT NULL AND t.end_date < CURRENT_DATE THEN 'completed'
    WHEN t.start_date IS NOT NULL AND t.start_date <= CURRENT_DATE THEN 'active'
    WHEN t.locked_destination_title IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.date_polls dp
        WHERE dp.trip_id = t.id AND dp.locked_window_id IS NOT NULL
      )
      THEN 'ready'
    ELSE 'planning'
  END;
$$ LANGUAGE sql STABLE SET search_path = '';

-- 2b. set_updated_at — trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 2c. activate_round — RPC, needs SECURITY DEFINER + locked search_path
CREATE OR REPLACE FUNCTION activate_round(p_round_id text, p_event_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.rounds
     SET status = 'submitted'
   WHERE event_id = p_event_id
     AND status   = 'active';

  UPDATE public.rounds
     SET status = 'active'
   WHERE id = p_round_id;
END;
$$;

-- 2d. is_trip_member — RLS helper, needs SECURITY DEFINER + locked search_path
CREATE OR REPLACE FUNCTION is_trip_member(p_trip_id text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id AND user_id = auth.uid()::text
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

-- 2e. has_trip_role — RLS helper, needs SECURITY DEFINER + locked search_path
CREATE OR REPLACE FUNCTION has_trip_role(p_trip_id text, p_roles text[]) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trip_members
    WHERE trip_id = p_trip_id
      AND user_id = auth.uid()::text
      AND role = ANY(p_roles)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

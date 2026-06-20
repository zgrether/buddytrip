-- 060 — api_usage_daily: the golfcourseapi.com daily request counter (UTC).
--
-- golfcourseapi's free tier is 50 requests/day. This table is BOTH the rate
-- limiter (check-before-call) AND the usage metric the future admin panel will
-- read — one row per provider per UTC day. Keyed to 0000 UTC (the reset
-- boundary we assume; validate against the live API once a key is in hand).
-- Local-table searches never touch this; only an actual golfcourseapi call does.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.api_usage_daily (
  provider   text not null,
  usage_date date not null,                    -- UTC day
  count      int  not null default 0,
  PRIMARY KEY (provider, usage_date)
);
COMMENT ON TABLE public.api_usage_daily IS
  'Daily external-API call counter (golfcourseapi.com), keyed to UTC day. Rate '
  'limiter + usage metric. Incremented only on an actual API call (search/import).';

ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may READ today's count (the picker shows cap state).
-- Writes go ONLY through record_api_call (SECURITY DEFINER) — no direct
-- INSERT/UPDATE policy, so the count can't be tampered with from the client.
DROP POLICY IF EXISTS api_usage_daily_select ON public.api_usage_daily;
CREATE POLICY api_usage_daily_select ON public.api_usage_daily
  FOR SELECT TO authenticated
  USING (true);

-- Atomic check-and-increment: increments today's counter for `p_provider` IFF
-- it is below `p_limit`, returning the new count; returns -1 when already at the
-- cap (no increment). One round-trip, race-safe — two concurrent callers can't
-- both push past the limit. SECURITY DEFINER so it can write past RLS.
CREATE OR REPLACE FUNCTION public.record_api_call(p_provider text, p_limit int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO public.api_usage_daily (provider, usage_date, count)
  VALUES (p_provider, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (provider, usage_date)
  DO UPDATE SET count = public.api_usage_daily.count + 1
    WHERE public.api_usage_daily.count < p_limit
  RETURNING count INTO new_count;
  -- A conflict whose WHERE failed (already at cap) returns no row → null.
  RETURN COALESCE(new_count, -1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_api_call(text, int) TO authenticated;

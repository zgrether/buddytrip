-- 105 — push_send_log: a durable record of every push SEND ATTEMPT.
--
-- ── Why a table, and why now ────────────────────────────────────────────────
-- Two investigations into this subsystem stalled inside a week, each on a
-- different half of the same missing fact:
--
--   * The Aug 1 clinch: Vercel's runtime logs (1-day retention on Pro) had
--     expired by the time anyone looked, so there was no record of whether the
--     notify path ran at all.
--   * The "no push on finalize" report: `sendPushToUsers` already computes
--     recipients / skipped / sent / notConfigured — and EVERY call site throws
--     the result away. So "sent to nobody, correctly" and "the send threw" were
--     both `sent: 0` to the caller, and indistinguishable after the fact.
--
-- Logging alone fixes the second and leaves the first to recur on a retention
-- clock — short enough that a BBMI incident investigated a month later hits the
-- same wall. Hence a table, WITH structured logging alongside it (the log line
-- is the immediate signal; the row is the one that's still there in November).
--
-- ── SENDER-SCOPED, not trigger-scoped ───────────────────────────────────────
-- The row is written by the SEND HELPERS (`sendPush` / `sendPushToUsers`), not
-- by each domain trigger. A record wired per-trigger goes blind the moment a
-- fifth trigger lands — which is exactly how a merged-away path's behaviour
-- gets lost. Anything that sends is recorded, including future callers nobody
-- has written yet.
--
-- ── NO MESSAGE CONTENT ──────────────────────────────────────────────────────
-- Ids and counts only. No title, no body, no URL. A notification body can carry
-- scores, names and standings; this table exists to answer "did it go, and to
-- how many", not to archive what was said.
--
-- Additive + idempotent + replayable from zero (Step 0 CI gate).

CREATE TABLE IF NOT EXISTS public.push_send_log (
  id                     text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- WHAT fired. `trigger` is a free-text label owned by the calling helper
  -- (e.g. 'game_finished', 'cup_clinched', 'test_send') rather than an enum:
  -- a CHECK constraint here would mean a migration every time a notification
  -- type is added, and the recording path must never be the thing that blocks
  -- shipping a new one.
  trigger                text NOT NULL,
  -- The notification registry key (src/lib/notificationTypes.ts): scores /
  -- planning / invites / chat.
  type_key               text NOT NULL,

  -- WHERE it came from. All nullable and all WITHOUT foreign keys, deliberately:
  -- this is an audit trail, and a delete of the game it describes must not
  -- cascade the evidence away. That is the whole failure mode the table exists
  -- to fix — `games.delete` taking the record of a send with it would recreate
  -- "unfalsifiable after the fact" precisely when someone is investigating.
  trip_id                text,
  game_id                text,
  competition_id         text,
  actor_user_id          text,

  -- THE COUNTS. `recipients` is post-dedup and post-actor-exclusion, so
  -- `recipients = 0` with a populated audience is the actor-exclusion case
  -- (correct) and is distinguishable from `subscriptions_found = 0` (nobody has
  -- a device) and from `failed > 0` (delivery broke).
  recipients             integer NOT NULL DEFAULT 0,
  skipped_preference_off integer NOT NULL DEFAULT 0,
  subscriptions_found    integer NOT NULL DEFAULT 0,
  sent                   integer NOT NULL DEFAULT 0,
  failed                 integer NOT NULL DEFAULT 0,
  removed_dead           integer NOT NULL DEFAULT 0,

  -- VAPID absent (local / CI / a preview without keys). Not an error, and
  -- recorded so a run of zeroes in one environment is never mistaken for a bug.
  not_configured         boolean NOT NULL DEFAULT false,

  -- The errors the helpers currently swallow. Message text only — never a
  -- payload. Null on a clean run.
  error                  text
);

-- Time-ordered reads are the only access pattern: "what happened around <when>"
-- during an investigation, and a prune by age if one is ever wanted (see below).
CREATE INDEX IF NOT EXISTS idx_push_send_log_created_at
  ON public.push_send_log USING btree (created_at DESC);

-- Investigating one game's notifications is the second pattern — partial, since
-- most rows carry a game_id and the null ones are never searched this way.
CREATE INDEX IF NOT EXISTS idx_push_send_log_game_id
  ON public.push_send_log USING btree (game_id) WHERE game_id IS NOT NULL;

-- ── RETENTION: kept indefinitely, deliberately, with the arithmetic ─────────
-- ~10-30 game finishes + 1-3 clinches per trip. At 100 trips a year that is
-- ~3,000 rows/year — a table that stays under a megabyte for the life of the
-- product. Adding pruning machinery (pg_cron, a scheduled function) would be
-- more moving parts than the thing it maintains, and each of those is its own
-- silent-failure surface in a subsystem that just had two.
--
-- So: KEPT. If that ever stops being true, the index above makes the trim a
-- one-liner run out-of-band — no migration, no code change:
--
--     DELETE FROM public.push_send_log WHERE created_at < now() - interval '1 year';
--
-- Decided rather than deferred, so nobody finds this table in a year and has to
-- guess whether it was meant to grow.

-- ── RLS: service-role only ──────────────────────────────────────────────────
-- Nothing in the app reads this — it is written by the send helpers (which run
-- on the service-role client by nature, since they read OTHER users' prefs and
-- subscriptions) and read by hand during an investigation. RLS is ENABLED with
-- NO policies, which denies every `authenticated` and `anon` request outright;
-- the service-role key bypasses RLS, so the writers are unaffected.
--
-- This is stricter than push_subscriptions' own-row policies on purpose: rows
-- here name WHO was notified about WHAT, across users. There is no version of
-- that a client should be able to read.
ALTER TABLE public.push_send_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.push_send_log IS
  'Durable record of every push send ATTEMPT (Part B). Written by the send helpers, '
  'not by domain triggers, so any future caller is covered automatically. Ids and '
  'counts only — never message content. Service-role only: RLS enabled with no '
  'policies. Distinguishes "sent to nobody, correctly" (recipients=0 or '
  'subscriptions_found=0) from "failed" (failed>0 / error set), which is the '
  'property two stalled investigations lacked.';

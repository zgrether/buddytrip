-- 106 — push_send_log.outcome: WHY an attempt produced what it produced.
--
-- ── The gap this closes ─────────────────────────────────────────────────────
-- 105 made "sent to nobody, correctly" distinguishable from "failed" for the
-- SEND half, by recording recipients / subscriptions_found / sent / failed. That
-- works because the send half always reaches the recorder.
--
-- The CLINCH check does not. It has three exits BEFORE any send:
--
--   * no clincher      — detection ran and found nobody
--   * already claimed  — correct suppression (one push per clinch)
--   * threw            — swallowed by its own catch
--
-- All three returned before `sendPushToUsers`, so none produced a row at all,
-- and every one of them looked identical from the outside: no row, no push. That
-- ambiguity is what led to a re-finalize being read as "the transition guard is
-- suppressing the clinch check" when the guard does not wrap that call. An
-- unrecorded attempt is neither "sent to nobody" nor "failed" — it is invisible,
-- which is the exact property 105 exists to prevent.
--
-- ── Why a column rather than more counters ──────────────────────────────────
-- `no_clincher` and `already_claimed` are BOTH zero on every existing counter:
-- no recipients, no subscriptions, nothing sent, nothing failed, no error. They
-- are not distinguishable by any arithmetic, only by intent — so the intent is
-- the thing that has to be stored.
--
-- Free text, not an enum or a CHECK, for the same reason `trigger` is: a new
-- outcome must never require a migration to become recordable. The values in use
-- today are 'sent', 'no_clincher', 'already_claimed', 'threw', and 'no_recipients'.
--
-- NULLABLE with no default, deliberately: rows written by 105's code (and any
-- row written by a deploy that lands before this column does) simply carry NULL
-- rather than a fabricated 'sent' that would misreport history.
--
-- Additive + idempotent + replayable from zero (Step 0 CI gate).

ALTER TABLE public.push_send_log
  ADD COLUMN IF NOT EXISTS outcome text;

COMMENT ON COLUMN public.push_send_log.outcome IS
  'Why this attempt ended as it did: sent | no_clincher | already_claimed | threw | '
  'no_recipients. Free text by design (same reasoning as `trigger`) so a new outcome '
  'needs no migration. NULL on rows predating migration 106. Exists because the clinch '
  'check''s pre-send exits are all-zero on every counter and are therefore '
  'indistinguishable without it.';

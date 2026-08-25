-- 144 — chat_reads.last_notified_at: per-recipient chat push state.
--
-- ── What this is for ────────────────────────────────────────────────────────
-- The chat push gate (#1054, src/server/lib/chatNotify.ts) notifies a recipient
-- only when they were CAUGHT UP before a message arrived, and then goes silent
-- until they read. Ceiling: one push per recipient per read-session.
--
-- That ceiling is correct and the re-arm condition is too strict. Reading is
-- the ONLY thing that re-arms, and on a real trip most people will not open
-- chat on their phone between bursts — so they get one push on day one and
-- silence for the rest of the week. Confirmed in production before this
-- migration was written: of 14 chat sends over one morning, 3 delivered and 11
-- were gate-suppressed.
--
-- So the gate gains a second re-arm: behind, but nothing has been SENT to this
-- recipient for N minutes, push anyway. That needs to know when this recipient
-- was last notified — which is what this column stores.
--
-- ── Why on chat_reads rather than a new table ───────────────────────────────
-- Identical grain. `chat_reads` is already keyed (trip_id, user_id, visibility)
-- — per person, per trip, per channel — which is exactly the grain of "when did
-- we last push chat to this person for this channel". A second table would
-- duplicate the key, the RLS, and the lifecycle (both cascade from the same
-- trip and user) to store one timestamp beside a row that already exists.
--
-- NOT folded into `last_read_at`. They answer different questions and a write
-- to one must never imply the other: notifying someone is not them reading, and
-- collapsing the two would mark messages read that nobody has seen, silently
-- clearing the unread badge and the new-messages divider.
--
-- ── Nullable, no backfill ───────────────────────────────────────────────────
-- NULL means "never notified for this channel", which the gate reads as
-- eligible-on-the-time-rule. That is the correct starting state for every
-- existing row: nobody has been notified under a rule that did not exist yet,
-- and a backfilled now() would silence everyone for the first window after
-- deploy — the exact failure this change exists to fix, reintroduced by its own
-- migration.
--
-- ── Who writes it ───────────────────────────────────────────────────────────
-- The SEND HELPER, on the service-role client (which bypasses RLS), at the
-- moment a push is handed to the push service.
--
-- `chat_reads` RLS lets a member UPDATE their own row, so a determined user
-- could write this column directly. Deliberately left alone: the only outcomes
-- are notifying yourself more (a future value re-armed early is not possible —
-- see the gate; a past value re-arms sooner) or less. Both are self-scoped, and
-- both are already reachable by simply toggling the `chat` preference. A
-- column-level grant would be new machinery guarding nothing.
--
-- Additive + idempotent + replayable from zero (Step 0 CI gate).

ALTER TABLE public.chat_reads
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

COMMENT ON COLUMN public.chat_reads.last_notified_at IS
  'When a chat push was last SENT to this user for this trip+channel. Written by '
  'the send path (service role), never by markRead. Feeds the chat gate''s '
  'time-based re-arm: behind, but nothing sent for N minutes, notify anyway. '
  'NULL = never notified, which reads as eligible. Distinct from last_read_at on '
  'purpose — being notified is not having read.';

-- No index. The gate already fetches these rows by (trip_id, visibility,
-- user_id IN audience), which the primary key serves; this column is only ever
-- read from rows that query has already found, never filtered on.

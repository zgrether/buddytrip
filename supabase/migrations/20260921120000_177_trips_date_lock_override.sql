-- 177 — trips.date_lock_override: an owner can lift a trip's automatic date lock.
--
-- ══ What the date lock is, and what it is not ═══════════════════════════════
--
-- A trip goes read-only automatically once `now > nextSunday(end_date + 14d)`
-- (`isReadOnly` -> `isGrayscale`, src/lib/tripStatus.ts). That predicate lives
-- ENTIRELY in the client and has no counterpart here: as of this migration
-- nothing in SQL — no policy, no CHECK, no function — reads a trip's dates to
-- decide whether it may be written. This column does not change that. It stores
-- an owner's decision; the client is still what acts on it.
--
-- It is a SEPARATE axis from the ROLE gate (`canEdit = Owner || Organizer`) and
-- from the DESTINATION lock (`locked_destination_at`). Three different things in
-- this schema are called "locked", which is why this column is not named
-- `lock_override`: `trips` already carries `locked_destination_at` /
-- `locked_destination_title` / `locked_destination_location`, and a bare
-- `lock_override` sitting beside them reads as "override the destination lock".
-- The name says which lock it overrides.
--
-- ══ Why a stored flag rather than moving the dates ══════════════════════════
--
-- The workaround it replaces was editing `end_date` forward, which makes a
-- finished trip claim to be upcoming everywhere the lifecycle is derived
-- (`getEffectiveStatus`, the dashboard, countdowns). BBMI 2023 is in that state
-- in production right now — real dates in 2023, stored dates in the future. The
-- trip's real dates must stay true; the override is the thing that moves.
--
-- ══ Scope, deliberately ════════════════════════════════════════════════════
--
-- The override lifts the date lock and NOTHING else. It must never widen the
-- role gate: a Member who could not edit during the trip still cannot edit on an
-- overridden trip. Nothing here can enforce that (the role gate is a separate
-- predicate over `trip_members.role`), so it is stated as the invariant the
-- consuming PR is tested against.
--
-- No time component. `unlocked_until` was considered and deferred — this is a
-- manual, re-flippable switch, and a boolean cannot silently expire.
--
-- ══ Authorization ══════════════════════════════════════════════════════════
--
-- NOT enforced here. `trips_update` admits Owner AND Organizer, so RLS alone
-- would let an Organizer flip this. Owner-only is enforced in the tRPC
-- procedure that writes it (the follow-up PR). Stated so the next reader does
-- not mistake the absence of a policy for a decision that Organizers may write
-- it.

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS date_lock_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.trips.date_lock_override IS 'Owner-set: lift this trip''s automatic read-only date lock (now > nextSunday(end_date + 14d)). Restores the trip to its during-trip editability WITHOUT changing its dates. Never widens the role gate - a Member still cannot edit. Client-evaluated: no SQL policy reads this column.';

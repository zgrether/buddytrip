-- 071 — competitions.short_name
--
-- A short label for the competition, surfaced as the BOTTOM-nav "Live" tab
-- label (the full name — e.g. "Buddy Banks Memorial Invitational 2026" — won't
-- fit a nav tab). Nullable: when unset the nav falls back to the full `name`
-- (which truncates, itself the nudge to set a short one). Display-string only —
-- no RLS or code branches on this value.
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS short_name text;

COMMENT ON COLUMN competitions.short_name IS
  'Short label shown in the bottom navigation bar. Falls back to name when null.';

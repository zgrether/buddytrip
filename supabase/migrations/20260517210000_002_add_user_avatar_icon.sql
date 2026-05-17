-- Migration 002 — user avatar icon
-- Adds optional Tabler icon name (e.g. "flag-2", "trophy") to users.
-- Null = use initials fallback. Set via users.updateAvatar mutation,
-- selected from src/lib/avatarIcons.ts and rendered by <Avatar />.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_icon text;

COMMENT ON COLUMN users.avatar_icon IS
  'Tabler icon name (kebab-case) chosen as the user''s avatar. NULL = fall back to initials.';

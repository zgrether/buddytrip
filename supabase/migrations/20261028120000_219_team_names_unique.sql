-- 219 · A team's name, and its short name, are unique within its competition.
--
-- WHAT CHANGES: a unique index on teams (competition_id, lower(btrim(name))),
-- so two teams in one competition can never share a name, ignoring case and
-- surrounding spaces ("Bravo", "bravo " and "BRAVO" are one name).
--
-- WHY: nothing enforced it before — no constraint, no index, no check in the
-- teams router or in update_team_identity. The app now relies on it: a team's
-- badge (TeamBadge, #1677) looks its label up BY NAME where a screen has no team
-- id to hand, and two teams sharing a name would make that lookup pick one of
-- them for both. Two teams with one name was also already confusing on every
-- board that shows names; nothing in the app wants it.
--
-- SAFE TO ADD: production held 0 duplicate names across its 23 teams when this
-- was written (read-only count, 2026-10-20, case- and space-insensitive). The
-- table is small, so a plain CREATE INDEX holds its lock for well under a
-- millisecond (CLAUDE.md, Index Creation).
--
-- EVERY WRITER is covered by the index itself rather than by checks in each:
-- teams.create (insert), teams.update (the update_team_identity RPC) and
-- competitions.create's seeded "Team A" / "Team B". The routers turn the
-- resulting unique_violation into a refusal that names the fix.
--
-- SHORT NAMES TOO (Zach, before merge): the same rule — case and surrounding
-- spaces ignored — because the board's standings and the finished-game tiles
-- label a team by its short name, and two teams both reading "BRA" side by
-- side is the same confusion. A BLANK short name may repeat: the column is
-- NOT NULL with no minimum length, so an empty one is storable, and it names
-- nothing to clash with. Production held 0 duplicate short names either.
CREATE UNIQUE INDEX IF NOT EXISTS teams_competition_name_unique
  ON public.teams (competition_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS teams_competition_short_name_unique
  ON public.teams (competition_id, lower(btrim(short_name)))
  WHERE btrim(short_name) <> '';

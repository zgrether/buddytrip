-- 172 — team chat: read state, history floor, and a comment at the policy.
--
-- Team chat is a fourth channel visible only to a team's own members. The
-- server half largely existed already: `messages.channel = 'team'`, a `team_id`
-- column, a `chk_team_channel` CHECK and an RLS policy pair all shipped in
-- migration 001 and have never been exercised (prod holds zero team messages).
-- What was missing is everything that records ATTENTION — read state, a history
-- floor — plus a written record of why the existing policy is correct and what
-- would break it.
--
-- ── 1 · The collision this fixes ───────────────────────────────────────────
-- THIS IS THE POINT OF THE MIGRATION.
--
-- `chat_reads`'s key was (trip_id, user_id, visibility), and `messages.send`
-- stamps team messages `visibility = 'crew'` (team chat does not split into
-- crew/planning, so it borrows crew's value). A team read row would therefore
-- have landed on the SAME KEY as the Crew read row, and reading Team would have
-- marked Crew read — silently, by writing the row Crew's badge reads from.
--
-- That is not a rule callers had to remember to follow. It is a collision the
-- key forced. Adding the dimension makes the two rows different rows, so
-- "reading Team must not mark Crew read" stops being a discipline and becomes
-- something the schema does not permit.
--
-- ── 2 · Why a GENERATED column and not a bare COALESCE index ───────────────
-- The uniqueness rule wanted here is over (trip_id, user_id, visibility,
-- COALESCE(team_id, '')): a NULL team_id is the trip channels' "no team", and
-- NULLs do not compare equal, so a plain unique index over a nullable team_id
-- would admit unlimited duplicate Crew rows for one person.
--
-- A bare expression index expresses that and CANNOT BE USED BY THE WRITERS.
-- Both `chat_reads` writes (`messages.markRead`, `messages.markViewing`) are
-- PostgREST upserts, and PostgREST's `on_conflict` parameter emits a plain
-- column list — it has no way to name an expression. Verified rather than
-- assumed, on this database, in a rolled-back transaction:
--
--   ON CONFLICT (a, b, team_id) against a COALESCE index
--     -> ERROR: there is no unique or exclusion constraint matching the
--        ON CONFLICT specification
--   ON CONFLICT (a, b, team_key) against a generated stored column
--     -> SUCCEEDED
--
-- So the index shape that reads correctly on paper is the one that breaks both
-- upserts at RUNTIME, on a path no type-checker sees. `team_key` materialises
-- exactly the same expression as a stored column, which keeps the rule
-- identical while giving the conflict target a name PostgREST can write. The
-- column is GENERATED ALWAYS, so it cannot drift from `team_id` — there is no
-- write path that could set one without the other.
--
-- `team_id` itself stays a real nullable FK with ON DELETE CASCADE, so deleting
-- a team takes its read rows with it and the FK is not traded away for the key.
--
-- ── 3 · The history floor is its own column ────────────────────────────────
-- `trip_members.chat_visible_from` cannot serve: it is one value per member per
-- TRIP, and `messages.list` applies it only when channel = 'trip'.
--
-- `team_assignments.assigned_at` looks like the natural floor and is not.
-- `assign()` upserts a payload that omits it and there are no triggers on the
-- table, so `DEFAULT now()` fires on INSERT only — after a Buddy -> Banks move
-- it still reads "first assigned to the competition", which would show the
-- mover all of Banks' history back to a date that has nothing to do with Banks.
-- Refreshing it on the update branch was considered and rejected: it would
-- leave a column whose NAME lies about what it holds.
--
-- `team_visible_from` is stamped on team CHANGE (including first assignment) and
-- deliberately NOT on a same-team re-write, so an unrelated reorder or captain
-- flip cannot silently wipe someone's history.
--
-- Existing rows get NULL = sees all history. That is correct rather than merely
-- convenient: there are no team messages for them to have missed.
--
-- ── 4 · The other half of "changed teams" needs no column ──────────────────
-- Leaving a team removes access to its history automatically — `messages_select`
-- gates on a CURRENT `team_assignments` row, so the read stops the moment the
-- assignment moves. Only the joining side needed a floor.

-- ── chat_reads: the team dimension ─────────────────────────────────────────

ALTER TABLE public.chat_reads
  ADD COLUMN IF NOT EXISTS team_id text REFERENCES public.teams(id) ON DELETE CASCADE;

ALTER TABLE public.chat_reads
  ADD COLUMN IF NOT EXISTS team_key text
  GENERATED ALWAYS AS (COALESCE(team_id, '')) STORED;

-- 'team' joins the value set. Team chat does not split into crew/planning, so
-- the channel gets one read row per (person, team) and `visibility` names which
-- ROOM the row is about rather than which sub-channel of the trip it is.
ALTER TABLE public.chat_reads DROP CONSTRAINT IF EXISTS chat_reads_visibility_check;
ALTER TABLE public.chat_reads
  ADD CONSTRAINT chat_reads_visibility_check
  CHECK (visibility IN ('crew', 'planning', 'team'));

-- The two columns move together in both directions. Mirrors messages'
-- chk_team_channel, and rules out both halves of the obvious mistake: a team row
-- with no team, and a crew row that has quietly acquired one.
ALTER TABLE public.chat_reads DROP CONSTRAINT IF EXISTS chk_chat_reads_team_channel;
ALTER TABLE public.chat_reads
  ADD CONSTRAINT chk_chat_reads_team_channel
  CHECK ((visibility = 'team') = (team_id IS NOT NULL));

-- Re-key. Every existing row has team_id NULL -> team_key '', so the new key is
-- the old key with a constant appended and no row can collide on the way in.
ALTER TABLE public.chat_reads DROP CONSTRAINT IF EXISTS chat_reads_pkey;
ALTER TABLE public.chat_reads
  ADD CONSTRAINT chat_reads_pkey PRIMARY KEY (trip_id, user_id, visibility, team_key);

COMMENT ON TABLE public.chat_reads IS
  'Per-user, per-ROOM chat read state. Key is (trip_id, user_id, visibility, team_key), where team_key is COALESCE(team_id, '''') — one row per person per Crew / Organizers / team channel. Source of truth for unread counts and the new-messages divider, so read state follows the account across devices.';

COMMENT ON COLUMN public.chat_reads.team_id IS
  'Which team''s chat this row is about. NOT NULL exactly when visibility = ''team'' (chk_chat_reads_team_channel); NULL for the Crew and Organizers rows.';

COMMENT ON COLUMN public.chat_reads.team_key IS
  'COALESCE(team_id, ''''), stored so it can carry the primary key. Exists because NULLs do not compare equal — a nullable team_id in the key would admit unlimited duplicate Crew rows — and because PostgREST''s on_conflict emits a plain column list and cannot name an expression index. GENERATED ALWAYS: never write it, and it cannot drift from team_id.';

COMMENT ON COLUMN public.chat_reads.visibility IS
  'Which room this read row is about: crew / planning (the two sub-channels of channel=trip) or team (paired with team_id). NOTE: migration 010 described this key as "(trip, user, channel)" and called it per-channel. It was neither — the column is visibility, and until this migration it had no team dimension at all, which is how the Crew/Team read-row collision stayed invisible in a file that appeared to describe it.';

-- ── team_assignments: the history floor ────────────────────────────────────

ALTER TABLE public.team_assignments
  ADD COLUMN IF NOT EXISTS team_visible_from timestamptz;

COMMENT ON COLUMN public.team_assignments.team_visible_from IS
  'NULL = sees all of this team''s chat history. A timestamp = this person joined THIS team then and sees nothing before it. Stamped by teamAssignments.assign on a team CHANGE only, never on a same-team re-write (a reorder or captain flip must not wipe history). Deliberately NOT assigned_at, which is never refreshed on the upsert''s UPDATE branch and so still names the first assignment to the COMPETITION.';

-- ── A comment at the policy, not only in a report ──────────────────────────
--
-- messages_select's team arm is the template for a no-staff-branch policy in
-- this schema, and it predates pickem_picks_select (migration 146) by months.
-- It is left exactly as migration 001 wrote it; what it gains here is a record
-- of the one thing that would break it.

COMMENT ON POLICY messages_select ON public.messages IS
  'Team arm has NO staff branch, deliberately: Owner, Organizer and delegate read a team chat only when they hold a team_assignments row for THAT team. Verified against prod — Owners were refused on 6 of 10 (member, team) pairs and Organizers on 12 of 16, admitted only where genuinely assigned; a staff branch would put refusals at zero, which is the mutation check. '
  'FRAGILITY: the team arm reads team_assignments and competitions DIRECTLY rather than through a SECURITY DEFINER helper, unlike every other policy here. Postgres applies RLS inside policy subqueries, so this works ONLY because team_assignments_select and competitions_select are both member-wide (USING is_trip_member over the competition''s trip). '
  'THE CONDITION TO CHECK: if either of those SELECT policies is ever narrowed — to own-rows-only, or to staff — team chat goes dark for its own members with no error, just an empty room. Re-check this policy in the same change, or move the subquery behind a definer helper first.';

COMMENT ON POLICY messages_insert ON public.messages IS
  'Team arm mirrors messages_select''s and carries the same no-staff-branch rule and the same RLS-inside-subquery fragility — see the comment on messages_select before narrowing team_assignments_select or competitions_select.';

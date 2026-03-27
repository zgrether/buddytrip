# BuddyTrip — Database Schema

*Derived from `types.ts`. This is the Supabase migration contract — each section is a table.*

**Conventions used below:**
- `PK` — Primary key
- `FK → table.column` — Foreign key
- `NN` — Not null (required at all times)
- `*` — Required at creation (must be provided by the caller; not server-computed)
- `auto` — Server-computed or defaulted (do not provide at creation)
- `idx` — Needs an index (used in WHERE or ORDER BY)
- `nullable` — Column may be null; omitting the `*` marker means it defaults to null
- Columns marked with both `*` and `nullable` are writable but not required at creation

---

## `users`

Registered users. Auth is handled by Supabase Auth — this table extends `auth.users`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Matches `auth.users.id`. Plain string: 'zach', 'brad'. |
| `name` | `text` | `NN`, `*` | Full name: "Zach Grether" |
| `nickname` | `text` | `NN`, `*` | Display name: "Grether" — used in most UI surfaces |
| `email` | `text` | `NN`, `*`, `UNIQUE`, `idx` | Used for invite lookup |

**Indexes:** `email` (invite flow lookup)

**Notes:**
- `firstName` in the prototype is derivable from `name.split(' ')[0]` — do not store separately
- Profile images are not yet in the schema; add `avatar_url text` when needed
- `auth.users` → `users` is 1:1; use RLS `auth.uid()` for ownership checks

---

## `series`

Recurring trip series (e.g., "BBMI"). Optional — trips can exist without a series.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Slug: 'bbmi' |
| `name` | `text` | `NN`, `*` | Short name: "BBMI" |
| `full_name` | `text` | `NN`, `*` | "The Buddy Banks Memorial Invitational" |
| `years` | `text` | `NN`, `*` | Display string: "2019–present" (denormalized) |
| `trip_count` | `integer` | `NN`, `auto` | Maintained by trigger or recomputed from trips |
| `owner_id` | `text` | `NN`, `*`, `FK → users.id` | Explicit series owner — does NOT change when a trip owner changes. Transfer via dedicated hand-off action. |

**Notes:**
- `years` is a display string, not a date range — update manually or derive from linked trips
- `trip_count` can be a generated column: `(SELECT COUNT(*) FROM trips WHERE series_id = series.id)`
- `owner_id` decision (2026-03-10): explicit column chosen over implicit "most recent trip's owner" — see MIGRATION_PLAN.md §Pre-Migration Product Decisions

---

## `trips`

The central entity. One row per trip instance (not per series).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Slug: 'trip-bbmi-2026' |
| `title` | `text` | `NN`, `*` | "BBMI 2026" |
| `series_id` | `text` | `FK → series.id`, `idx`, nullable | Null for one-off trips |
| `location` | `text` | nullable | Set directly or synced from `locked_destination_title` |
| `cost_tier` | `text` | nullable | `'$' \| '$$' \| '$$$' \| '$$$$'` |
| `image_url` | `text` | nullable | |
| `description` | `text` | `NN`, `auto` | Defaults to '' |
| `start_date` | `date` | nullable | ISO date; may be null until dates are locked |
| `end_date` | `date` | nullable | ISO date |
| `accommodation` | `text` | nullable | |
| `notes` | `text` | nullable | |
| `activities` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `golf_courses` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `comparison_mode` | `boolean` | `NN`, `auto` | `true` when destination voting is active. Defaults to `false`. |
| `event_id` | `text` | `FK → events.id`, nullable | Competition linked to this trip |
| `locked_destination_title` | `text` | nullable | Denormalized for quick display |
| `locked_destination_location` | `text` | nullable | |
| `locked_destination_at` | `timestamptz` | nullable | When destination was locked |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `NN`, `auto` | Updated by trigger on any write |

**Indexes:** `series_id` (filter by series), `start_date` (sort/filter by date), `event_id`

**Notes:**
- `status` is NOT stored — always derived by the application from `start_date`, `end_date`, `locked_destination_title`, and the date poll (see `getTripStatus()`)
- `locked_destination_*` columns replace the prototype's embedded `lockedDestination` object — three columns are simpler than a JSONB column for this limited shape
- The prototype's `proposedDates[]` array (distinct from `date_poll`) is currently display-only; migrate to `trip_proposed_dates` table only if users need to vote on them independently of a poll
- `activities` and `golf_courses` are string arrays on the trip; if they need to become searchable, normalize into a join table with a `tags` table

---

## `trip_members`

A user's membership on a trip. Replaces `Trip.attendees[]`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `idx`, `NN`, `*` | |
| `role` | `text` | `NN`, `*` | `'Owner' \| 'Planner' \| 'Member'` |
| `status` | `text` | `NN`, `auto` | `'in' \| 'likely' \| 'maybe' \| 'out'`. Defaults to `'maybe'`. |
| `joined_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Primary key:** `(trip_id, user_id)`

**Indexes:** `trip_id` (list members for a trip), `user_id` (list trips for a user)

**RLS:**
- `SELECT`: authenticated users who are members of the trip
- `INSERT`: trip Owners and Planners (via `trip_members` self-join)
- `UPDATE role`: trip Owners only
- `DELETE`: trip Owners only (or self-removal by any member)

---

## `ideas`

Destination ideas for a trip in comparison mode. Replaces `Trip.ideas[]`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Slug: 'idea-scottsdale' |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `title` | `text` | `NN`, `*` | "Scottsdale, AZ" |
| `location` | `text` | `NN`, `*` | |
| `description` | `text` | `NN`, `auto` | Defaults to '' |
| `golf_courses` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `activities` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `cost_tier` | `text` | nullable | |
| `pros` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `cons` | `text[]` | `NN`, `auto` | Defaults to `'{}'` |
| `image_url` | `text` | nullable | |
| `accommodation` | `text` | nullable | |
| `notes` | `text` | nullable | |
| `archived` | `boolean` | `NN`, `auto` | Defaults to `false` |
| `proposed_dates` | `jsonb` | `NN`, `auto` | `[{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }]`. Defaults to `'[]'`. |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Indexes:** `trip_id` (list ideas for a trip)

**Notes:**
- `proposed_dates` is a JSONB array because it's always read/written as a unit with no independent querying
- If `archived` ideas need to be hidden by default, add a partial index: `CREATE INDEX ON ideas(trip_id) WHERE NOT archived`

---

## `idea_votes`

Votes for destination ideas. One vote per user per idea.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | Denormalized for faster filtering |
| `idea_id` | `text` | `FK → ideas.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Primary key:** `(idea_id, user_id)` — one vote per user per idea

**Indexes:** `trip_id` (count votes across all ideas for a trip), `idea_id`

**Notes:**
- The prototype supports voting for multiple ideas simultaneously (not a ranked choice). Constraint is enforced at the application layer in the prototype; in production, enforce via PK.
- To change a vote, delete + insert (or upsert on `(idea_id, user_id)`)

---

## `idea_comments`

Comments on destination ideas.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | Denormalized for faster filtering |
| `idea_id` | `text` | `FK → ideas.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |
| `text` | `text` | `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()`, `idx` |

**Indexes:** `idea_id` (list comments for an idea), `created_at` (sort chronologically)

---

## `date_polls`

The active date poll for a trip. At most one per trip.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `trip_id` | `text` | `PK`, `FK → trips.id`, `NN` | 1:1 with trips |
| `open` | `boolean` | `NN`, `auto` | `true` while accepting votes. Defaults to `true`. |
| `locked_window_id` | `text` | `FK → date_windows.id`, nullable | Set when owner locks a winner |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Notes:**
- The prototype has two overlapping date vote systems (`DatePoll` on the trip and the module-level `DATE_VOTES` array). In production, use only `date_polls` + `date_windows` + `date_poll_votes`. Retire the `trip_proposed_dates` approach.
- `locked_window_id` creates a forward reference to `date_windows`. Create the FK as deferrable or handle with a two-step insert if needed.

---

## `date_windows`

Date range options within a poll.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Slug: 'dw-oct-2026' |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `start_date` | `date` | `NN`, `*` | |
| `end_date` | `date` | `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Indexes:** `trip_id` (list windows for a trip's poll)

---

## `date_poll_votes`

Votes on individual date windows.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `window_id` | `text` | `FK → date_windows.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |
| `answer` | `text` | `NN`, `*` | `'yes' \| 'no'` |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Primary key:** `(window_id, user_id)` — one answer per user per window

**Notes:**
- To change a vote, upsert on `(window_id, user_id)` updating `answer` and `created_at`

---

## `events`

Competition events linked to trips.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Slug: 'bbmi-2025' |
| `trip_id` | `text` | `FK → trips.id`, `UNIQUE`, `idx`, `NN`, `*` | One event per trip |
| `title` | `text` | `NN`, `*` | "BBMI 2025" |
| `subtitle` | `text` | `NN`, `auto` | Defaults to '' |
| `motto` | `text` | `NN`, `auto` | Defaults to '' |
| `location` | `text` | `NN`, `*` | "Bandon Dunes, OR" |
| `dates` | `text` | `NN`, `*` | Display string: "March 11–14, 2025" |
| `status` | `text` | `NN`, `auto` | `'upcoming' \| 'active' \| 'completed'`. Defaults to `'upcoming'`. Consider deriving from trip status. |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |

**Indexes:** `trip_id`

**Notes:**
- `events.status` is separate from `trips.status` — a trip can be in `planning` while its event is `upcoming`. In practice, consider deriving `events.status` from the linked trip's derived status rather than storing it.
- `dates` is a display string for the UI; the actual dates live on the linked `trip`.

---

## `teams`

Teams within a competition event.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | 'team-a', 'team-b' |
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `name` | `text` | `NN`, `*` | "Team Hammer" |
| `short_name` | `text` | `NN`, `*` | "HAMMER" |
| `color` | `text` | `NN`, `*` | Hex: "#00e676" |
| `color_dim` | `text` | `NN`, `*` | Hex with alpha: "#00e67640" |

**Indexes:** `event_id`

---

## `players`

Roster entries for a competition event. Denormalizes `users` for historical snapshot purposes.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | Same value as `users.id` |
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `idx`, `NN`, `*` | |
| `name` | `text` | `NN`, `*` | Snapshot of `users.name` at time of event |
| `nickname` | `text` | `NN`, `*` | Snapshot of `users.nickname` |
| `handicap` | `numeric(4,1)` | `NN`, `*` | |

**Primary key:** `(event_id, user_id)`

**Indexes:** `event_id`, `user_id`

**Notes:**
- `name` and `nickname` are intentionally denormalized — competition records should reflect who a player was at the time, not their current display name
- `players.id = players.user_id` in the prototype (they're the same value); in production, use `user_id` as the FK and let `id` be a surrogate if needed

---

## `team_assignments`

Links a player to a team for a specific event.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `team_id` | `text` | `FK → teams.id`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |

**Primary key:** `(event_id, user_id)` — one team per player per event

**Indexes:** `event_id`, `(event_id, team_id)` (list all players on a team)

---

## `play_groups`

Playing groups (foursomes) within a round.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | 'group-1', 'group-2' |
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `name` | `text` | `NN`, `*` | "Group 1" |
| `tee_time` | `text` | `NN`, `*` | "8:00 AM" — display string, not a time type |
| `player_ids` | `text[]` | `NN`, `*` | Array of `user_id` values |

**Indexes:** `event_id`

**Notes:**
- `player_ids` is a `text[]` array for the prototype shape. If groups need to vary per round, introduce a `round_play_groups` join table. For now, groups are fixed for the event.
- Consider normalizing `player_ids` into a `play_group_players` join table if you need per-player querying (e.g., "which group is this player in?")

---

## `rounds`

Rounds of competition within an event.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | 'r1', 'r2', 'r3', 'r4' |
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `day` | `integer` | `NN`, `*` | 1-indexed |
| `title` | `text` | `NN`, `*` | "Day 1 — Scramble" |
| `course` | `text` | `NN`, `*` | "Bandon Dunes" |
| `format` | `text` | `NN`, `*` | `'scramble' \| 'stableford' \| 'sabotage' \| 'skins'` |
| `status` | `text` | `NN`, `auto` | `'upcoming' \| 'active' \| 'complete'`. Defaults to `'upcoming'`. |
| `points_available` | `numeric(5,1)` | `NN`, `*` | Total Ryder Cup points for this round |

**Indexes:** `event_id`, `(event_id, day)` (sort rounds chronologically)

---

## `side_events`

Non-golf side competitions within an event (e.g., Hammerschlagen).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | 'side-hammerschlagen' |
| `event_id` | `text` | `FK → events.id`, `idx`, `NN`, `*` | |
| `name` | `text` | `NN`, `*` | "Hammerschlagen" |
| `icon` | `text` | `NN`, `*` | Emoji: "🔨" |
| `points_available` | `numeric(5,1)` | `NN`, `*` | |
| `status` | `text` | `NN`, `auto` | `'upcoming' \| 'complete'`. Defaults to `'upcoming'`. |
| `result` | `jsonb` | `NN`, `auto` | `{ [team_id]: points }`. Defaults to `'{}'`. |

**Indexes:** `event_id`

**Notes:**
- `result` is a JSONB object keyed by `team_id`. Could be normalized into a `side_event_results` table with `(side_event_id, team_id, points)` rows — prefer that if you need to query individual team scores frequently.

---

## `group_results`

Per-group score submission header for a round. Paired with `group_result_scores` rows for the actual points.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `round_id` | `text` | `FK → rounds.id`, `idx`, `NN`, `*` | |
| `group_id` | `text` | `FK → play_groups.id`, `NN`, `*` | |
| `submitted_by` | `text` | `FK → users.id`, `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `NN`, `auto` | Updated by trigger |

**Primary key:** `(round_id, group_id)`

**Indexes:** `round_id`

---

## `group_result_scores`

Per-team points for a group result. Supports any number of teams (2-team Ryder Cup, 4-team scramble, 64-team tournament, etc.).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `round_id` | `text` | `FK → group_results.round_id`, `NN`, `*` | Composite FK |
| `group_id` | `text` | `FK → group_results.group_id`, `NN`, `*` | Composite FK |
| `team_id` | `text` | `FK → teams.id`, `NN`, `*` | |
| `points` | `numeric(3,1)` | `NN`, `*` | `0`, `0.5`, or `1` |

**Primary key:** `(round_id, group_id, team_id)`

**Constraint:** `CHECK (points IN (0, 0.5, 1))`

**Notes:**
- One row per team per group per round. Total points across all teams for a group must sum to 1 (enforced at the application layer or via a trigger).
- For a 2-team event: 2 rows per group. For a 4-team scramble: 4 rows per group, etc.
- `round_results` view aggregates across all groups: `CREATE VIEW round_results AS SELECT round_id, team_id, SUM(points) AS total_points FROM group_result_scores GROUP BY round_id, team_id`

---

## `reservations`

Trip bookings and confirmations.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `type` | `text` | `NN`, `*` | `'accommodation' \| 'tee-time' \| 'restaurant' \| 'transport'` |
| `title` | `text` | `NN`, `*` | |
| `date` | `date` | `NN`, `*` | |
| `start_time` | `text` | `NN`, `auto` | Display string: "3:00 PM". Defaults to ''. |
| `confirmation_number` | `text` | `NN`, `auto` | Defaults to '' |
| `cost` | `numeric(10,2)` | `NN`, `auto` | Defaults to 0 |
| `notes` | `text` | `NN`, `auto` | Defaults to '' |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `NN`, `auto` | Updated by trigger |

**Indexes:** `trip_id`, `(trip_id, date)` (sort reservations chronologically per trip)

---

## `expenses`

Trip expenses with split tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `title` | `text` | `NN`, `*` | |
| `amount` | `numeric(10,2)` | `NN`, `*` | |
| `paid_by_user_id` | `text` | `FK → users.id`, `idx`, `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |
| `updated_at` | `timestamptz` | `NN`, `auto` | Updated by trigger |

**Indexes:** `trip_id`, `paid_by_user_id`

---

## `expense_splits`

Who splits each expense.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `expense_id` | `text` | `FK → expenses.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |
| `amount` | `numeric(10,2)` | nullable | Per-person override. Null = even split. Not yet implemented in prototype. |

**Primary key:** `(expense_id, user_id)`

**Indexes:** `expense_id`

**Notes:**
- When `amount` is null for all splits on an expense, compute each person's share as `expense.amount / COUNT(*)` at read time
- Per-person overrides are in the schema now so they don't require a migration later

---

## `messages`

Chat messages for trip and team channels.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `user_id` | `text` | `FK → users.id`, `NN`, `*` | |
| `channel` | `text` | `NN`, `*` | `'trip' \| 'team'` |
| `team_id` | `text` | `FK → teams.id`, `idx`, nullable | Required when `channel = 'team'` |
| `text` | `text` | `NN`, `*` | |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()`, `idx` |

**Indexes:** `(trip_id, channel)`, `(trip_id, team_id)` (for team channel), `created_at` (chronological order)

**Constraint:** `CHECK (channel = 'trip' OR (channel = 'team' AND team_id IS NOT NULL))`

**Realtime:** Subscribe to `messages` filtered by `trip_id` and `channel` (and `team_id` for team channels). See `REALTIME.md`.

**RLS:**
- `SELECT` trip channel: any `trip_members` member for that trip
- `SELECT` team channel: only members whose `team_assignments.team_id` matches `messages.team_id`
- `INSERT`: any trip member (for trip channel) or their own team (for team channel)

---

## `notification_events`

In-app activity feed. One row per notification per trip.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `type` | `text` | `NN`, `*` | `'destination_locked' \| 'dates_locked' \| 'crew_added' \| 'chat_message' \| 'score_submitted'` |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `actor_id` | `text` | `FK → users.id`, `NN`, `*` | Who triggered the notification |
| `payload` | `jsonb` | `NN`, `*` | Type-specific data (see below) |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()`, `idx` |

**Indexes:** `trip_id`, `created_at`

**Payload shapes per type:**

| Type | Payload |
|------|---------|
| `destination_locked` | `{ "destination": "Scottsdale, AZ" }` |
| `dates_locked` | `{ "dateRange": "Oct 5–8, 2026" }` |
| `crew_added` | `{ "memberName": "Tyler Hayes" }` |
| `chat_message` | `{ "preview": "Anyone else flying into PHX...?" }` |
| `score_submitted` | `{ "roundTitle": "Day 3 — Sabotage" }` |

**Read tracking:**

The prototype marks all notifications read at once (`onMarkAllRead`). In production, use a separate `notification_reads` join table for per-user, per-notification read state:

```sql
CREATE TABLE notification_reads (
  notification_id text REFERENCES notification_events(id),
  user_id         text REFERENCES users(id),
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
```

This supports "unread count per user" queries without a `read_at` column on the notification itself.

---

## `quick_info_tiles`

Custom key-value info tiles shown on the trip home screen.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `text` | `PK`, `NN` | |
| `trip_id` | `text` | `FK → trips.id`, `idx`, `NN`, `*` | |
| `label` | `text` | `NN`, `*` | "Door Code", "Wifi" |
| `value` | `text` | `NN`, `*` | "4892", "BandonGuest" |
| `created_by` | `text` | `FK → users.id`, `NN`, `*` | Owner who created it |
| `created_at` | `timestamptz` | `NN`, `auto` | `DEFAULT now()` |
| `sort_order` | `integer` | `NN`, `auto` | Defaults to 0; used to maintain display order |

**Indexes:** `trip_id`

**Notes:**
- Tiles are Owner-only in the prototype (`isOwner` gate). In production, enforce via RLS.
- `sort_order` is needed because the prototype renders tiles in insertion order — preserve that in production by ordering by `(trip_id, sort_order, created_at)`.

---

## Derived / View Candidates

These are computed in the application layer in the prototype. In production, implement as Postgres views or generated columns:

| Name | Derived From | Description |
|------|-------------|-------------|
| `trip_status` | `trips`, `date_polls`, `date_windows` | `'planning' \| 'ready' \| 'active' \| 'completed'` — never stored |
| `round_results` | `group_result_scores` | Aggregated team points per round — implement as a view |
| `score_summary` | `round_results`, `side_events` | Total points + remaining per team — computed at query time |
| `unread_count` | `notification_events`, `notification_reads` | Per-user unread notification count |
| `trip_unread_messages` | `messages`, last-seen cursor | Per-user unread message count per trip channel |

---

## Tables Not in Prototype (Add Later)

| Table | Purpose | When to Add |
|-------|---------|-------------|
| `invites` | Pending trip invitations (email-based, pre-account) | When implementing real invite flow |
| `series_history` | Historical stats per user per series | When migrating the "frequently trips with" feature |
| `push_subscriptions` | Web push tokens for background notifications | When adding push notifications |
| `audit_log` | Write history for sensitive actions (role changes, deletes) | When GDPR or admin tooling is needed |

---

## Updated_at Trigger (apply to all tables with `updated_at`)

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to each table:
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Repeat for: reservations, expenses
```

---

## Table Creation Order (respects FK dependencies)

1. `users`
2. `series`
3. `trips` (refs `series`, `events` — use deferrable FK for `event_id` or add after `events`)
4. `events` (refs `trips`)
5. `teams` (refs `events`)
6. `players` (refs `events`, `users`)
7. `team_assignments` (refs `events`, `teams`, `users`)
8. `play_groups` (refs `events`)
9. `rounds` (refs `events`)
10. `side_events` (refs `events`)
11. `group_results` (refs `rounds`, `play_groups`, `users`)
12. `group_result_scores` (refs `group_results`, `teams`)
13. `trip_members` (refs `trips`, `users`)
14. `ideas` (refs `trips`)
15. `idea_votes` (refs `trips`, `ideas`, `users`)
16. `idea_comments` (refs `trips`, `ideas`, `users`)
17. `date_polls` (refs `trips`)
18. `date_windows` (refs `trips`)
19. `date_poll_votes` (refs `date_windows`, `users`)
20. `reservations` (refs `trips`)
21. `expenses` (refs `trips`, `users`)
22. `expense_splits` (refs `expenses`, `users`)
23. `messages` (refs `trips`, `users`, `teams`)
24. `notification_events` (refs `trips`, `users`)
25. `notification_reads` (refs `notification_events`, `users`)
26. `quick_info_tiles` (refs `trips`, `users`)

**Circular dependency note:** `trips.event_id → events.id` and `events.trip_id → trips.id` form a cycle. Resolve by creating both tables without the FK, then adding the constraints with `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... DEFERRABLE INITIALLY DEFERRED`.

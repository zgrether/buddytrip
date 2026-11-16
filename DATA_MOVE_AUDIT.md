# Data-move audit: today's data into crews (X5)

**Spec:** `docs/audits/DATA_MOVE_AUDIT_SPEC.md`, as amended by Zach on 2026-11-16 (see "Rulings applied").
**Base:** `main` @ `eae2b834`. Production and a fresh local replay are both at 228 migrations, latest version `20261106130000` (read 2026-11-16).
**Model:** the spec names Fable 5.1; this pass ran on Fable 5.2.
**Read-only.** No migration, SQL or application code was written. This PR contains this file only.

**How the facts were read**

- Schema: the Postgres catalog of a local database built from the 228 migrations (same version as production). Migrations are cited by number; code by `file:line` at the base commit.
- Production: read-only aggregate queries. Counts and ids only. Names were compared by hash or inside a `WHERE`; none was read into this report.
- Three code sweeps (server procedures, guest and invite code, tests and client plumbing) ran as sub-agents. Claims I re-checked myself are stated plainly; claims I did not re-check are marked **(sweep)**.

---

## 0. Rulings applied (Zach, 2026-11-16)

The audit stopped at the spec's STOP point (one person under several guest rows). These answers reshaped it:

| # | Ruling | Where it lands in this report |
|---|---|---|
| R1 | **D19:** the database is rebuilt as a new schema in a new project; production data moves by a one-time script, not by in-place migrations. **D20:** UUID primary and foreign keys. | §4 is the move-script mapping, replacing the spec's "migration order". §5 becomes "what the rewrite must replace". |
| R2 | Placeholders belong to one crew; no linking across crews. Within a crew, placeholders confirmed to be the same person are merged. In BBMI, the three placeholders of one confirmed person (2023, 2024, 2025) become one. | §3.2 |
| R3 | Two placeholder → account links were written as questions, not rulings. | Open question Q1 |
| R4 | Carry over BBMI 2023–2026 (one crew) and Clemson Fall Golf Trip (its own crew). "Test Apparatus" was written as undecided. Everything else is test data and is dropped. | §3.1, Q2 |
| R5 | Guests on no trip are dropped. In the new schema every placeholder has a crew foreign key. | §3.3 |
| R6 | **D21 (open):** crew role applies on trips you're on, or per-trip organizers. The move keeps each person's old role per trip so either rule can be applied. Owners of carried trips become crew admins. | §3.4, Q3 |
| R7 | The script writes a local-only list of other possible matches. Never committed, never in a report. | §4.3 |

**Where the decisions are recorded.** D19 and D20 are not on `main`; they are in `docs/design/REDESIGN_PLAN.md` on the branch of open PR zgrether/buddytrip#1709 (`origin/claude/brand-glyphs`, lines 206–207). D21 exists only in Zach's message. The new schema itself is not designed yet, so every "new table" name in §2 and §4 is **provisional**: it uses the names the plan already gives (`circles`, `circle_members`, `games.circle_id`, `trips.circle_id`, `competitions.circle_id`) and descriptive names elsewhere.

---

## 1. Inventory (question 1)

51 tables and 1 view (`game_started`) in `public`. All ids are `text` except six tables with `uuid` keys (`archived_ideas`, `golf_courses`, `idea_lodging_options`, `invites`, `logistics_items`, `schedule_items`). Production row counts are exact counts from 2026-11-16 unless marked ≈ (planner statistics).

### 1.1 People and containers

| Table | Rows | Key columns | Unique / FK notes | RLS helpers that read it |
|---|---|---|---|---|
| `users` | 124 (27 accounts, 97 guests) | `id`, `email`, `is_guest`, `created_by`, `notification_prefs`, `deleted_at` | `UNIQUE (email)`; `created_by → users` SET NULL. No FK to `auth.users` (ids are text; cleanup is the `on_auth_user_deleted` trigger). | `users_select`: own row or `shares_trip_with_me(id)` (mig 134). `users_update`: own row or guest + `can_admin_guest` (mig 133). |
| `trips` | 13 | `id`, `title`, dates, `circle_id`, `thread_type` | `circle_id → circles` SET NULL (mig 024). All 13 have `circle_id` NULL and `thread_type = 'trip'`. | `is_trip_member`, `has_trip_role`, `is_trip_planner` |
| `trip_members` | 106 (52 distinct people) | `trip_id`, `user_id`, `role`, `nickname`, travel and departure fields, `chat_visible_from`, `planning_visible_from` | `UNIQUE (trip_id, user_id)`; role CHECK `Owner/Organizer/Member` (mig 029). Trigger `trip_members_role_guard` (mig 205). | Read by every trip helper below. |
| `trip_departures` | 0 | `trip_id`, `user_id`, `display_name`, `team_id` | PK `(trip_id, user_id)` (mig 205, 207) | `is_trip_member` |
| `invites` | 17 (1 unaccepted, 0 unexpired) | `trip_id`, `email`, `role`, `token`, `expires_at`, `accepted_at` | `UNIQUE (token)`; role CHECK `Organizer/Member`; `expires_at` default now + 7 days (mig 001:130). No `max_uses`. | `is_trip_planner`, `has_trip_role` (mig 103) |
| `circles` | 0 | `id`, `name`, `created_by` | mig 024:58–69 | SELECT only: caller is in `circle_members` |
| `circle_members` | 0 | `circle_id`, `user_id`, `role` (default `'Member'`, no CHECK) | PK `(circle_id, user_id)` (mig 024:75–85) | SELECT only: own row |
| `circle_events`, `circle_courses` | 0, 0 | `id`, `circle_id`, `name` | thin stubs (mig 024) | SELECT only: caller is in `circle_members` |

**The circle stubs today.** No application code reads or writes any of the four tables, `trips.circle_id` or `trips.thread_type` by name (zero hits in non-test `src/`) **(sweep)**. There is no INSERT, UPDATE or DELETE policy on any of them, so only the service role can write. `create_trip` (mig 216) does not set `circle_id`. The only writer is `merge_guest_to_real_user`, which re-keys `circle_members.user_id` and `circles.created_by`. `games.course_id` pointed at `circle_courses` in mig 033 and was repointed to the global `courses` in mig 039. `circle_members.role` has no CHECK and `circles` has no owner column, join policy or `archived_at`.

### 1.2 Competitions and games

| Table | Rows | Key columns | Unique / FK notes |
|---|---|---|---|
| `competitions` | 10 (7 points, 3 match play; 4 completed) | `trip_id` NOT NULL (mig 033:20), `scoring_model`, `status`, `defending_team_id`, `clinch_notified_team_id`, `clinch_notified_user_id`, `tiebreak_order text[]`, `starting_point` | `UNIQUE (trip_id)` = `competitions_one_per_trip` (mig 195); `UNIQUE (id, trip_id)` (mig 135) |
| `teams` | 23 | `competition_id`, `name`, `short_name`, `color` | → competitions CASCADE |
| `team_assignments` | 93 | `competition_id`, `user_id`, `team_id`, `is_captain`, `sort_order` | PK `(competition_id, user_id)` |
| `games` | 71 (54 complete, 6 active; 4 side games) | `trip_id` NOT NULL, `competition_id`, `game_type_id`, `course_id`, `back_course_id`, `schedule_item_id`, `config`, `modifiers`, `scorecard_schema`, `credited_roster jsonb`, `bracket_config` | FK `(competition_id, trip_id) → competitions (id, trip_id)` SET NULL on `competition_id` (mig 135): a game's competition must be on the game's trip. |
| `game_participants` | 386 | `game_id`, `user_id`, `play_group_id`, `team_id`, `handicap_strokes` | `UNIQUE (game_id, user_id)`. `team_id` has no FK. |
| `play_groups` | 119 | `game_id`, `display_name`, `tee_time`, `handicap_strokes` | |
| `game_matches` | 84 | `game_id`, `play_group_id`, `side_a jsonb`, `side_b jsonb`, `result`, `status`, `point_value` | sides are `{type, id}` documents: no FK |
| `score_entries` | 1,481 (162 keyed to a play group) | `game_id`, `participant_id`, `participant_type` (`user`/`play_group`), `unit_label`, `value`, `submitted_by` | `UNIQUE (game_id, participant_id, unit_label)`. `participant_id` is polymorphic: no FK. |
| `match_hole_outcomes` | ≈633 | `game_id`, `match_id`, `hole_number`, `result`, `submitted_by` | `UNIQUE (match_id, hole_number)` |
| `skins_hole_outcomes` | ≈74 | `game_id`, `grouping_id`, `hole_number`, `winner_user_id`, `submitted_by` | `UNIQUE (grouping_id, hole_number)` |
| `game_results` | 284 (129 team, 102 user, 53 play group) | `game_id`, `entity_id`, `entity_type` (`user`/`team`/`play_group`/`entrant`), `position`, `points`, `credited_team_id` | `UNIQUE (game_id, entity_type, entity_id)` (mig 194). `entity_id` and `credited_team_id` are polymorphic or unconstrained: no FK. |
| `game_delegates` | 7 | `game_id`, `user_id`, `granted_by` | PK `(game_id, user_id)` |
| `game_recredits` | 1 | `game_id`, `competition_id`, `user_id`, from/to team ids and names, `before`/`after jsonb` | mig 204 |
| `pickem_games` | 5 | `game_id` (PK), deadlines, `roll_up`, `use_confidence` | |
| `pickem_slate_games` | 30 | `game_id`, teams, `result`, scores | `UNIQUE (id, game_id)` |
| `pickem_picks` | 318 | `game_id`, `slate_game_id`, `user_id`, `pick`, `confidence`, `entered_by` | `UNIQUE (slate_game_id, user_id)` |
| `bracket_entrants`, `bracket_entrant_members`, `bracket_matches` | 0, 0, 0 | per `game_id`; entrants may carry `team_id` | |
| `game_type_templates` | 13 | reference data | `UNIQUE (key)` |
| `courses` | 33 | global course library; `created_by` | mig 039 |

### 1.3 Trip planning, money, chat and the rest

| Table | Rows | Person / container columns |
|---|---|---|
| `expenses` | 17 | `trip_id`, `paid_by_user_id` (RESTRICT), `created_by` |
| `expense_splits` | 224 | `expense_id`, `user_id` (RESTRICT). PK `(expense_id, user_id)` |
| `messages` | 362 (101 planning, 38 team) | `trip_id`, `user_id`, `channel`, `team_id`, `visibility` |
| `chat_reads` | ≈71 | PK `(trip_id, user_id, visibility, team_key)` |
| `news_posts` / `news_reads` | 3 / ≈32 | `trip_id`, `author_id` / PK `(trip_id, user_id)` |
| `schedule_items` | ≈30 | `trip_id`, `created_by`, `confirmed_by`, `course_id → golf_courses` |
| `logistics_items` | ≈4 | `trip_id`, `created_by` |
| `quick_info_tiles` | ≈7 | `trip_id`, `created_by` |
| `ideas`, `idea_votes`, `idea_lodging_options` | ≈6, 0, 0 | `trip_id`; votes PK `(idea_id, user_id)` |
| `date_polls`, `date_windows`, `date_poll_votes` | ≈9, ≈23, 0 | `trip_id`; votes PK `(window_id, user_id)` |
| `archived_ideas` | 3 | `user_id`, `original_trip_id` (SET NULL) |
| `push_subscriptions` | 14 | `user_id`; `UNIQUE (endpoint)` |
| `push_send_log` | ≈378 | `trip_id`, `game_id`, `competition_id`, `actor_user_id` (no FKs) |
| `golf_courses`, `catalog_ideas`, `api_usage_daily` | ≈27, 20, ≈10 | reference / global |

### 1.4 RLS helpers and what they read

All are `SECURITY DEFINER` unless noted. "Latest" is the last migration that defines the function.

| Helper | Latest | Answers from |
|---|---|---|
| `is_trip_member(trip)` | 001 | `trip_members` |
| `has_trip_role(trip, roles[])` | 001 | `trip_members.role` |
| `is_trip_planner(trip)` | 029 | `trip_members.role` in Owner/Organizer |
| `shares_trip_with_me(user)` | 134 | two `trip_members` rows on one trip |
| `can_admin_guest(user)` | 133 | caller is Owner of any trip the guest is on |
| `is_game_delegate(game)` | 205 | `game_delegates` + current trip membership |
| `is_team_captain(team)` | 206 | `team_assignments.is_captain` + current trip membership |
| `trip_chat_floor_allows(trip, visibility, created_at)` | 202 | `trip_members.chat_visible_from` / `planning_visible_from` |
| `can_score_unit`, `can_score_match`, `can_score_skins_grouping` | 181, 076, 184 | `game_participants`, via the game's trip |
| `pickem_picks_open`, `pickem_picks_revealed`, `_pickem_can_proxy_for` | 156, 147, 163 | `pickem_games` + `is_trip_member` |
| `assert_game_edit`, `assert_game_owner`, `assert_competition_owner` | 081, 101, 201 | trip role, or delegate |

**Policies.** 39 of the 51 tables have at least one policy that calls a trip helper or names `trip_id`, and `users` depends on trips through `shares_trip_with_me`. The 11 that do not are `archived_ideas`, `push_subscriptions`, `courses`, `golf_courses`, `catalog_ideas`, `game_type_templates`, `api_usage_daily` and the four circle tables. No policy anywhere reads `circle_members` except the circle tables' own SELECT policies.

**Triggers.** `on_auth_user_created` → `handle_new_user` (mig 132); `on_auth_user_deleted` → `handle_user_delete` (mig 132); `trip_members_role_guard` (mig 205); `game_participants_head_to_head_rostered` (mig 193); eleven `broadcast_score_event` triggers on the score and lifecycle tables (mig 196).

---

## 2. The target (question 2)

What each decided rule needs. Under D19 these are requirements on the new schema, not alterations to the old one.

| Rule | Needs | Today |
|---|---|---|
| Crews with members; roles Member · Helper · Admin; several admins (D12, D16) | A crew membership table with a role CHECK of three values; no single-owner column that must be unique; a rule that the last admin cannot leave. | `circle_members.role` is free text, default `'Member'`. `circles.created_by` is the only owner-like column. |
| Every trip belongs to a crew; joining a trip joins its crew (D4) | `trips.circle_id` NOT NULL with a real FK; trip membership implies a crew membership row (constraint or one write path). | `trips.circle_id` nullable, NULL on all 13 (mig 024). |
| A competition belongs to a crew; the trip is optional; one per trip still holds (D11) | `competitions.circle_id` NOT NULL; `trip_id` nullable; uniqueness on `trip_id` only where it is not null. | `trip_id` NOT NULL (mig 033:20); `UNIQUE (trip_id)` (mig 195). |
| A game belongs to a crew or to no crew (D3); "hide from the rest of the crew" (D13) | `games.circle_id` nullable; `games.trip_id` nullable; a boolean for the hide switch; a rule tying a game's competition to the same crew (today's same-trip FK, mig 135, re-expressed for crews). | `games.trip_id` NOT NULL; the composite FK enforces same-trip only. |
| Name-only people per crew, absorbing guests (X5, R2, R5); a per-crew display name | A crew-person row with a crew FK NOT NULL, an optional link to an account, and the name in this crew. Every person reference in games, teams, scores and splits points at it (or at one identity that both placeholders and accounts share). | A guest is a `users` row with `is_guest = true` and no container at all. The per-container name is `trip_members.nickname` (16 rows set). |
| Archive, and soft delete with 30-day restore (D16) | `archived_at` and `deleted_at` on the crew; reads filter both; a purge after 30 days. | Neither exists on `circles`. `users.deleted_at` (mig 132) is the only soft-delete column in the schema. |
| Join policy (guardrail) | `join_policy` on the crew, stored and not shown. | Absent. |
| Invites not trip-only; `max_uses` and `expires_at` per invite (guardrail) | Invite target is a crew or a competition (and a trip); `max_uses`; `expires_at` set per invite. | `invites.trip_id` NOT NULL; `expires_at` defaults to 7 days and is deliberately never checked (`src/server/lib/inviteLink.ts:22-30`) **(sweep)**; a token is single-use only because the claimed guest row is deleted. |
| Entrants are not members (guardrail) | A competition's players are their own rows. | Already true in shape: `team_assignments`, `game_participants`, `bracket_entrant_members`. Authority is not: see §5.1. |
| App-admin flag (X9) | A flag on the person, set for one account. | Absent. |
| Members cannot read each other's contact details (guardrail, D16) | Email kept off anything another member can select: a view, a column grant or a separate table. | `users_select` returns the whole row to anyone sharing a trip (mig 134), and `tripMembers.list` returns `email` for every member (`src/server/routers/tripMembers.ts:93`). |
| UUID keys; people link to `auth.users`; deleting an account cascades (D20) | See the conflict below. | All ids `text`; no FK to `auth.users`. |

### Two rules that need reconciling

Neither stops the move, but both must be settled in the schema design.

1. **D20 "people link to `auth.users`; deleting an account cascades" against D16 "their scores stay in the crew's games".** Today, deleting an account does not cascade: `handle_user_delete` turns the row into a placeholder (`is_guest = true`, `deleted_at` set, mig 132) so finished games keep their player. A literal cascade from `auth.users` would delete the scores D16 says stay. They fit together only if the cascade removes the *account link* and leaves the crew person in place. That is the same shape R2 and R5 already ask for (a crew person with an optional account), so the reading is available; it should be written down as the meaning of D20.
2. **A placeholder cannot be keyed to `auth.users` at all.** D20 says people link to `auth.users`; R5 says every placeholder has a crew FK. A placeholder has no auth row. Same resolution: the person key used by games and scores is the crew person, and the account is a nullable column on it.

---

## 3. The map (question 3)

### 3.1 What is carried

| Set | Trips | Becomes | Memberships | Person rows (guests) | Competitions | Games | Score rows |
|---|---|---|---|---|---|---|---|
| A: BBMI 2023–2026 (`361e6692`, `e2ca13b6`, `ce778b99`, `f328c206`) | 4 | one crew | 64 | 25 (8) | 4 | 34 | 1,260 |
| B: Clemson Fall Golf Trip (`bf8f1225`) | 1 | its own crew | 4 | 4 (0) | 1 | 3 | 0 |
| C: Test Apparatus (`c6cd4504`), **undecided (Q2)** | 1 | its own crew if carried | 15 | 15 (10) | 1 | 23 | 144 |
| Dropped: the other 7 trips | 7 | not carried | 23 | 16 (14) | 4 | 11 | 77 |

Further counts for A / B / C: teams 11 / 4 / 2; team assignments 63 / 4 / 15; game participants 286 / 12 / 65; play groups 93 / 12 / 7; matches 55 / 0 / 26; hole outcomes 586 / 0 / 47; skins holes 72 / 0 / 0; results 229 / 0 / 40; pick'em picks 256 / 0 / 62; delegates 4 / 0 / 3; expenses 17 / 0 / 0; messages 161 / 6 / 182; news 1 / 0 / 2; invites 14 / 1 / 2; agenda items 13 / 15 / 1.

**Consequences of the dropped set that are easy to miss**

- All 4 side games in production and the only `game_recredits` row are on dropped trips. The carried data therefore contains no side game and no re-credit, so the script's handling of both will be untested by real rows.
- No carried trip has brackets (0 rows anywhere).
- People are shared across sets. 2 accounts are on A and B only, 1 is on A, B and C, 2 are on A and C (one of them also on a dropped trip), and 1 is on C and a dropped trip. One account becomes one person row per crew it is in.
- 7 accounts are on no trip at all. No account is only on dropped trips (the 14 people who are, are all placeholders). An account with no crew still moves as an account (it can sign in); it gets no crew person.

### 3.2 Placeholders → crew people (R2)

- Every guest row is on exactly one trip (no guest is on two). The app reuses a guest row across trips only when it is added by email (`src/server/routers/ghostCrew.ts:138`), and 1 of 97 guests has an email. A name-only guest is a new row per trip.
- So 32 on-trip guest rows carry 20 distinct names. 8 names repeat across trips (20 rows); none repeats within a trip. No guest's name equals an account's name.
- **BBMI:** 8 guest rows on three trips (2023: 2, 2024: 3, 2025: 3; 2026 has none). All 8 have game history and scores; none is in an expense split.
- **Confirmed merge (R2):** `ghost-d19a038c…` (2023), `ghost-b0094794…` (2024) and `ghost-49b8b5f8…` (2025) become one BBMI crew person. They hold 10 game participations between them, on three different trips, so no two of them are in the same game and no unique key collides. A fourth row with the same name, `ghost-1b7301ab…`, is on Test Apparatus; under "no linking across crews" it stays separate if that trip is carried.
- After that merge BBMI has 6 placeholders, fewer if Q1's links are confirmed.

**How `merge_guest_to_real_user` changes.** Today it is global (it moves a guest's rows on every trip) and it deletes the `users` row. In the new model the equivalent is "attach an account to this crew person", scoped to one crew, and nothing is deleted. The list of what it touches today, read from the live function (mig 224), is the list of person references the move script must re-key:

- collision-safe (delete the guest's losing row, then move): `trip_members`, `idea_votes`, `date_poll_votes`, `expense_splits`, `chat_reads`, `news_reads`, `circle_members`, `team_assignments`, `game_participants`, `game_delegates` (`user_id`), `bracket_entrant_members`, `game_results` (`entity_type = 'user'`), `trip_departures`;
- plain moves: `messages.user_id`, `expenses.paid_by_user_id`, `archived_ideas.user_id`, `news_posts.author_id`, `push_subscriptions.user_id`, `game_delegates.granted_by`, `score_entries.participant_id` (`participant_type = 'user'`) and `.submitted_by`, `match_hole_outcomes.submitted_by`, `skins_hole_outcomes.winner_user_id` and `.submitted_by`, `game_recredits.user_id` and `.recredited_by`, `competitions.clinch_notified_user_id`;
- authorship: `created_by` on `quick_info_tiles`, `users`, `invites`, `schedule_items`, `logistics_items`, `idea_lodging_options`, `circles`, `courses`; `schedule_items.confirmed_by`;
- ids inside documents and arrays, which no FK sees: `game_matches.side_a` / `side_b` (`{type:'user', id}`), the **keys** of `games.credited_roster`, `competitions.tiebreak_order text[]`;
- pick'em, delegated to `merge_guest_pickem_picks` (mig 163): `pickem_picks.user_id`, merged sheet by sheet, and `pickem_picks.entered_by`;
- finally `DELETE FROM users` for the guest.

The one column that names a person and is **not** in the merge is `push_send_log.actor_user_id` (a log, not carried). Team references the script must also re-key: `competitions.defending_team_id`, `competitions.clinch_notified_team_id`, `game_results.credited_team_id`, `game_participants.team_id`, `bracket_entrants.team_id`, `messages.team_id`, `chat_reads.team_id`, `trip_departures.team_id`.

### 3.3 Guests on no trip (R5)

65 of 97 guest rows are on no trip, created 2026-06-06 to 2026-08-01, with nothing behind them (no game, team, score or split). They are dropped.

**Cause, confirmed in code:** `trips.delete` deletes the `trips` row and relies on cascade (`src/server/routers/trips.ts:473-489`). The cascade removes `trip_members` but nothing removes the guests' `users` rows, because a guest has no FK to any trip. The cleanup that exists, `delete_orphan_guest_user` (mig 205), is called only from `ghostCrew.remove` (`src/server/routers/ghostCrew.ts:509`). A second contributor is possible and unconfirmed: until 2026-08-21 the test suite could run against production and its teardown deletes trips the same way.

The new schema closes this by construction: a placeholder with a crew FK is deleted with its crew.

### 3.4 Roles (R6, D21 open)

- Carried-trip owners become crew admins: BBMI has 2 distinct Owners across its four trips (`0a567efb…` on 2023–2025, `3f94c780…` on 2026), so the BBMI crew starts with 2 admins. Clemson's owner is `4bb475b1…`. Test Apparatus's is `0a567efb…`.
- 4 BBMI people hold different roles on different trips:

| Person | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| `0a567efb…` | Owner | Owner | Owner | Organizer |
| `3f94c780…` | Member | Member | Member | Owner |
| `4bb475b1…` | Member | Member | Member | Organizer |
| `888fbac2…` | Member | Member | Member | Organizer |

- Across all 13 trips: 46 people are Member everywhere, 2 are Member + Organizer, 2 are Member + Organizer + Owner, 1 is Member + Owner, 1 is Organizer + Owner. No guest holds a role above Member.
- The script keeps the old role on each carried trip membership, untranslated, so either D21 rule can be applied afterwards. What it must not do is collapse the four rows above into one crew role and discard the per-trip values. The two Organizers who never owned a BBMI trip are the cases D21 decides: Helper on the crew, or organizer of 2026 only.

### 3.5 Table by table

| Area | Where the rows go | Lost or ambiguous |
|---|---|---|
| Trips | Each carried trip, with its crew. `thread_type` is `'trip'` on every row and carries no information. | Nothing. |
| Trip members | Crew membership (one per person per crew) plus a trip-attendance row holding the old role, travel and departure fields. | `nickname` is per trip today (16 set) and the target is per crew. No person has two different nicknames, so nothing conflicts in production. `chat_visible_from` / `planning_visible_from` only matter while chat exists. |
| Competitions | One per carried trip, with the trip's crew. | `clinch_notified_*` are send-once claims; carry them or the clinch is announced again. No carried competition has a `tiebreak_order`. |
| Teams, assignments | As they are, re-keyed. | `teams` belong to a competition, not a crew. BBMI's four cups have 11 team rows; whether the same team across years is one crew team is not in the plan (Q4). |
| Games and everything under them | As they are, with `circle_id` from the trip. | Polymorphic ids: see §4.2. 53 games hold a `credited_roster` whose keys are person ids. |
| Pick'em | As it is. | Nothing. |
| Brackets | Nothing to move (0 rows). | Untested by real data. |
| Side games | None in the carried set. | Untested by real data. |
| Expenses, splits | With their trip. All 17 expenses are on BBMI 2026, which has no guests. | Nothing. |
| News | With their trip (1 on BBMI, 2 on Test Apparatus). | Nothing. |
| Chat (`messages`, `chat_reads`) | Chat is retired by the plan ("hidden, not deleted", Phase 6). 161 BBMI messages, 6 Clemson, 182 Test Apparatus. | Whether the new schema has a chat table to receive them is not decided (Q5). |
| Invites | 17 rows, 16 accepted, 0 usable. | Nothing worth carrying except as history; `invites.created_by` counts as "history" for `_trip_history_names` (mig 207), which matters only in the old app. |
| Agenda, lodging, tiles, ideas, date polls | With their trip. | `schedule_items.course_id` points at `golf_courses` (the place lookup), a different table from `courses` (the scorecard library). 5 games link to an agenda item. |
| Courses | Global: all 33 move regardless of trip. Carried games use 19 distinct courses. | `courses.created_by` may name an account that is otherwise dropped. |
| `archived_ideas` | Per account, not per crew. 3 rows. | `original_trip_id` may point at a dropped trip (it is already SET NULL-able). |
| `push_subscriptions` | Per account, 14 rows. | A subscription is bound to the old origin (bbmi.app). Whether it works from a new domain is unconfirmed; assume people re-subscribe. |
| `push_send_log`, `api_usage_daily`, read receipts | Not carried (operational). | Nothing. |
| `auth.users` | 28 auth users for 27 accounts: one auth user has no `public.users` row. | Which account that is and whether it should move is unconfirmed (Q6). Moving auth users between projects (password hashes, OAuth identities) is outside this audit. |

---

## 4. The move script (question 4, rewritten per R1)

No SQL. Order matters only where a row needs its parent's new id.

### 4.1 Order

1. **Reference data:** `game_type_templates`, `catalog_ideas`, `golf_courses`, `courses`. (Templates are seeded by the new baseline; map old template ids to new ones by `key`.)
2. **Accounts:** every `users` row with `is_guest = false`, keyed to its auth user. These ids are already UUID-shaped (0 exceptions), so they can be kept or re-minted; keeping them is simpler if auth users are imported with their ids.
3. **Crews:** one for BBMI, one for Clemson, one for Test Apparatus if carried.
4. **Crew people:** per crew, one per account that is on any of its trips, and one per placeholder after the R2 merges. This step produces the **person map**: (old user id, crew) → new person id. Three old ids map to one new id for the confirmed BBMI merge.
5. **Trips**, then trip attendance (old role kept per trip).
6. **Competitions → teams → team assignments.**
7. **Agenda items** (before games, which reference them).
8. **Games → play groups → participants → matches → scores, hole outcomes, skins holes → results → delegates, re-credits → pick'em games, slate games, picks.**
9. **Trip planning and money:** logistics, tiles, ideas, date polls, expenses, splits, news.
10. **Account-scoped rows:** archived ideas, notification preferences.
11. **Verification** (§4.4).

### 4.2 Old table → new table

"Re-key" means: replace every id with its new UUID through the map built when the parent was written. Old ids that are not UUID-shaped: 96 guest ids are `ghost-<uuid>` and get fresh UUIDs; trips, games, competitions and teams are all UUID-shaped in production (0 exceptions each); other tables were not checked row by row, so the script should mint rather than assume.

| Old table | New table (provisional) | How |
|---|---|---|
| `users` (accounts) | accounts | Copy; `notification_prefs` kept; drop the `chat` preference when chat retires (D18). |
| `users` (guests on carried trips) | crew people | One per placeholder per crew, after merges; new UUID; name becomes the name in that crew. `created_by` → the creating account's person in that crew. |
| `users` (guests on no trip, or only on dropped trips) | not carried | 65 + 14 rows, plus 10 if Test Apparatus is not carried. |
| `trips` | trips | Add crew; drop `thread_type`. |
| `trip_members` | crew members + trip attendance | Crew member once per person per crew; attendance per trip with the old role. `nickname` → name in this crew (first non-null). |
| `trip_departures` | not needed | 0 rows. |
| `competitions` | competitions | Add crew; keep trip. Re-key `defending_team_id`, `clinch_notified_team_id`, `clinch_notified_user_id`, and each element of `tiebreak_order`. |
| `teams`, `team_assignments` | same | Re-key. |
| `games` | games | Add crew from the trip; re-key `competition_id`, `course_id`, `back_course_id`, `schedule_item_id`, `game_type_id`; **re-key the keys of `credited_roster`** and the team ids in its values; inspect `config`, `modifiers`, `bracket_config` and `points_distribution` for embedded ids (not inspected in this audit: unconfirmed). |
| `game_participants`, `play_groups` | same | Re-key, including `team_id` (no FK today, so a dangling value is possible: check). |
| `game_matches` | same | Re-key the `id` inside `side_a` / `side_b` by its `type`: a `user` through the person map, a `play_group` through the group map. |
| `score_entries` | same | Re-key `participant_id` by `participant_type` (162 rows are play groups). |
| `match_hole_outcomes`, `skins_hole_outcomes` | same | Re-key. |
| `game_results` | same | Re-key `entity_id` by `entity_type` (user / team / play group / entrant) and `credited_team_id`. With the R2 merge, two merged placeholders can never share a game (checked), so `UNIQUE (game, type, entity)` holds. |
| `game_delegates`, `game_recredits` | same | Re-key; `game_recredits.before` / `after` are documents holding ids (none in the carried set). |
| `pickem_games`, `pickem_slate_games`, `pickem_picks` | same | Re-key, including `entered_by`. |
| `bracket_*` | same | No rows. |
| `expenses`, `expense_splits` | same | Re-key. |
| `news_posts` | same | Re-key; `blocks` is a document and may embed member ids (unconfirmed). |
| `messages`, `chat_reads` | chat archive, or not carried | Q5. |
| `schedule_items`, `logistics_items`, `quick_info_tiles`, `ideas`, `idea_votes`, `idea_lodging_options`, `date_polls`, `date_windows`, `date_poll_votes` | same | Re-key. `logistics_items.image_urls` point at storage objects, which must be copied between projects (not audited). |
| `invites` | not carried, or history only | None is usable. |
| `archived_ideas`, `push_subscriptions` | per account | See §3.5. |
| `circles`, `circle_*` | n/a | Empty. |

### 4.3 The possible-matches list (R7)

The script writes, to a local file that is never committed, every pair inside one crew where two person rows might be the same person: placeholders with the same or similar name, and a placeholder against an account. It acts on none of them. Only matches Zach has confirmed are merged, and they are passed to the script by id.

### 4.4 Checks the script must pass

- Row counts per table per crew equal the counts in §3.1, less the merged placeholders.
- Every id inside a document or array resolves: `game_matches` sides, `credited_roster` keys, `score_entries.participant_id`, `game_results.entity_id`.
- D19's own check: recompute every game result and every competition standing in the new project and compare with v1's stored `game_results` and leaderboard.
- No person row without a crew; no carried game without a crew.

---

## 5. What the rewrite must replace (question 5)

Under D19 the data-access layer is rewritten, so this is an inventory of trip assumptions, not a list of in-place edits.

### 5.1 Authority comes from the trip, everywhere

- **167 of 195 tRPC procedures** take a `tripId` and gate on it; 1 resolves the trip from an idea; 27 have no trip assumption **(sweep; I re-counted `games.ts`: 28 procedures, 27 guarded on a `tripId`)**.
- No guard derives the trip from a game, competition or team. `requireGameEdit`, `requireGameRunAction`, `requireCompetitionRole` and `requireTeamIdentityEdit` all read `tripId` from the input (`src/server/middleware.ts:141`, `:201`, `:288`, `:319`).
- **Competition roles are not stored.** `resolveCompetitionRole` maps the caller's trip role to owner / organizer / member (`src/server/middleware.ts:122`). A competition with no trip has no source of authority today. D21 decides what replaces it.
- `canEditGame` is trip role or a `game_delegates` row (`src/server/middleware.ts:262`).

### 5.2 Database functions that assume a trip

- Take `p_trip_id`: `create_trip`, `save_game_config`, `game_config_hash_input`, `delete_competition_cascade`, `reset_competition_scoring`, `reset_competition_to_skeleton`, `assert_competition_owner`, `set_team_captain`, `link_guest_to_account`, `archive_trip_member`, `increment_member_email_count`, `_trip_history_names`. Nine are called from application code with a trip argument **(sweep)**.
- Resolve the trip from a game or team and then check trip membership or role: `assert_game_edit`, `assert_game_owner`, `is_game_delegate`, `is_team_captain`, `can_score_*`, `pickem_picks_open`, `pickem_picks_revealed`, `_pickem_can_proxy_for`, `pickem_sheet_status`, `save_pickem_picks_for`, `captain_add_player`, `captain_remove_player`, `reorder_team_roster`, `update_team_identity`, `recredit_games`, `recredit_fingerprints`.
- Guest lifecycle, all replaced by the crew-person model: `handle_new_user`, `handle_user_delete`, `merge_guest_to_real_user`, `merge_guest_pickem_picks`, `link_guest_to_account`, `claim_placeholder_by_invite`, `delete_orphan_guest_user`, `can_admin_guest`, `lookup_user_by_email`.
- `broadcast_score_event` (mig 196) sends on `competition_events:<competitionId>`, or `trip_events:<tripId>` for a game with no competition. A game with neither has no topic.
- `trip_status(trips)` (mig 020) is the source of trip mode (D15) and carries over as logic.

### 5.3 Client plumbing **(sweep)**

- Every game and competition page is under `src/app/trips/[tripId]/`. No competition or game route exists outside a trip.
- `useTripId()` has 13 call sites, including all six game views and `LiveFaceClient`. `useTripRole` has 11.
- The href builders all take a trip id: `gameHref`, `gamesPageHref`, `rostersHref`, `gamePanelHref` (`src/lib/gameRoutes.ts`), and the push links `gameUrl` / `cupUrl` (`src/server/lib/gameFinishNotify.ts:404-411`).
- The board loads by trip: `competitions.getByTrip`, `competitions.faceBootstrap` and `games.listByTrip`.
- Realtime topics keyed by trip: chat, members, trip data, and the competition row (`competition:<tripId>`). Keyed by game or competition: `game:<gameId>` and the score broadcast.
- Every multi-recipient push that carries a trip id is filtered to current trip members (`src/server/lib/sendPushToUsers.ts:176-187`), including game and cup pushes. A crew competition's pushes need the same filter on crew membership.
- Local storage keyed by trip: setup-guide and itinerary-filter flags, the last-trip pointer (also a cookie), and the four chat caches.

### 5.4 Tests and specs **(sweep)**

- 229 test files import the shared seeding helper and 214 create a trip through it. `createCompetition` requires a trip id (`src/__tests__/helpers/test-setup.ts:322`).
- All four merge-blocking E2E specs (`critical-path`, `match-play`, `side-game`, `chat-action`) insert their own trip with the service role and navigate by `/trips/<id>` URLs. `chat-action` tests a feature the plan retires.
- Guards that pin a trip assumption and will need rewriting, not just re-pointing:
  - `src/components/TripIdProvider.test.ts`: only the provider may read the `tripId` param.
  - `src/components/games/sideGamePaths.guard.test.ts`: exits and deletes must go to `gamesPageHref(tripId)`.
  - `src/__tests__/helpers/oneCupPerTrip.guard.test.ts` and `competitions.oneCupPerTrip.test.ts`: one competition per trip (still true for trips under D11).
  - `src/lib/bootstrapSeed.guard.test.ts`: the seeded keys include `getByTrip` and `listByTrip`.
  - `src/server/routers/configHash.coverage.test.ts`: the hash input takes `p_trip_id`.
  - `src/hooks/useRealtimeScoreEvents.contract.test.ts`: pins the `trip_events:` topic.
- 16 `*.rls.test.ts` files frame every refusal as "not on this trip". Their cases carry over as "not in this crew" one for one, and CLAUDE.md's rule 30 (a relationship row is never enough without current membership) applies to crew membership from the first policy.
- Tests of the pure scoring engine and the persistence-agnostic game screens take no trip and carry over unchanged, which is what D19 expects. This audit did not list them.

---

## 6. Open questions for Zach

| # | Question | What the data says |
|---|---|---|
| Q1 | Two placeholder → account links were written as questions. Confirm or reject each. | **First:** BBMI 2023 placeholder `ghost-f82dcb8b…` → account `e40dd532…` (on BBMI 2026 only). No collision: they share no trip. **Second:** BBMI 2025 placeholder `ghost-add2df53…` → an account matched by surname, and **two accounts match**: `3f94c780…` and `e1fab1ab…`. `3f94c780…` is itself on BBMI 2025, shares 4 games with the placeholder and is on the same cup roster, so it cannot be the same person. `e1fab1ab…` is on 2023 and 2026, not 2025, and shares no game. If the link is right, it is to `e1fab1ab…`. |
| Q2 | Is Test Apparatus carried? | 15 people (10 placeholders), 23 games, 144 score rows, 182 messages. It is the only carried source of placeholders outside BBMI, and its owner is a BBMI admin. |
| Q3 | D21: crew role on the trips you're on, or per-trip organizers? | 4 BBMI people differ by year (§3.4). Two were Organizers on 2026 only and never owners. |
| Q4 | Are BBMI's teams the same teams year to year? | 11 team rows across 4 cups, each belonging to one competition. The plan has "team pages with results" (Phase 6) but no crew-level team. Not checked whether names repeat. |
| Q5 | Does chat history move? | The plan hides chat, "not deleted". 349 messages are on trips that may be carried. |
| Q6 | One auth user has no `public.users` row. Move it? | 28 auth users, 27 accounts. Not identified in this audit. |
| Q7 | D20's "deleting an account cascades": confirm it removes the account and its link, and leaves the crew person and their scores (§2). | Today deletion converts the account to a placeholder (mig 132). |

---

## 7. Unconfirmed

- Sub-agent findings marked **(sweep)** were not all re-read line by line. The procedure totals rest on guard lines and input schemas; `games.ts` was re-counted, the other 29 routers were not.
- Whether `config`, `modifiers`, `bracket_config`, `points_distribution`, `news_posts.blocks` or `game_recredits.before/after` embed person, team or group ids.
- Whether any `game_participants.team_id` or `game_results.credited_team_id` dangles (no FK on either).
- Whether ids in tables other than trips, games, competitions, teams and users are UUID-shaped.
- The second cause of the 65 trip-less guests (test runs against production before 2026-08-21).
- Storage objects (lodging photos) and the auth-user import between projects were not audited.
- "Same name" was tested as an exact match after trimming and lower-casing. Near-matches (a short and a long form of one name) are not counted anywhere above; §4.3's list is where they surface.

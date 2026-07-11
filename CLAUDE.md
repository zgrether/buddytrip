# CLAUDE.md

## Project Overview

- **BuddyTrip** — mobile-first group trip planning and competition scoring app
- Repo: github.com/zgrether/buddytrip
- Deployed: bbmi.app

## Stack

- Next.js 15 (App Router) · React 18 · TypeScript · Tailwind v4 · tRPC v11 · TanStack Query v5 · Supabase (Postgres + Auth + Realtime) · Zod · Vitest · Playwright · Vercel

## Glossary — ratified nomenclature (one word per concept, every layer)

Consistency is load-bearing: the same concept under two names is how auth/spec
seams drift. These are the canonical terms — use them in code identifiers, DB
values, and UI copy alike. (Ratified in `TRACKER.md` §3; this is the home of
record.) Any rename must declare which layer it touches —
**display-string** (cosmetic), **code-identifier** (`tsc`+grep catch misses), or
**DB-value** (an enum/string RLS branches on — `tsc` CANNOT catch a missed RLS
string; highest risk, needs an atomic migration + auth verification).

**Competition hierarchy (4 levels):** competition leaderboard (cup standings) →
game scoreboard (one game's state) → game score entry (entering scores) → game
scorecard (hole-by-hole). "hub" is retired. "face" stays a *navigation* term only
(`CompetitionFace.tsx` — a competition is a face, not a tab).

| Concept | Canonical | Note / landmine |
|---------|-----------|-----------------|
| Unit of play | **game** + **match** (a pairing inside match-play) | "round" means golf's 18 holes ONLY — never a game/match |
| Scoring-on / visibility | **enableScoring** / **Live** (first score flips it) / reveal = Go-Live | one action, one name (`matches.activate` was the old alias — renamed) |
| Combatants | **team** (roster) / **side** (slot, may be solo) | preserve the split — a side is a slot, a team is the roster |
| Rights | **Owner / Organizer / Member** (trip) · **co_admin** (comp) · **delegate** (game) | trip role VALUE is `Organizer` (mig 029, not "Planner"); the one game-scope term is `delegate` |
| A person | **member** (trip) / **participant** (game) / **guest** (placeholder) | ghost == guest — grep hazard |
| Container | **competition** (code) / **cup** (UI) | not "Events" |

## Commit Rules

- Commit after each individual task, not at the end of a phase
- Every commit needs a clear message describing what changed
- Create a PR after each phase is complete
- Never merge a PR with failing tests
- Verify a PR's base is `main` before merging unless intentionally stacking — a
  stacked PR merged into its base branch instead of `main` strands its content
  off `main` (the wrong-base incident that left PR 2's work unshipped)

## Issue Tracking (GitHub issues + `TRACKER.md`)

Two layers, kept separate so the issue list stays short enough to actually read.
**GitHub issues = the small, hot, actively-worked set; `TRACKER.md` = slow-moving
strategy + the "someday" nominations** (e.g. the R1 format-architecture refactor,
the full dead-code list, glossary rename sites). Don't promote a tracker
nomination to an issue until it's about to be worked. Labels are two dimensions
only — **type** (`bug`/`dead-code`/`feature`/`refactor`/`chore`) + **priority**
(`bbmi-blocking`/`pre-launch`/`polish`/`post-launch`); the `BBMI 2026` milestone
holds **only** `bbmi-blocking` issues (its 100% bar is the event-critical forcing
function). The standing discipline, followed every session with no reminder:
**(1) Entry rule — actionable, not merely true:** an issue earns its place only
if there's a real version you'd pick up and do; "could be better someday" → a
`// TODO` next to the code, not an issue. **(2) Capture-at-the-source:** when you
scope something out of the current task, file it as a labelled issue *in the same
session* — a report is ephemeral and the finding is lost when the session ends.
**(3) Close-on-merge:** every PR that resolves an issue says `Closes #NN`.
**(4) Prune at the merge seam (the shrink valve):** when a feature/phase merges
and you return to `TRACKER.md` to pick the next item, *in that same moment* scan
open issues and close — as `wontfix` with a one-line reason — anything the merge
made obsolete; the backlog going DOWN during this pass is a success. Prune at the
seam, never on a calendar.

## Testing Rules

- Every new tRPC router gets a Vitest unit test before the task is considered done
- Every new database query gets tested against the test DB the suite uses
- **Critical-path E2E must stay green in CI (merge-blocking).** The one
  Playwright smoke test (`e2e/critical-path.spec.ts`: auth → stroke game →
  scores → scorecard) guards that the assembled spine is reachable — the class
  of break unit tests miss. New screens get E2E coverage **when they touch the
  critical path**; broader per-screen coverage is added as specific regressions
  warrant — not up front. (The old "every screen gets an E2E test" rule was
  aspirational and unmet; this is what's actually enforced.) E2E auth is a
  `storageState` login as `test-owner` (`e2e/auth.setup.ts`); tests seed a unique
  trip and tear it down. The 12 older `e2e/*.spec.ts` are a deferred, mock-based
  set that no project runs yet.
- Tests live next to what they test (`trips.test.ts` alongside `trips.ts`)
- No task is considered complete until its tests pass
- CI runs Vitest (full) + the critical-path Playwright E2E on every push via
  GitHub Actions; both are merge-blocking

## Seed Data Rules

- Mock/test data lives only in `supabase/seed.sql` — never in migration files
- Migration files are production-safe — schema, views, functions, triggers, RLS policies only
- `seed.sql` is never run automatically — manual development use only
- Pre-launch reset (done 2026-06-06): truncated all user/trip-scoped data tables.
  `TRUNCATE users CASCADE` alone is NOT enough — `trips` and its child rows have
  no FK to `users`, so they'd orphan; truncate the full data set and keep the
  reference tables (`catalog_ideas`/`golf_courses`/`game_type_templates`). The 6
  real auth-backed `public.users` rows (Zach ×2 + the 4 shared CI test users) are
  recreated after, matching their `auth.users` UUIDs, so the test suite keeps
  working. A pre-reset JSON snapshot lives in `/backups` (gitignored).

## Document Authority

| Question | Defer to |
|----------|---------|
| What's done vs. what's next? | `TRACKER.md` |
| What's deferred and why? | `DEFERRED.md` |
| Who can do what? | `PERMISSIONS.md` |
| How should it look? | `STYLE_GUIDE.md` |
| What shape is the data? | `supabase/migrations/` (migrations are authoritative) |
| How does Realtime work? | Hooks in `src/hooks/useRealtime*.ts` (code is authoritative) |
| How are the domain + email configured (and how to migrate domains)? | `DOMAIN_AND_EMAIL.md` |
| What patterns must CC follow? | This file (`CLAUDE.md`) |

If documents conflict with each other → stop and flag, do not silently resolve.

## Code Conventions

- All decisions about what to build next come from `TRACKER.md` (forward-strategy SoR)
- Supabase queries use the typed client from `src/lib/supabase.ts`
- Auth guards use the `useTripRole(tripId)` hook
- Error handling: tRPC procedures throw `TRPCError` with appropriate codes
- No hardcoded user IDs, roles, or trip IDs in application code
- Before making any styling change, read `STYLE_GUIDE.md`
- Never use hardcoded hex color values — use tokens from the `--color-bt-*` system
- Never set background colors outside the surface hierarchy defined in `STYLE_GUIDE.md` Section 1

## Enforced Patterns

These patterns have been established through prior work. Follow them exactly — do not invent alternatives.

1. **Optimistic updates** — TanStack Query `onMutate` with rollback on error
2. **TypeScript cache typing** — explicit generics on `queryClient.setQueryData`
3. **Migration naming** — `NNN_descriptive_name.sql` (sequential, no gaps)
4. **RLS INSERT RETURNING split** — separate INSERT and SELECT to avoid RLS race condition
5. **Middleware auth** — `requireAuth` before any `requireTripMember`/`requireTripRole`
6. **Test isolation** — 4 shared persistent users (`test-owner`, `test-planner`, `test-member`, `test-outsider`), unique trips per test
7. **Persistence-agnostic game UI** — scorecard components in `src/components/games/`
   (`ScoreEntryView`, `MatchEntryView`, `MatchCard`, `RelHandicapControl`,
   `StrokeKeypad`, `StandardGrid`, `FinalStandings`) take all data via props and
   emit changes via callbacks (`onChange`/`onClear`/`onFinish`/`onCellTap`).
   **No tRPC / DB / auth inside.** The parent owns persistence — a trip wrapper
   backs them with tRPC; Quick Game (Slice A2) backs the *same* components with
   local storage. Unit count / labels / sections come from `scorecard_schema`
   props, never a literal (no hardcoded `18` / "hole"). Slice B layers the strip +
   stroke pips OVER this Slice A view rather than replacing it (shared
   `entryChrome.tsx` = nav/progress/CTA).
8. **Shared result computation** — the pure scoring/ranking lives in a
   **client-safe** module (`src/lib/strokePlay.ts` for stroke play,
   `src/lib/matchPlay.ts` for match play — no server/DB deps) so the live strip
   (client) and the persisted final record use the SAME function and can't
   diverge. The DB-write wrapper (`src/server/lib/{strokePlay,matchPlay}.ts`)
   imports the pure fn. Mirror this split for every new `result_strategy`, and
   branch `games.finish` on the template's `result_strategy` (data-driven, NOT a
   hardcoded format name) so new strategies slot in without touching `finish`.
9. **Derived values recompute on every input — not just the obvious one.** A value
   derived from multiple inputs must re-derive when *any* of them changes;
   enumerate the full trigger set, not just the one that's easy to think of.
   Match-play hole results derive from `score_entries` +
   `game_participants.handicap_strokes` + roster (`side_a`/`side_b`), so
   `matches.setHandicap` and `matches.assignPlayer` retrigger the recompute
   (`computeMatchPlayResults` + client query invalidation) exactly as a score
   entry does. **Freeze boundary:** recompute in-progress matches only — pass
   `computeMatchPlayResults(..., { skipComplete: true })` so a `complete`/frozen
   result is never rewritten by a late edit (`finish` omits the flag → processes
   all). The tell to watch for: "X is derived from {A, B, C}" but the code only
   re-derives on a change to A.
10. **Bootstrap-seeded caches: invalidate `faceBootstrap`, not just the child
    query.** The competition Live face renders its leaderboard + setup guide from
    child caches (`competitions.leaderboard`, `teams.list`,
    `teamAssignments.list`, `games.listByTrip`, …) that `LiveFaceClient` **seeds
    from `competitions.faceBootstrap`** via `setData` on every mount. So any
    mutation that changes faceBootstrap-snapshotted data — team colors/names,
    assignments, game config, **finalize/lock/score-correction results**, go-live
    — MUST invalidate `competitions.faceBootstrap`, **not only** the specific
    child query. Invalidating just the child is silently undone: the face's
    `setData` re-seed writes the bootstrap's (possibly stale, router-cached)
    value back AND marks the query fresh, so no refetch fires and the surface
    reads stale until the 30s poll. Keep the child invalidate too (other
    surfaces read it directly), but `faceBootstrap` is the one that actually
    refreshes the face. The tell: "I invalidated `competitions.leaderboard` but
    the board is still stale until a hard refresh / the poll." (History: the
    team-color audit established this for setup-data mutations; the rack/1v1
    finalize + correction lag was the same class on the result path.)
11. **Glorious Finishing Holes weight is DERIVED, never snapshotted.** The "last N
    holes worth 2×" modifier (`games.modifiers.glorious_holes: { holes: N }`) is
    applied at COMPUTE time by `holeWeight`/`remainingSwing` (`src/lib/gloriousHoles.ts`),
    never stored on a hole result — flip the flag or change N mid-round and the tally
    just recomputes (nothing migrates). It weights the match tally (a won glorious
    hole is ±2) and, critically, close-out/dormie compare the lead to the WEIGHTED
    `remainingSwing`, NOT raw holes left (a 4-up lead with 3 glorious holes / swing 6
    is still live). Match SINGLES/DOUBLES only, **guarded on `game_type_id`** (via
    `isMatchPlayFormat`) — NOT the competition `scoring_model` (rack is `match_play`
    by scoring_model but is net-stroke entry, excluded). The ONE weighted `matchState`
    (`src/lib/matchPlay.ts`, `buildDecided` now emits `{hole, result}[]`) feeds the
    live client strip AND the server `computeMatchPlayResults`, so they can't diverge.
    The margin string keeps X = weighted lead, Y = raw holes-to-play (so "4&2" is a
    legal, correct glorious margin — do not "fix" it).

## Guest → real-user conversion (auth)

Placeholders/invited crew are `users` rows with `is_guest = true`. When a real
account signs up, the DB does the conversion — there is no app-code path:

- `on_auth_user_created` (trigger on `auth.users`) → `handle_new_user()`.
- If a guest row matches the new email, `handle_new_user` nulls the guest's
  email, inserts the real `users` row, and calls
  `merge_guest_to_real_user(ghost_id, real_id)` to reassign the guest's rows
  (trip_members, team_assignments, idea_votes, date_poll_votes, expense_splits,
  messages, expenses.paid_by, quick_info_tiles.created_by, users.created_by,
  invites.created_by) and delete the guest row. It then marks matching
  `invites` accepted.
- Brand-new emails (no matching guest) skip the merge entirely.
- Deleting a user is also DB-side: `on_auth_user_deleted` (trigger on
  `auth.users`) → `handle_user_delete()` deletes the matching `public.users`
  row (`id = OLD.id::text`); FKs into `public.users` cascade the rest. Added in
  migration 025 — without it, the Supabase dashboard "Delete user" left an
  orphaned `public.users` row and the email stayed blocked by `users_email_key`.

**Keep `merge_guest_to_real_user` in lockstep with the schema** — it runs inside
the signup trigger, so a reference to a dropped table/column makes the whole
signup fail (this exact bug was fixed in migration 023, and migration 024
dropped the `series.owner_id` reassignment in lockstep with `DROP TABLE series`).
When you drop a table or a `user_id`/`created_by` column, update this function in
the same migration.

## Migration Workflow

Migrations are committed as files in `supabase/migrations/` and applied to the remote DB by CI's `supabase db push` step. The CLI compares the `supabase_migrations.schema_migrations` history table against local filenames and **fails when they don't match exactly**.

**Don't apply migrations directly via the Supabase MCP tool** (`apply_migration`, raw `execute_sql` for DDL). It records the migration under the *apply timestamp*, which always differs from the local filename timestamp — guaranteeing the next CI push fails with "Remote migration versions not found in local migrations directory."

**The right flow:**

1. Write the migration file locally (`supabase/migrations/YYYYMMDDHHMMSS_NNN_name.sql`).
2. Apply via the linked CLI so the recorded version matches the filename:
   ```bash
   supabase db push --linked   # applies any new local migrations to remote
   ```
   (Or commit and let CI apply it. Either is fine — both preserve the filename timestamp.)
3. Never edit a migration after it's been applied anywhere — write a new one.

**If you already applied via MCP** and CI complains about an unknown remote version, fix it by deleting the apply-timestamped row from `supabase_migrations.schema_migrations` (history table only — the schema change itself stays in place because migrations are idempotent: `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, etc.). CI's next push then sees the local file as new and re-applies it as a no-op.

## Index Creation

Plain `CREATE INDEX` is acceptable in migration files for tables that are
**small at the time of migration** (the lock is sub-millisecond). This is what
migration 023 did for `idx_messages_user_id`.

For **large live tables** (>100k rows, or high write volume during active use),
use `CREATE INDEX CONCURRENTLY` applied **out-of-band** via the Supabase CLI
(against the linked DB) or the dashboard SQL editor — **NOT in a migration
file**. Supabase wraps each migration in a transaction, and `CONCURRENTLY`
cannot run inside a transaction, so `supabase db push` errors on it.

> If you must keep the index in version control, put the `CONCURRENTLY`
> statement in a separate `.sql` note (or a comment in the migration) and apply
> it by hand — don't let `db push` execute it.

Anticipated tables that will need out-of-band `CONCURRENTLY` indexing once the
competition/gaming engine ships and they carry real volume (none exist yet — the
2026-06-06 reset left the DB near-empty, and the engine tables aren't built):
- `score_entries` (`game_id`, `user_id`)
- `game_results` (`game_id`, `entity_id`)
- `circle_bet_results` (`bet_id`)

Already indexed plainly and fine as-is: `messages` (`user_id`).

## Schema Cleanup Rule

Before any `DROP COLUMN` or `DROP FUNCTION` migration, grep current `main` for
every reference **and** verify against the live DB. **Audit-tool output is a
starting point, not a verdict** — it produces false positives that are dangerous
to act on. Three real examples from this codebase:

- `trips.comparison_mode` and `trips.itinerary_enabled` were flagged "dead" by
  the 2026-05-28 audit but are **load-bearing reads** — `comparison_mode` in
  `page.tsx` + `TripCard.tsx` (and written on trip create); `itinerary_enabled`
  in `HomeTab.tsx` → `ItineraryPanel`. Dropping either breaks the app.
- `merge_guest_to_real_user(text, text)` was flagged "broken / removable" but is
  the **live signup conversion path**, called by the `handle_new_user` signup
  trigger. Dropping it breaks every invited-user signup. (Nothing replaced it —
  it *is* the mechanism; it was fixed, not removed.)

Never drop a column or function without confirming **zero live reads in code**
AND that **nothing in the DB depends on it** (triggers, functions, views, FKs,
RLS policies, default expressions). When in doubt, comment it out / stop and
flag — don't drop.

## ID Type Convention

All primary keys and foreign keys use **`text`**, not `uuid`. This is app-wide —
`users.id`, `trips.id`, `circles.id` are all `text`. Any new FK column
referencing these tables **must be `text`**; a `uuid` FK → `text` PK errors at
migration time (type mismatch). This `text`-id choice is also why `public.users`
has no FK to `auth.users` (uuid) and why user-delete cleanup is a trigger, not a
cascade — see the auth section.

`circle_events` and `circle_courses` (migration 024) are intentionally **thin
anchor stubs** — `id, circle_id, name, created_at` only. Their full columns
(e.g. `thread_id`, `year`, `recap_text`, `video_url`) are deferred to the
competition/history build, when the real shapes are known. When those land,
`thread_id` and every other FK column must be `text` (e.g.
`thread_id text REFERENCES trips(id)`), per the rule above — never `uuid`.

**Course data is global, NOT circle-scoped** (revised in Slice C part 2). A
course's par, stroke index, and per-tee yards are global facts (Pebble Creek's
index is the same for everyone), so they live in a standalone global **`courses`**
table (migration 039) reached via **`CourseService`** (`src/lib/courseService.ts`)
— *not* `circle_courses`, and *not* the dead `golf_course_details` (archived only).
`circle_courses` stays the thin stub, now reserved for a later **Circle-Era join**
(`circle_id` → `course_id` into the global `courses`), never the course-data home.
Applying a course to a game **snapshots** its `par[]` + `handicap_index[]` into
`games.scorecard_schema.units.metadata` (the shape `strokeHoles` reads); the
snapshot freezes once scores exist, and `games.course_id` is kept as provenance.

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

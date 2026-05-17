# BuddyTrip Pre-Launch Audit — Findings

*Read-only audit. Zero deletions or modifications made.*
*Date: 2026-05-16. Auditor: Claude (Opus).*

---

## Summary

| Category | Count |
|---|---|
| Total tables in schema | 34 |
| Fully unused tables | **6** (incl. legacy `reservations`) |
| Tables alive but with dead code | 2 |
| Tables with orphan columns | 3 |
| Migration artifacts (created + dropped) | 11 |
| Total tRPC procedures | 124 |
| Dead procedures (zero non-test callers) | **23** (including `reservations.list` once HomeTab + TripSummaryModal are unwound) |
| Test-only procedures (legitimate test scaffolding) | 0 |
| Unreachable pages / routes | **4** |
| Unused components | **4** files (~5 if you count scoring-formats children) |
| Unused hooks | **2** |
| Unused utilities | **1** |
| Seed data violations in migrations | **0** ✅ |
| Launch blockers (messy partial UIs) | **0** ✅ |

**Top-level verdict:** the codebase is in a clean shape for launch. The dead code is *latent* — not exposed to users — but adds maintenance noise and bloats the schema. There are no half-built features that users can stumble into. The schema squash + dead-code removal will significantly reduce surface area.

---

## Area 1: Dead Database Objects

### Fully Unused Tables

These tables exist in the schema but have **zero** production code paths writing to them. The `row_count` column is the live row count from `pg_stat_user_tables`.

| Table | Row count | Status | Why dead |
|---|---:|---|---|
| `play_groups` | 0 | **DEAD** | Only `playGroups` router writes to it; entire router is test-only. Touched by test cleanup helper. |
| `player_hole_scores` | 0 | **DEAD** | No router. Only referenced in `__tests__/helpers/test-setup.ts` cleanup. Scoring-engine schema scaffolding from migration 062 that was never wired up. |
| `scoreboard_shares` | 0 | **DEAD** | `getScoreboard` (public) is the only live procedure that *reads* the table. **Nothing in the UI creates a share** — `scoreboardShares.create` is test-only, and `/scoreboard/[shareCode]` page exists but is unreachable from the UI. |
| `group_results` | 0 | **DEAD** | All four procedures (`list`, `listScoresByEvent`, `listScoresForRound`, `submit`) are dead. `submit` is technically called by `ScoreEntry.tsx` but that component itself is dead. |
| `golf_course_details` | 0 | **DEAD** | Only the dead `golfCourses.saveDetails` / `getDetails` procedures reference it. |
| `reservations` | 8 | **DEAD (legacy)** | Old name for what's now `schedule_items` (the agenda). `reservations.list` is technically live but **no UI ever reads a reservation row's content** — only `.length` and `.filter(...).length`. Two consumers, both vestigial: (a) HomeTab's `hasItinerary` boolean ORs in `reservations.length > 0`, contributes nothing since the table will be empty in production; (b) TripSummaryModal computes a "Schedule confirmed/unconfirmed" CountRow from `reservations.confirmation_number` — **silently always 0/0 in the live UI** since no UI creates reservations. The 8 rows in the DB are leftover test seed. The correct source for the Schedule count is `schedule_items.is_confirmed`. |

### Tables Alive But With Dead Router Code

| Table | Row count | Note |
|---|---:|---|
| `idea_comments` | 4 | **DEFERRED.md explicitly flags this for removal.** The `ideaComments` router (`list`, `create`) is dead. The table is still read by `ideas.list` (for the comment count badge) — so the read path needs to be unwound before the table can be dropped. |
| `series` | 2 | Entire `series` router (`list`, `create`, `linkTrip`, `transferOwnership`) is dead. `trips.series_id` column is set only via the create payload, never read. |

### Orphan Columns (Schema Has It, UI Never Reads It)

| Column | Status | Notes |
|---|---|---|
| `competitions.motto` | **ORPHAN** | Explicitly documented as abandoned ("the UI no longer reads it") in `CompetitionHeader.tsx` and `CompetitionSetupPanel.tsx`. Still in router input schema, still in `scoreboardShares.getScoreboard` SELECT. |
| `trips.owner_alert` | **ORPHAN** | Set only by `trips.setOwnerAlert` mutation (test-only). Declared in `tabs/types.ts` but never read by any rendered UI. |
| `trips.owner_alert_set_at` | **ORPHAN** | Same as above. |
| `trips.owner_alert_set_by` | **ORPHAN** | Same as above. |
| `trips.series_id` | **ORPHAN** | Goes with the dead `series` table. |

### Migration Artifacts (Created and Dropped in Later Migration)

These tables were CREATEd at one point and DROPped before the final schema. They don't exist in the live DB — listing for completeness so the squash skips them.

- `guest_crew` (created early, dropped in 013 when guests merged into `users`)
- `group_result_scores` (dropped in 062)
- `hole_results` (dropped in 062)
- `players` (dropped in 062)
- `side_events` (dropped in 062)
- `rounds` (dropped in 062)
- `venues` (created in 064, dropped in 067 when geo data moved onto schedule_items / golf_courses)
- `teams`, `events`, `team_assignments`, `play_groups` (dropped in 062 and **recreated** with different shape — current state is the recreated version)

### Dropped Columns

Already removed by past migrations; listed so the squash doesn't accidentally include them:
- `trip_members.guest_crew_id` (013)
- `team_assignments.guest_crew_id` (013)
- `trips.date_poll_active`, `date_poll_state`, `date_set_method` (045)
- `trips.event_id` (062)
- `group_results.round_id` (062)

---

## Area 2: Dead tRPC Procedures

A procedure is **dead** when no non-test file references it via `trpc.<router>.<procedure>` or `utils.<router>.<procedure>`. Listed by router.

### Dead Procedures

| Router | Procedure | Notes |
|---|---|---|
| `competitions` | `hydrate` | Defined as a bundled prefetch for CompTab; never actually called from the frontend (CompTab uses the individual queries directly). Test-only. |
| `datePoll` | `voteOnBehalf` | Test-only. Logically superseded by `castVoteForMember` (which IS called from DatePollCard). |
| `datePoll` | `resetVotes` | Test-only. Superseded by `resetPoll` (which is live). |
| `events` | — | All 8 procedures are alive. |
| `golfCourses` | `getById` | Test-only. |
| `golfCourses` | `saveDetails` | Dead. References dead `golf_course_details` table. |
| `golfCourses` | `getDetails` | Dead. Same. |
| `groupResults` | `list` | Test-only. |
| `groupResults` | `listScoresByEvent` | Test-only. |
| `groupResults` | `listScoresForRound` | Test-only. |
| `groupResults` | `submit` | Called by `ScoreEntry.tsx` only — but `ScoreEntry` itself is never rendered. Effectively dead. |
| `ghostCrew` | `list` | Dead. (create/update/remove are alive.) |
| `ideaComments` | `list` | Dead. **DEFERRED.md flags removal.** |
| `ideaComments` | `create` | Dead. **DEFERRED.md flags removal.** |
| `ideas` | `fork` | No callers. |
| `playGroups` | `list` | Test-only. Whole router is dead. |
| `playGroups` | `create` | Test-only. |
| `playGroups` | `update` | Test-only. |
| `playGroups` | `delete` | Test-only. |
| `reservations` | `list` | **Effectively dead.** Called from page.tsx (prefetch), HomeTab (length-only check), and TripSummaryModal (broken always-0 count). No UI renders reservation row content. See Area 1 for the full story — entire router + table are legacy. |
| `reservations` | `create` | Dead. Test-only. |
| `reservations` | `update` | Dead. Test-only. |
| `reservations` | `remove` | Dead. Test-only. |
| `scoreboardShares` | `create` | Test-only. UI never creates a share. |
| `series` | `list` | No callers. |
| `series` | `create` | Test-only. |
| `series` | `linkTrip` | Test-only. |
| `series` | `transferOwnership` | Test-only. |
| `trips` | `update` | Generic update — no UI call site. (Specific mutations like `lockDates`, `renameTripName`, etc. are live.) |
| `trips` | `setOwnerAlert` | Test-only. Sets the orphan `owner_alert` columns. |
| `tripMembers` | `notifyCrewAboutUpdate` | Defined; no callers. The about-message notification path goes through `tripMembers.sendInvitationBlast` instead. |
| `users` | `frequentTripmates` | Defined; no callers. UI passes `frequentTripmates={[]}` everywhere — never wired to real data. |

**Total dead procedures: 22.**

### Test-Only Procedures (Intentionally Test-Scaffolded)

None. Every test-callable procedure either has a live frontend caller OR is genuinely dead. Tests aren't covering procedures that no UI uses by design.

### Double-Dead (Dead Procedure on a Dead Table)

These are clean removals — both the procedure and the underlying table can go together:

- `playGroups.*` → `play_groups` table
- `groupResults.*` → `group_results` table
- `golfCourses.saveDetails` / `getDetails` → `golf_course_details` table
- `scoreboardShares.create` → `scoreboard_shares` table (note: `getScoreboard` reads the table but no UI link exists)
- `ideaComments.*` → `idea_comments` table (need to also unwind `ideas.list` read first)
- `series.*` → `series` table

---

## Area 3: Dead Frontend Code

### Unreachable Pages / Routes

| Path | Why unreachable |
|---|---|
| `src/app/scoreboard/[shareCode]/page.tsx` | No code in the app generates the `/scoreboard/<code>` URL. `scoreboardShares.create` is not called by any UI. Only middleware whitelists the path as public. |
| `src/app/api/ai/suggest-destinations/route.ts` | Zero callers — no `fetch('/api/ai/suggest-destinations')` anywhere. Matches DEFERRED.md "Claude API destination suggestions". |
| `src/app/auth/signout/route.ts` | UserMenu calls `supabase.auth.signOut()` directly (client-side). The route handler is never hit. |
| `src/app/trips/[tripId]/compare/page.tsx` | **10-line pure redirect to `/trips/[tripId]`.** No code in `src/` pushes to or links `/trips/<id>/compare`. The comparison UI now lives inline on the trip page during the IDEA stage. Vestigial route from before the inline rebuild. Note: `compare/CatalogBrowser.tsx` lives in this folder but IS alive (imported by IdeaZonePanel + ArchivedIdeasBrowser) — it should be moved out of `/compare/` when the route is deleted. |

Reachable pages confirmed: `/`, `/login`, `/dashboard`, `/profile`, `/profile/archived-ideas`, `/invite`, `/auth/callback`, `/auth/reset-password`, `/trips/new`, `/trips/[tripId]`, `/trips/[tripId]/leaderboard`, `/trips/[tripId]/events/[eventId]`.

API routes confirmed live: `/api/places`, `/api/golf-courses/search`, `/api/golf-courses/[courseId]`, `/api/trpc/[trpc]`, `/auth/callback`.

### Unused Components

| File | Size | Note |
|---|---:|---|
| `src/components/ProgressStepper.tsx` | 106 lines | Only mention is a commented-out reference in `TripHeader.test.tsx`. No live importer. |
| `src/components/ScoreEntry.tsx` | ~150 lines | Imported only for **types** (`TeamInfo`, `ScoreEntryResult`) by the 4 scoring-format files. `<ScoreEntry />` JSX never rendered anywhere. |
| `src/components/scoring-formats/{Scramble,Sabotage,Stableford,Skins}Format.tsx` | ~400 lines combined | Only rendered inside `ScoreEntry.tsx`. If ScoreEntry is dead, these are dead by transitivity. |
| `src/app/trips/[tripId]/components/SidebarForStage.tsx` | 71 lines | No importer. |
| `src/app/trips/[tripId]/tabs/components/ActionCard.tsx` | 134 lines | No importer. |

Components in `src/components/competition/scoreboard-styles/` are all live (consumed by ScoreboardPanel's style dispatcher).

### Unused Hooks

| File | Size | Note |
|---|---:|---|
| `src/hooks/useFrequentTripmates.ts` | 67 lines | Fully implemented hook with no importer. The 3 `frequentTripmates={[]}` JSX prop sites pass empty arrays — never wired to this hook. Matches DEFERRED.md "Frequently trips with". |
| `src/hooks/useRealtimeLeaderboard.ts` | 16 lines | Already a documented no-op stub. Safe to delete. |

### Unused Utilities

| File | Size | Note |
|---|---:|---|
| `src/lib/ai/suggestDestinations.ts` | 88 lines | Only imported by the dead `/api/ai/suggest-destinations/route.ts`. Anthropic SDK call for AI destination suggestions per DEFERRED.md. |

### Stub / Placeholder Code

| Item | Status |
|---|---|
| `useRealtimeLeaderboard` | Explicit `// intentionally empty — Phase B re-implements` stub. Safe stub, not user-facing. |
| `frequentTripmates={[]}` passed to CrewSearchInput (3 sites) | API surface exists; data path not wired. Hidden from users (no chips rendered when array is empty). |
| Note on `/scoreboard/[shareCode]` | The page is fully implemented and the `getScoreboard` procedure works. It just has no entry point from the UI. Either resurrect (add a "Share scoreboard" button) or remove. |

No `TODO`/`FIXME` comments representing user-facing incomplete features were found in the rendered UI.

---

## Area 4: Seed Data Contamination

### Migration Violations

**None.** ✅

All 9 `INSERT INTO` statements found across 71 migration files are legitimate:

| File:line | What it is | Verdict |
|---|---|---|
| `005_sync_auth_users.sql:11` | INSERT in `handle_new_user` trigger function body | ✅ Trigger logic, not seed data |
| `013_guest_user_identity.sql:35` | One-shot data migration: `guest_crew` rows → `users` rows | ✅ Schema-change data migration, not seed |
| `020_fix_signup_trigger_ghost_conflict.sql:35,58` | INSERTs in `handle_new_user` trigger body (variant) | ✅ Trigger logic |
| `021_date_poll_maybe_and_ghost_votes.sql:62,85` | INSERTs in trigger function body | ✅ Trigger logic |
| `028_avatar_and_auth.sql:19` | `INSERT INTO storage.buckets ('avatars', 'avatars', true)` | ⚠ Infrastructure setup — borderline. Acceptable for one-shot bucket creation. |
| `028_avatar_and_auth.sql:164,176` | INSERTs in trigger function body | ✅ Trigger logic |

**No hardcoded test UUIDs, no `test-*` accounts, no `@buddytrip.com` test emails, no specific trip names in any migration.**

### `seed.sql` Status

- `supabase/seed.sql` exists — 422 lines. Header reads "BuddyTrip Seed Data — All mock data from buddytrip-2.html translated to SQL." Wrapped in a transaction. Seeds users, trips, members, and related rows. **This is the correct home for test data per CLAUDE.md.**
- `supabase/seed_catalog.sql` exists — 364 lines. Seeds the 20 curated golf trip destinations into `catalog_ideas`. Has a manual-run header: "Run manually: psql $DATABASE_URL -f supabase/seed_catalog.sql".

Both are independent of the production migrations. ✅

---

## Area 5: DEFERRED.md vs. Code Reality

Classification per DEFERRED item.

### Before Launch

| Item | Classification | Notes |
|---|---|---|
| Apple OAuth | **No code at all** | Awaits Apple Developer account. Clean. |
| About panel email blast | **Clean stub** | `lib/email.ts` is alive; in-app notify path exists; email send for this specific case not built. Hidden from users behind existing "Notify crew" button which does fire notifications. |
| Swap Resend sender domain | **No code change needed** | Single `FROM` constant in `lib/email.ts`. Clean. |
| Admin email template management UI | **No code at all** | No `/admin` route exists. Clean. |
| Human-friendly trip URL slugs | **No code at all** | No `slug` column on `trips`. Clean. |
| Preserve polling data on Nevermind | **Clean stub** | Current behavior keeps windows silently. No confirmation step in the UI. |
| Date polling scope selection | **No code at all** | All-crew polling is hard-wired. Clean. |

### Before BBMI 2026

| Item | Classification | Notes |
|---|---|---|
| Carry-over scoring | **Clean stub (schema only)** | `events.modifiers` JSONB column exists, never written to. No UI. |
| Moving tee boxes | **Clean stub (schema only)** | `player_hole_scores` table exists (0 rows, no router). Schema scaffolding from when this was planned. |
| Read-only scorecards | **Blocked by dead code** | Depends on `ScoreEntry`, which is dead. Not user-visible — no clickable group rows. |
| RSVP blast email | **Accidentally complete** | `tripMembers.sendInvitationBlast` exists and is live (called from `CrewEmailPanel.tsx`). The "RSVP" framing in DEFERRED.md predates the unified invitation-blast flow. |

### v2 / Post-Launch

| Item | Classification | Notes |
|---|---|---|
| Individual notification mark-as-read | **No code** | Only bulk markAllRead exists. Clean. |
| Schedule day-by-day calendar view | **Clean stub** | Existing flat list works; no day grouping UI. |
| Logistics confirmed toggle | **Already shipped** | `logistics_items.is_confirmed` + confirm/unconfirm mutations exist and are wired. DEFERRED entry can be removed. |
| Personal travel — flight lookup | **No code** | Manual entry only. Clean. |
| Notification auto-cleanup | **No code** | Clean. |
| Score submitted notifications | **No code** | Clean. |
| Push notifications | **No code** | Clean. |
| D-Day countdown nudges | **No code** | Clean. |
| NOW stage live behavior | **Clean stub** | Stage exists; no behavioral changes wired yet. |
| Save idea for future trip | **Partial — archive only** | `archived_ideas` table + router exist (archive/restore via ArchivedIdeasBrowser). "Save for future trip" specifically is not built. |
| **Remove `ideaComments` router (dead code)** | **Confirmed dead — ready to remove** | Router dead, `idea_comments` table read only by `ideas.list` for the comment count. Need to unwind that read before dropping the table. |
| Quick Score (no-auth scorecard) | **No code, requires schema change** | `events.trip_id NOT NULL` constraint must become nullable. Clean stub. |
| Competition without a trip | **No code** | Same schema constraint dependency. |
| Admin interface | **No code** | No `/admin` route. Clean. |
| Catalog idea management UI | **No code** | `seed_catalog.sql` is the only entry point. Clean. |
| "Frequently trips with" crew shortcut | **Messy partial — surfaced but unwired** | `useFrequentTripmates` hook is fully implemented; `users.frequentTripmates` procedure is fully implemented; **but no caller wires them up.** CrewSearchInput accepts a `frequentTripmates` prop, passed as `[]` everywhere. Hidden from users (empty arrays render nothing), but the latent code is misleading. |
| Claude API destination suggestions | **Messy partial — endpoint exists, unused** | `/api/ai/suggest-destinations/route.ts` is fully implemented; `lib/ai/suggestDestinations.ts` calls the Anthropic SDK. **No UI calls it.** Hidden from users but the endpoint sits there exposed to authenticated requests. |
| RSVP status indicator on dashboard | **No code** | Clean. |
| Unread message count persistence | **Clean stub** | sessionStorage workaround in place. |
| RSVP message — recipient selection | **Clean stub** | Current behavior auto-sends to all. |
| Write Invitation panel move to Crew tab | **No code change** | Still on Home tab. Clean. |

### Launch Blockers (messy partials surfaced in the UI)

**None.** The two "messy partial" items above (`useFrequentTripmates` + Claude API) are latent — users can't see them. They are code-hygiene issues, not launch blockers.

---

## Recommended Phase 2 Actions

Ordered roughly by safety + impact (safest cleanups first):

### Cleanup Tier 1 — Pure deletions, zero risk

1. **Delete dead frontend files** (~500 lines):
   - `src/components/ProgressStepper.tsx`
   - `src/components/ScoreEntry.tsx`
   - `src/components/scoring-formats/` (entire directory: SabotageFormat, ScrambleFormat, SkinsFormat, StablefordFormat, index.ts)
   - `src/app/trips/[tripId]/components/SidebarForStage.tsx`
   - `src/app/trips/[tripId]/tabs/components/ActionCard.tsx`
   - `src/hooks/useFrequentTripmates.ts`
   - `src/hooks/useRealtimeLeaderboard.ts`
   - `src/lib/ai/suggestDestinations.ts` + the `src/lib/ai/` directory
   - `src/app/api/ai/suggest-destinations/route.ts` (+ `src/app/api/ai/` directory)
   - `src/app/auth/signout/route.ts`

2. **Delete `/trips/[tripId]/compare/page.tsx`** — vestigial redirect. Before deletion, move `compare/CatalogBrowser.tsx` to `src/app/trips/[tripId]/components/CatalogBrowser.tsx` and update the two importers (`IdeaZonePanel`, `ArchivedIdeasBrowser`). Then remove the `compare/` directory entirely.

3. **Decide: `/scoreboard/[shareCode]` page** — delete or hook up a "Share scoreboard" button somewhere?

4. **Delete dead procedures** from each router (test files are listed alongside so they go too):
   - `competitions.hydrate` (+ `competitions.test.ts` block)
   - `datePoll.voteOnBehalf`, `datePoll.resetVotes` (+ test blocks)
   - `events` — all alive, no changes
   - `golfCourses.getById`, `saveDetails`, `getDetails`
   - `groupResults.*` — entire router
   - `ghostCrew.list` (+ test block, if any)
   - `ideaComments.*` — entire router (after unwinding `ideas.list` read)
   - `ideas.fork`
   - `playGroups.*` — entire router
   - `reservations.*` — entire router (see below; also delete the call sites)
   - `scoreboardShares.create` (keep `getScoreboard` if you keep the page)
   - `series.*` — entire router
   - `trips.update` (keep specific mutations)
   - `trips.setOwnerAlert`
   - `tripMembers.notifyCrewAboutUpdate`
   - `users.frequentTripmates`

5. **Remove `frequentTripmates` prop from `CrewSearchInput`** and the 3 `frequentTripmates={[]}` call sites (IdeaZonePanel ×2, PlannersPanel ×1). It's dead surface.

6. **Remove `ScoreEntry`-related router unregistration:** drop `groupResults` from `src/server/router.ts` and the import.

7. **Unwind the legacy `reservations` references** (this one has a real user-facing bug fix attached):
   - `src/app/trips/[tripId]/page.tsx` — delete the `prefetchedReservations` `useQuery` (prefetch only, no consumer after step below).
   - `src/app/trips/[tripId]/tabs/HomeTab.tsx` — drop the `trpc.reservations.list.useQuery` call and the `reservations.length > 0` term from the `hasItinerary` boolean. No behavior change (the term has always been false in production).
   - `src/app/trips/[tripId]/components/TripSummaryModal.tsx` — drop the `trpc.reservations.list.useQuery`. **Fix the "Schedule" CountRow** to derive from `schedule_items`: `scheduleConfirmed = scheduleItems.filter(s => s.is_confirmed).length`, `scheduleUnconfirmed = scheduleItems.length - scheduleConfirmed`. The current implementation always shows 0/0 — confirm the fix in the summary modal before launch.
   - After the three call sites are gone, delete `src/server/routers/reservations.ts` (+ test file), remove from `src/server/router.ts`, and drop the `reservations` table from the squash.

### Cleanup Tier 2 — Schema changes (need DB migration in Phase 2 OR baked into squash)

8. **Drop dead tables** — bake into the squashed migration (i.e. just don't include them):
   - `play_groups`
   - `player_hole_scores`
   - `group_results`
   - `golf_course_details`
   - `scoreboard_shares` (if removing the page)
   - `series`
   - `reservations` (legacy — replaced by `schedule_items`; see step 7)
   - `idea_comments` (after `ideas.list` no longer reads it)

9. **Drop orphan columns:**
   - `competitions.motto`
   - `trips.owner_alert`, `trips.owner_alert_set_at`, `trips.owner_alert_set_by`
   - `trips.series_id` (along with the `series` table)

10. **Drop dead functions** that depend on dropped tables:
    - None obvious — all 7 functions (`handle_new_user`, `has_trip_role`, `is_trip_member`, `is_trip_planner`, `merge_guest_to_real_user`, `set_updated_at`, `trip_status`) are alive.

### Cleanup Tier 3 — Doc maintenance

11. **Update DEFERRED.md:** remove the entries that are now obsolete:
    - "Remove ideaComments tRPC router (dead code)" — done
    - "Logistics — confirmed/tentative toggle" — already shipped
    - "Frequently trips with crew shortcut" — note the hook+router are deleted
    - "Claude API destination suggestions" — note the stub route is deleted
    - "RSVP blast email" — restructure to reflect that the blast IS implemented (it's just framed as "invitation blast")

12. **PERMISSIONS.md cross-check:** the matrix still references `MoreTab` (expenses, settings) — confirm those tab names match what's in the code post-cleanup.

---

## Migration Squash Plan

### Pre-flight

1. **Run on a fresh local DB** (`supabase db reset` against a throwaway instance) to validate the squashed file produces the same schema as the live remote.
2. **Capture the authoritative baseline:**
   ```bash
   supabase db dump --schema-only --linked > /tmp/current_schema.sql
   ```
3. **Hand-edit the dump** to remove:
   - The 5 fully unused tables (`play_groups`, `player_hole_scores`, `group_results`, `golf_course_details`, `scoreboard_shares`)
   - `series` table (and the `trips.series_id` FK column)
   - `idea_comments` table (only after `ideas.list` stops reading it — Tier 1 step 3)
   - All orphan columns from Area 1
   - All policies and indexes that reference any of the dropped tables/columns

### Execution Plan

1. Place the cleaned dump at `supabase/migrations/001_initial_schema.sql`.
2. Move all 71 existing migration files to `supabase/migrations/_archive/` (preserving their original timestamps for git history).
3. Update `supabase/migrations/.gitkeep` if it exists; ensure Supabase CLI doesn't pick up files under `_archive/`.

### Required Sections in the Squashed Migration (in order)

```sql
-- 001_initial_schema.sql

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- (any others the dump reveals)

-- 2. Custom types / domains (none currently; placeholder)

-- 3. Tables — dependency order (referenced tables first)
--    a. users               (no FKs)
--    b. series              -- (omit if dropping; check)
--    c. trips               (FK → series, users)
--    d. trip_members        (FK → trips, users)
--    e. invites             (FK → trips, users)
--    f. golf_courses        (no FKs)
--    g. catalog_ideas       (no FKs)
--    h. archived_ideas      (FK → users)
--    i. ideas               (FK → trips)
--    j. idea_votes          (FK → trips, ideas, users)
--    k. idea_lodging_options (FK → trips, ideas, users)
--    l. date_polls          (FK → trips)
--    m. date_windows        (FK → trips)
--    n. date_poll_votes     (FK → date_windows, users)
--    o. competitions        (FK → trips)
--    p. teams               (FK → competitions)
--    q. team_assignments    (FK → competitions, teams, users)
--    r. events              (FK → competitions, golf_courses, schedule_items)
--    s. event_point_distributions (FK → events)
--    t. schedule_items      (FK → trips, golf_courses, events, users)
--    u. logistics_items     (FK → trips, users)
--    v. reservations        (FK → trips)
--    w. expenses            (FK → trips, users)
--    x. expense_splits      (FK → expenses, users)
--    y. quick_info_tiles    (FK → trips, users)
--    z. messages            (FK → trips, users, teams)
--    aa. notification_events (FK → trips, users)
--    ab. notification_reads (FK → notification_events, users)

-- 4. Indexes (use CREATE INDEX IF NOT EXISTS)

-- 5. Functions
--    a. set_updated_at
--    b. handle_new_user
--    c. is_trip_member
--    d. is_trip_planner
--    e. has_trip_role
--    f. trip_status
--    g. merge_guest_to_real_user

-- 6. Triggers
--    a. set_updated_at on trips, expenses, group_results, reservations
--       (drop the group_results trigger if dropping the table)
--    b. on_auth_user_created → handle_new_user (on auth.users)

-- 7. RLS enable + policies (~100 policies)
--    Group by table. Use the existing policy names so future hand-edits
--    are recognizable.

-- 8. Storage buckets (avatars) + storage policies
--    (formerly migration 028)

-- 9. Realtime publication membership
--    ALTER PUBLICATION supabase_realtime ADD TABLE
--      events, competitions, messages, notification_events
--    (the four tables currently in the publication)
```

### Validation

After applying the single migration to a fresh project:

```bash
supabase db diff --schema public > /tmp/drift.sql
# /tmp/drift.sql must be empty (or contain only acceptable cosmetic diffs)
```

### Idempotency Notes

- Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE TRIGGER` (Postgres has no native `CREATE TRIGGER IF NOT EXISTS` — wrap in `DROP TRIGGER IF EXISTS ... CASCADE` first or guard in a `DO $$ ... $$` block).
- RLS policies: `CREATE POLICY IF NOT EXISTS` (PG 15+) is fine for our Postgres 17 target. Confirm during validation.
- Extensions: `CREATE EXTENSION IF NOT EXISTS` always.

### Risk Assessment

- **Low risk.** The remote DB is being reset anyway, so there's no live data to preserve. The squash is purely about producing a clean starting point for fresh-installs (e.g. new dev environments, CI, the post-reset production state).
- **One caveat:** the `auth.users` trigger (`on_auth_user_created`) is on a schema (`auth`) we don't own — Supabase manages it. Confirm the trigger is recreated correctly when running on a fresh Supabase project (Supabase usually requires the trigger to be `SECURITY DEFINER` and reference the right schema).

---

## Appendix A: Live Object Inventory

For reference — what's actually wired up and used:

**Live tables (26):** archived_ideas, catalog_ideas, competitions, date_poll_votes, date_polls, date_windows, event_point_distributions, events, expense_splits, expenses, golf_courses, idea_lodging_options, idea_votes, ideas, invites, logistics_items, messages, notification_events, notification_reads, quick_info_tiles, schedule_items, team_assignments, teams, trip_members, trips, users.

(`reservations` moved to dead — see Area 1.)

**Live procedures (102):** all listed routers in `src/server/router.ts` minus the 22 dead procedures enumerated above.

**Live realtime channels:** competitions, events, messages, notification_events.

**Live pages:** `/`, `/login`, `/dashboard`, `/profile`, `/profile/archived-ideas`, `/invite`, `/auth/callback`, `/auth/reset-password`, `/trips/new`, `/trips/[tripId]`, `/trips/[tripId]/compare`, `/trips/[tripId]/leaderboard`, `/trips/[tripId]/events/[eventId]`.

**Live API routes:** `/api/places`, `/api/golf-courses/search`, `/api/golf-courses/[courseId]`, `/api/trpc/[trpc]`, `/auth/callback`.

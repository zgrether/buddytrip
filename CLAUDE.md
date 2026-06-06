# CLAUDE.md

## Project Overview

- **BuddyTrip** — mobile-first group trip planning and competition scoring app
- Repo: github.com/zgrether/buddytrip
- Deployed: bbmi.app

## Stack

- Next.js 15 (App Router) · React 18 · TypeScript · Tailwind v4 · tRPC v11 · TanStack Query v5 · Supabase (Postgres + Auth + Realtime) · Zod · Vitest · Playwright · Vercel

## Commit Rules

- Commit after each individual task, not at the end of a phase
- Every commit needs a clear message describing what changed
- Create a PR after each phase is complete
- Never merge a PR with failing tests

## Testing Rules

- Every new tRPC router gets a Vitest unit test before the task is considered done
- Every new database query gets tested against local Supabase (`supabase start`)
- Every new UI screen gets at least one Playwright E2E test covering the happy path
- Tests live next to what they test (`trips.test.ts` alongside `trips.ts`)
- No task is considered complete until its tests pass
- CI runs Vitest and Playwright on every push via GitHub Actions

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
| What's done vs. what's next? | `PROJECT_STATUS.md` |
| What's deferred and why? | `DEFERRED.md` |
| Who can do what? | `PERMISSIONS.md` |
| How should it look? | `STYLE_GUIDE.md` |
| What shape is the data? | `supabase/migrations/` (migrations are authoritative) |
| How does Realtime work? | Hooks in `src/hooks/useRealtime*.ts` (code is authoritative) |
| How are the domain + email configured (and how to migrate domains)? | `DOMAIN_AND_EMAIL.md` |
| What patterns must CC follow? | This file (`CLAUDE.md`) |

If documents conflict with each other → stop and flag, do not silently resolve.

## Code Conventions

- All decisions about what to build next come from `PROJECT_STATUS.md` (Phase 4 task list)
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

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

# CLAUDE.md

## Project Overview

- **BuddyTrip** — mobile-first group trip planning and competition scoring app
- Repo: github.com/zgrether/buddytrip
- Deployed: buddytrip-app.vercel.app

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
- Before launch: `TRUNCATE TABLE users CASCADE` wipes all test data

## Document Authority

| Question | Defer to |
|----------|---------|
| What's done vs. what's next? | `PROJECT_STATUS.md` |
| What's deferred and why? | `DEFERRED.md` |
| Who can do what? | `PERMISSIONS.md` |
| How should it look? | `STYLE_GUIDE.md` |
| What shape is the data? | `supabase/migrations/` (migrations are authoritative) |
| How does Realtime work? | Hooks in `src/hooks/useRealtime*.ts` (code is authoritative) |
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
7. **Organizer display label** — The `planner` role is displayed as **"Organizer"** everywhere in the UI (CrewTab, chat, Idea Zone, HomeTab planners panel, role badges). DB column values (`role = 'planner'`), tRPC procedures, `TripRole` type, and permission checks (`canEdit`, `isOwner`) continue to use `planner`/`Planner`. Never use "Planner" as a visible label anywhere in the app.

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

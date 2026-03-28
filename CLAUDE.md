# CLAUDE.md

## Project Overview

- **BuddyTrip** — mobile-first group trip planning and competition scoring app
- Spec repo: github.com/zgrether/buddytripworkflow (read-only)
- buddytrip-2.html is the visual spec, types.ts is the data spec, PERMISSIONS.md is the auth spec

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

## Spec Document Authority

- Data shape conflicts → defer to `types.ts` and `SCHEMA.md`
- Permission conflicts → defer to `PERMISSIONS.md`
- UI/behavior conflicts → defer to `buddytrip-2.html`
- Realtime/polling decisions → defer to `REALTIME.md`
- If spec documents conflict with each other → stop and flag, do not silently resolve

## Code Conventions

- All decisions about what to build next come from `PLAN_OF_ATTACK.md`
- Supabase queries use the typed client from `src/lib/supabase.ts`
- Auth guards use the `useTripRole(tripId)` hook
- Error handling: tRPC procedures throw `TRPCError` with appropriate codes
- No hardcoded user IDs, roles, or trip IDs in application code
- Before making any styling change, read `STYLE_GUIDE.md`
- Never use hardcoded hex color values — use tokens from the `--color-bt-*` system
- Never set background colors outside the surface hierarchy defined in `STYLE_GUIDE.md` Section 1

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

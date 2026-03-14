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

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

## Mutation Pattern — Always Use Optimistic Updates

Every tRPC mutation that modifies a list must use TanStack Query's
optimistic update pattern. Never use simple invalidateQueries alone
on a list mutation — it causes a visible flash as the list empties
during refetch.

Required pattern for all list mutations:
- onMutate: snapshot current cache with getData(), apply optimistic update with setData()
- onError: roll back to snapshot
- onSettled: invalidate and refetch in background

Simple invalidateQueries is acceptable for:
- Delete operations (item disappears immediately, no flash)
- Non-list mutations (status changes where there's no list to flash)

See expenses.create mutation in MoreTab.tsx for reference implementation.

## TypeScript — Optimistic Update Cache Typing

When writing optimistic updates with TanStack Query's setData,
do not rely on callback parameter inference:

```ts
// WRONG — TypeScript may not infer (old) type correctly
utils.someRouter.list.setData(key, (old) => [...old, newItem])

// RIGHT — use the prev snapshot from getData() which is already typed
const prev = utils.someRouter.list.getData(key)
utils.someRouter.list.setData(key, [...(prev ?? []), newItem])
```

For array item callbacks (map/filter/some), add explicit type
annotations when TypeScript can't narrow from context:

```ts
votes.filter((v: { user_id: string }) => v.user_id !== userId)
```

See ideas mutations in compare/page.tsx for reference implementation.

## Migration Files — Naming and Application

Every schema change must follow this exact process:
1. Create a local file: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
2. Commit the file
3. CI applies it via `supabase db push`

Never use MCP execute_sql for schema changes. MCP SQL is for
data queries and debugging only. Direct SQL applied via MCP
creates a timestamp mismatch in supabase_migrations.schema_migrations
that breaks CI db push.

## RLS — INSERT RETURNING Split Pattern

Never use `.insert().select().single()` when the SELECT RLS policy
depends on state created by the INSERT itself.

```ts
// WRONG — SELECT policy fires before member row exists
const { data } = await supabase.from("trips").insert(trip).select().single()

// RIGHT — split into separate operations
await supabase.from("trips").insert(trip)
await supabase.from("trip_members").insert(member)
const { data } = await supabase.from("trips").select().eq("id", tripId).single()
```

The trips.create router is the canonical example of this pattern.

## Auth — Middleware getSession vs getUser

Use getSession() in middleware, not getUser():

```ts
// WRONG — makes a network roundtrip to Supabase on every navigation
const { data: { user } } = await supabase.auth.getUser()

// RIGHT — verifies JWT locally, no network call
const { data: { session } } = await supabase.auth.getSession()
```

Tradeoff: a revoked token could pass middleware until it expires.
This is acceptable because tRPC procedures and RLS policies enforce
actual auth on every data query regardless.

## Test Isolation — Shared Users, Unique Trips

Tests use 4 shared persistent users (owner, planner, member, outsider).
Never create unique users per test file — it hits Supabase auth rate limits.
Test isolation comes from unique trips, not unique users.

Each test file creates its own trip in beforeAll via ctx.createTrip()
which generates a timestamped unique ID. Clean up in afterAll via
ctx.cleanup() which deletes by ID, never by owner_id.

See src/__tests__/helpers/global-setup.ts and test-setup.ts for
the full pattern.

## Form Reinitialization — key Pattern for Async Data

When a form needs to initialize from async data (e.g. an edit form
that loads existing values), use `key={record?.id}` on the form wrapper
instead of useEffect + setState:

```tsx
// WRONG — causes cascading render errors in React 19 strict mode
useEffect(() => { setName(me?.name ?? "") }, [me])

// RIGHT — remounts form with correct initial state when data loads
<form key={me?.id}>
  <input defaultValue={me?.name ?? ""} />
</form>
```

The form renders with empty defaults while data loads, then remounts
with real values when the key changes. Add a loading skeleton if the
flash of empty fields is visible.

See profile edit screen for reference implementation.

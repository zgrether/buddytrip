# Contributing to BuddyTrip

New here? Start with [README.md](README.md) to get the app and tests running. This doc is
the workflow — how a change gets from your branch to `main`. The exhaustive, enforced
engineering patterns live in [`CLAUDE.md`](CLAUDE.md); this is the human-sized version.

## Branch → PR → merge

- **Branch off `main`.** Never commit to `main` directly (a ruleset blocks it).
- **Commit after each task**, not at the end of a phase, with a message describing what
  changed and why.
- **Open a PR against `main`.** If it resolves an issue, put `Closes #NN` in the body.
- **CI must be green to merge.** Every PR runs the full Vitest suite + the critical-path
  Playwright E2E (`test` and `e2e` jobs); both are **merge-blocking**. Never merge red.
- **Confirm the PR base is `main`** unless you're intentionally stacking — a stacked PR
  merged into its base instead of `main` strands its work off `main`.

## What "done" means

1. Feature implemented.
2. Tests written and passing (`npm test`).
3. Committed with a clear message.
4. No TypeScript errors — `npx tsc --noEmit` passes.
5. No console errors in the browser.

## Testing

- **The local Supabase stack must be running** (`npx supabase start`) — the suite runs
  against it, and the Vitest global setup creates the shared test users on it.
- Every new tRPC router and every new DB query gets a test. Tests live next to what they
  test (`trips.test.ts` beside `trips.ts`).
- The critical-path E2E (`e2e/critical-path.spec.ts` + `match-play.spec.ts`) must stay
  green — it guards the assembled scoring spine. Add E2E coverage for new screens **when
  they touch the critical path**.
- A red integration test under concurrent load is *suspect* until reproduced in isolation
  (`npx vitest run <file>`) — the suite shares one local Postgres, so a load hiccup can
  look like a break. CI retries twice for exactly this reason.

## Database migrations

Migrations are SQL files in [`supabase/migrations/`](supabase/migrations) and are
**authoritative for the data shape**.

- **Naming:** `NNN_descriptive_name.sql`. The `NNN` is cosmetic (Supabase orders by the
  full `YYYYMMDDHHMMSS_` timestamp prefix); check `main` for the next free `NNN` before
  picking one, since two open branches can grab the same number.
- **They must replay cleanly from an empty database.** CI boots a fresh local stack and
  applies the *entire* history on every run, so a migration that isn't reproducible from
  zero (e.g. a delete keyed on environment-specific ids) fails CI immediately. Keep them
  additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, guarded
  inserts).
- **Never edit a migration once it's been applied anywhere — write a new one.**
- **Don't apply migrations via the Supabase MCP tools** — that records them under the
  apply timestamp, which won't match the filename and breaks the CLI's history check.
- **Applying to prod is manual and separate from merging:** `supabase db push --linked`
  (CI no longer pushes to the prod project). Land a migration as its own PR to `main`
  before the feature branch that depends on it.

See [`CLAUDE.md`](CLAUDE.md) → *Migration Workflow* and *Schema Cleanup Rule* for the full
detail (including the audit-before-delete rule for any `DROP`).

## Issues & tracking

- **Actionable-now → a GitHub issue**, labelled by **type** (`bug` / `dead-code` /
  `feature` / `refactor` / `chore`) + **priority** (`bbmi-blocking` / `pre-launch` /
  `polish` / `post-launch`). The `BBMI 2026` milestone holds only `bbmi-blocking`.
- **Real-but-not-soon → [`TRACKER.md`](TRACKER.md)** (the forward-strategy system of record).
- **Capture at the source:** when you scope something out of your task, file it in the same
  session — a finding lost to the end of a session is a finding lost.

## Conventions worth knowing up front

- Supabase access goes through the typed clients in `src/lib/` (`supabase.ts`,
  `supabase-server.ts`, `supabase-admin.ts`) — never a raw client.
- tRPC procedures throw `TRPCError` with an appropriate code.
- No hardcoded user/role/trip ids in application code.
- Styling: read [`STYLE_GUIDE.md`](STYLE_GUIDE.md) first — use the `--color-bt-*` tokens
  and the surface hierarchy; never hardcode hex colors.

For everything else — optimistic-update idiom, config-hash sync, the score outbox, game
chrome, and the rest of the enforced patterns — [`CLAUDE.md`](CLAUDE.md) is the home of record.

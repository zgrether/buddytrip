# BuddyTrip

Mobile-first group trip planning and competition-scoring app. Deployed at [bbmi.app](https://bbmi.app).

**Stack:** Next.js 15 (App Router) · React 18 · TypeScript · Tailwind v4 · tRPC v11 · TanStack Query v5 · Supabase (Postgres + Auth + Realtime) · Zod · Vitest · Playwright · Vercel.

---

## Prerequisites

- **Node 20** — pinned in [`.nvmrc`](.nvmrc). With nvm: `nvm use` (or `nvm install`). *(CI runs Node 20; Vercel builds on Node 24 — both are within Next 15's supported range.)*
- **npm** — the package manager (a `package-lock.json` is committed).
- **Docker** — must be running for the local Supabase stack.
- **Supabase CLI** — comes as a dev dependency, so `npx supabase …` works after `npm install` (or install it globally).

## Quick start

> **The one thing that isn't optional:** the app and the test suite run against a **local Supabase stack**, not a remote project. Nothing works from a fresh clone until `supabase start` is running. Start there.

```bash
nvm use                       # Node 20
npm install                   # deps (also fetches the Supabase CLI binary)
cp .env.example .env.local    # defaults already point at local Supabase

npx supabase start            # boots the local stack + applies all migrations (needs Docker)
npm run dev                   # → http://localhost:3000
```

`supabase start` prints your local URLs and keys; the `.env.example` defaults already match them, so `.env.local` works as-is. Re-print them any time with `npx supabase status -o env`. Stop the stack with `npx supabase stop`.

### Signing in locally

Open [http://localhost:3000/login](http://localhost:3000/login) and **sign up with email + password** — no external setup needed. Confirmation and magic-link emails are caught by Supabase's local mailbox (**Inbucket**) at [http://127.0.0.1:54324](http://127.0.0.1:54324). "Sign in with Google" is optional locally — it works only if you set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see [`.env.example`](.env.example)).

## Running the tests

The Supabase stack must be running (`npx supabase start`) — the tests connect to it, and the Vitest setup creates the shared test users on it.

```bash
npm test                      # Vitest: unit + tRPC/DB integration (against local Supabase)
npm run test:watch            # Vitest in watch mode

npx playwright install chromium   # once, to get the browser
npm run test:e2e              # Playwright critical-path E2E (auto-starts `next dev`)
npm run test:e2e:ui           # Playwright in UI mode
```

CI runs the full Vitest suite plus the critical-path Playwright E2E on every PR to `main`; **both are merge-blocking**. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Scripts

| Script | Does |
|--------|------|
| `npm run dev` | Next dev server on :3000 |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` / `npm run test:watch` | Vitest run / watch |
| `npm run test:e2e` / `test:e2e:ui` | Playwright E2E / UI mode |
| `npm run lint` | ESLint *(not run in CI today)* |

Type-check with `npx tsc --noEmit` (CI enforces it).

## Shipping a change

Branch off `main` → make it green (`npx tsc --noEmit` + `npm test`) → open a PR to `main` → CI (`test` + `e2e`) must pass to merge. Full rules — commits, migrations, testing, "done" — in **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Where things live

| Question | Doc |
|----------|-----|
| Patterns & conventions to follow | [`CLAUDE.md`](CLAUDE.md) |
| How to contribute (commits, PRs, migrations, tests) | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What's done vs. next (forward strategy) | [`TRACKER.md`](TRACKER.md) |
| Environments / CI / deploy map | [`ENVIRONMENT_AUDIT.md`](ENVIRONMENT_AUDIT.md) |
| Who can do what | [`PERMISSIONS.md`](PERMISSIONS.md) |
| How it should look | [`STYLE_GUIDE.md`](STYLE_GUIDE.md) |
| What's deferred and why | [`DEFERRED.md`](DEFERRED.md) |
| Domain & email setup | [`DOMAIN_AND_EMAIL.md`](DOMAIN_AND_EMAIL.md) |
| Data shape | [`supabase/migrations/`](supabase/migrations) (authoritative) |

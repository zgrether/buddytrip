# Environment & CI/CD Audit

**Date:** 2026-07-18 · **Scope:** Supabase · GitHub Actions · Vercel · repo hygiene
**Status:** current-state map + tiered target proposal. This is the reference map future
infra decisions defer to. When any fact here changes, update this file.

> **Goal (Zach's words):** "set it up correctly once — Supabase, Vercel, GitHub — so any
> dev who joins is ready from the moment they walk in the door." The test for *done*
> (later, not here): could someone who wasn't in these sessions clone the repo and ship,
> from the docs alone, without asking anyone?

---

## 0. TL;DR — the one root and the three fires

Prod, CI, and local dev **all share the single Supabase project `nezhuwyfirrbmyojpiyx`.**
That one fact is the root of three separate "fires":

- **The Disk-IO budget email** — the test suite's create/teardown churn (hundreds of
  thousands of insert/delete cycles) + the autovacuum storms it triggers burn prod's IO
  budget. Cache hit is ~100%; this is write/vacuum load, not reads.
- **The migration deadlocks** — `db push` from an unmerged branch leaves `main` behind
  remote and freezes every other branch's `db push` (bit 3× this month).
- **The test flakiness** — one shared remote under concurrent CI load; the 60s timeouts and
  sequential seeding in `vitest.config.mts` exist to paper over it.

Separating the test database from prod (already scoped, ~½ day, zero app-code risk — ships
first as its own PR) removes all three at once. Everything else in this doc is the
deliberate follow-on.

**Highest-severity finding (verified 2026-07-18):** the Vercel **Preview** environment
points at **production** Supabase *and* carries the **RLS-bypassing service-role key**. See
§1.3.

---

## 1. Current-state map

### 1.1 Environments & data (Supabase)

- **One project, three consumers.** `nezhuwyfirrbmyojpiyx` (`BuddyTrip`, us-west-2,
  Postgres 17) is the *only* project on the org (`list_projects`). No staging, no preview
  project, no Supabase branches. It serves **prod** (`bbmi.app`), **CI** (both `ci.yml` jobs
  push migrations + run the suite against it), and **local dev** — `.env.local` points at it
  and is loaded by `vitest.config.mts`, `src/__tests__/helpers/global-setup.ts`, and
  `playwright.config.ts`. **A developer running `vitest` locally writes production.**
- **Reference data is fully reconstructable** (no hidden local-DB blocker). The one
  reference table the game tests FK against — `game_type_templates` — is seeded by
  migrations `034/036/041/044/051/055`. No migration seeds `courses` or `catalog_ideas`, and
  the suites that need them create+delete their own rows (`courses.test.ts`,
  `games.9hole.test.ts`, `games.test.ts`). A fresh `supabase start` reconstructs everything
  the suite touches.
- **Auth-session leak** (same shared-project root). Live counts 2026-07-18:

  | Table | Rows | Note |
  |---|---:|---|
  | `auth.refresh_tokens` | 7,906 | against just **10** auth users |
  | `auth.sessions` | 6,844 | **5,396** are >7 days old; oldest 2026-05-17 |
  | `auth.mfa_amr_claims` | 6,844 | — |
  | `public.users` (guests) | 46 | lingering placeholders |

  Every CI/test run signs in the 4 shared users (`global-setup.ts:82-98`) + E2E's
  `auth.setup`, and nothing signs out or prunes. GoTrue doesn't auto-expire inactive
  sessions, so two months of runs have piled up. These three `auth.*` tables are now the
  largest in the DB. Fixing the environment split stops the accumulation.

### 1.2 The pipeline (GitHub Actions)

- **One workflow** (`.github/workflows/ci.yml`), two jobs, **both merge-blocking**:
  - `test` (`:14-41`): `supabase db push --db-url "$SUPABASE_DB_URL"` → `tsc --noEmit` →
    `vitest run`
  - `e2e` (`:47-79`, `needs: [test]`): build → Playwright (`critical-path` **and**
    `match-play` specs — `playwright.config.ts:33`)
- **Trigger gotcha CONFIRMED.** `on:` lists only `branches: [main]` for both `push` and
  `pull_request` (`ci.yml:2-6`). A bare feature-branch push runs **nothing** — no CI, no
  migration apply.
- **`main` IS protected — via a modern Repository Ruleset** ("Main protection", id
  17944200), *not* classic branch protection (that endpoint returns 404, which misleads a
  casual check). Requires the `test` + `e2e` checks, blocks deletion + force-push, **zero
  bypass actors**. Does **not** require PR review/approval, and `strict: false` (branch need
  not be current with `main` before merge).
- **Migration discipline is tribal, not enforced.** The "land each migration on `main` as
  its own PR first" rule that prevents the cross-branch deadlock exists only as prose in
  `CLAUDE.md:397-426`. No CODEOWNERS on `supabase/migrations/`, no path-gated check. The
  workflow's unconditional `db push` on every PR/push-to-main *is* the deadlock mechanism.
- **Run cancellation:** `concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true`
  (`ci.yml:7-12`) — per-ref; a new commit cancels the stale run on that ref only, never
  `main`. No "Vercel reads a canceled run as failure" note exists anywhere in the repo.
- **Repo secrets** (`gh secret list`): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (all
  consumed by CI) + `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (present but **not used by
  `ci.yml`** — runtime/OAuth, not CI).
- **Repo is PUBLIC** (`visibility: public`) — relevant to §1.3.

### 1.3 Vercel

- **Project `buddytrip-app`** (team `zgrether-1030s-projects`, Hobby plan), Next.js, iad1.
  Production bound to **`main`** (correct). Previews deploy **per-branch and per-PR**
  automatically. Clean deploy history; only `main` merges reach `target: production`. No
  `vercel.json` in the repo.
- **Node version drift:** Vercel builds on **Node 24.x**; CI pins **Node 20**; local dev has
  no pin at all.
- **🔴 Environment-variable scoping (verified from dashboard 2026-07-18):**

  | Var | Scope | Note |
  |---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | All Environments | **Preview → prod Supabase** |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Environments | same |
  | **`SUPABASE_SERVICE_ROLE_KEY`** | **Production + Preview** | **RLS-bypass key live in Preview** |
  | `NEXT_PUBLIC_SITE_URL` | Production + Preview | |
  | `ANTHROPIC_API_KEY` | All Environments | Vercel flags **"Needs Attention"** — investigate |
  | `GOOGLE_PLACES_API_KEY` | Production + Preview | ✅ confirmed live in prod |
  | `GOLFCOURSE_API_KEY` | Production / Preview (two entries) | fine |
  | `RESEND_API_KEY` / `RESEND_FROM` | All Env / Prod+Preview | |

  **The hazard:** every preview deployment runs its server code against **production
  Supabase with the RLS-bypass service-role key**. Mitigation in place: preview URLs are
  behind **Vercel Authentication** (an anonymous fetch 302s to `vercel.com/sso`), and Zach
  is the only pusher today — so current blast radius is small. But the configuration is
  wrong-by-default and gets dangerous once prod holds live round data (September).
  - **Cheap immediate fix:** scope `SUPABASE_SERVICE_ROLE_KEY` to **Production only**.
  - **Real fix (Tier 2):** a separate Preview/staging Supabase so `NEXT_PUBLIC_SUPABASE_URL`
    differs in Preview and previews never touch prod data.

### 1.4 Repo hygiene & onboarding

- **No `README.md`, no `CONTRIBUTING.md`** anywhere tracked. Self-flagged in
  `TRACKER.md:53-55` ("Only remaining gap: no root README"). Contribution rules are
  scattered through `CLAUDE.md`.
- **`PROJECT_STATUS.md` was deleted, not stalled** (commit `63473605`, "delete
  PROJECT_STATUS.md fiction"); `TRACKER.md` is its replacement system-of-record.
- **No committed secrets** (good). Only `.env.example` (placeholders) is tracked;
  `.env.local`, `.test-auth.json`, `e2e/.auth/` are gitignored + untracked. Caveat:
  `.env.local` on disk holds real Supabase-secret / Anthropic / Resend / Google-OAuth keys —
  not a git leak, but a rotation-review item since this tree is shared with agents.
- **`.env.example` is incomplete** — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are used in
  `.env.local` but absent from the template.
- **`npm run lint` is orphaned** — the script exists but CI never runs eslint.
- **Node not pinned locally** — no `.nvmrc`/`.node-version`/`engines`.
- **CLAUDE.md drifts:** says "the ONE Playwright spec" and "12 deferred specs"; reality is
  **2 running, 14 deferred** (`playwright.config.ts:33`).
- **Untracked draft legal docs** — `PRIVACY_POLICY_draft.md` / `TERMS_OF_SERVICE_draft.md`
  duplicate the tracked `src/content/legal/*.md`; clarify which is canonical.

---

## 2. Target proposal — three tiers

### Tier 1 — Correct for a solo founder + occasional collaborator ✅ RECOMMENDED

The minimum that's *right*, not just working. Zero ceremony a team of 1–3 would resent.

| Adds | Why |
|---|---|
| Test DB separated from prod (local `supabase start` for CI + dev) — the carve-out | Kills the IO burn, deadlocks, flake-under-load, and auth leak in one move |
| `.env.local` no longer points at prod | Stops local `vitest` writing production |
| Scope `SUPABASE_SERVICE_ROLE_KEY` to Production-only | Removes RLS-bypass key from Preview (§1.3) |
| README + CONTRIBUTING covering the whole §4 path | Clone-to-ship works from docs alone |
| Node pin (`.nvmrc`/`engines`) reconciling 20↔24 | One Node story across local/CI/Vercel |
| Complete `.env.example` (+ Google OAuth) + fix CLAUDE.md drifts | Template matches reality |
| Migration-first discipline written into CONTRIBUTING | Tribal → documented |

**Cost:** ~1.5–2 days setup, ~0 ongoing. **For:** today.

### Tier 2 — Correct for a small team (2–5 devs shipping in parallel)

| Adds | Cost |
|---|---|
| Dedicated Preview/staging Supabase; Vercel Preview scope wired to it (previews never touch prod data — the *fix* for §1.3) | +½–1 day; ongoing = maintain a 2nd project |
| Documented branch→preview→merge→prod promotion, incl. migration promotion (staging before prod) | doc + light process |
| Branch protection calibrated up: require a PR, 0–1 light reviewers, optionally `strict: true`; `delete_branch_on_merge: true` | minutes |
| Enforce migration-first via CODEOWNERS on `supabase/migrations/` or a path-gated check | converts tribal rule to a gate |

**Cost:** ~2–3 days, modest ongoing. **For:** the second regular committer.

### Tier 3 — Correct for a real org (the ceiling — DEFERRED, do not build toward)

Required blocking reviewers · staging as a full always-on environment · ephemeral per-PR
databases (Supabase branching) · migration approval gates · full observability/alerting ·
formal secret-rotation policy. Reported so the ceiling is on record; premature for 1–3.

### The September lens (3 testers → 30 people mid-round)

What changes when prod holds **live, irreplaceable round data**:

1. **Preview-touches-prod-data (Tier 2) graduates from hygiene to hazard** — a stray preview
   write lands on a real group mid-competition. **#1 to revisit before September.**
2. **Light observability** (a slice of Tier 3 worth pulling forward) — Supabase IO/error
   alerts + Vercel analytics, so a live 30-person round is *visible* when it spikes.
3. **Migration promotion through staging** (Tier 2) — once a bad migration hits users, not
   test rows.

**Recommendation:** **Tier 1 now.** Tier-2 items to revisit before September: (a) separate
Preview Supabase, (b) light IO/error observability, (c) migration promotion via staging.

---

## 3. Sequenced build plan (Tier 1) — each its own PR

- **Step 0 — Test DB split + `.env.local` off prod** *(already scoped, ~½ day, in-flight).*
  Local `supabase start` for CI + dev; disable the placeholder `seed.sql` for the automated
  path; auth leak stops by construction. Zero app-code risk. **Ships first, independent of
  this audit.**
- **Step 1 — Repo docs.** `README.md` + `CONTRIBUTING.md` closing the §4 backlog. Pure docs.
- **Step 2 — Env & tooling hygiene.** `.nvmrc`/`engines` (reconcile Node 20↔24), add Google
  OAuth vars to `.env.example`, fix CLAUDE.md E2E-count drifts.
- **Step 3 — Security hardening.** Scope `SUPABASE_SERVICE_ROLE_KEY` to Production-only;
  investigate the `ANTHROPIC_API_KEY` "Needs Attention" flag; rotate exposed `.env.local`
  keys if warranted; drop or justify the unused `GOOGLE_CLIENT_*` CI secrets.
- **Step 4 — Discipline as docs.** Migration-first into CONTRIBUTING; decide `npm run lint`
  (CI step vs. advisory); resolve the untracked `*_draft.md` legal files.

Order rationale: step 0 stops the bleeding; docs unblock people; hygiene + security are cheap
and de-risk the public-repo exposure.

---

## 4. Onboarding-gap backlog (README/CONTRIBUTING content)

1. Create `README.md` (none exists; self-flagged `TRACKER.md:53-55`).
2. Document `npm install` as the dep step (inferable only from the lockfile).
3. Pin Node for local dev — `.nvmrc`/`engines` (only CI pins Node 20; Vercel uses 24).
4. Document `npm run dev` as the start command.
5. Document test entry points (`npm test`, `npm run test:e2e`) + that they need
   `SUPABASE_SERVICE_ROLE_KEY` + a reachable Supabase.
6. Document local Playwright browser install (`npx playwright install`).
7. Document that dev/test run against Supabase (post-step-0: local stack, no prod).
8. Add `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to `.env.example`.
9. Add `CONTRIBUTING.md` consolidating commit/PR/migration/tsc rules from `CLAUDE.md`.
10. Fix `CLAUDE.md` E2E drift ("one spec"→2, "12 deferred"→14).
11. Decide `npm run lint` status (CI step vs. advisory).
12. Resolve untracked draft legal docs vs. tracked `src/content/legal/*`.

---

## 5. What NOT to build (deferred ceremony — on record)

Explicitly **not** for a team of 1–3, so it doesn't creep in: required blocking reviewers; a
full always-on staging environment; ephemeral per-PR databases (Supabase branching);
migration approval gates; heavyweight observability/SOC2 tooling; formal secret-rotation
cadence. The Tier-3 ceiling — revisit only when headcount or compliance actually demands it.

---

*Produced by a read-only audit. No config, code, or infra was changed in its making.*

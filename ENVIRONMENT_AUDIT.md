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

**Later incident (2026-07-24):** the **third resource fire** — Vercel **Active-CPU** hit 75% of
the Hobby cap on near-zero traffic. Root cause was middleware **307-ing `/api/trpc` to `/login`**,
turning every unauthenticated poll tick into a full page render; the fix is a **401**, not a
matcher change. An initial "backgrounded polling" diagnosis was **wrong** and its fix inert — both
recorded in **§1.5**.

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

- **Two workflows.** `ci.yml` (below) is the merge gate; `prod-migrations.yml` is a
  manual, `workflow_dispatch`-only button documented in **§1.2a**. Nothing else runs.
- **`ci.yml`**, two jobs, **both merge-blocking**:
  - `test` (`:14-41`): `supabase db push --db-url "$SUPABASE_DB_URL"` → `tsc --noEmit` →
    `vitest run`
  - `e2e` (`:47-79`, `needs: [test]`): build → Playwright (`critical-path` **and**
    `match-play` specs — `playwright.config.ts:33`)
  - ⚠️ **Both job descriptions above are the PRE-Step-0 state and are now stale.** #636
    took CI off the shared prod project: each job runs `supabase start` for an ephemeral
    LOCAL stack, applies the whole migration history to it, and references **no secrets at
    all**. `e2e` also runs `chat-action.spec.ts` now (three merge-blocking specs, not two).
    Left in place rather than silently rewritten — the rest of this section was audited on
    2026-07-18 and has not been re-verified since; treat undated claims here accordingly.
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
- **Repo secrets** (`gh secret list`, 2026-07-18): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (all
  consumed by CI) + `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (present but **not used by
  `ci.yml`** — runtime/OAuth, not CI).
  - **Since #636, `ci.yml` consumes none of them** — the four "consumed by CI" secrets are
    now unreferenced by any workflow. They have not been deleted; nothing has re-verified
    their values either, which is why §1.2a uses a **new** secret rather than reusing
    `SUPABASE_DB_URL`.
  - **`SUPABASE_PROD_DB_URL`** (to be added by hand) is the one secret §1.2a consumes.
- **Repo is PUBLIC** (`visibility: public`) — relevant to §1.3, and the reason §1.2a uses a
  DB connection string rather than a Supabase management-API access token.

### 1.2a Applying migrations to prod from Actions — the exception, not the default

`.github/workflows/prod-migrations.yml`. **`supabase db push --linked` from a laptop
remains the correct way to apply a migration.** This workflow is for when there isn't one.

**Why it exists.** Migrations 099/100/101 sat queued while #784 — a fix for a *confirmed
production data-loss path* (a stroke round finalized, the `game_results` write failed
silently, nothing on the leaderboard) — stayed unmergeable for days, because the only
person with prod credentials was away from a laptop. The bug was live and the fix was
green. That is the situation this button is for, and roughly the only one.

**What it does NOT change.** `CLAUDE.md`'s migration workflow is unchanged: application
stays **manual and separate from merging**. That separation is what caught `044`'s
replay bug, and a merge still cannot apply anything. `workflow_dispatch` is the only
trigger — no `push`, no `pull_request`, no `schedule` — and adding one would delete the
gate the rule exists to keep.

| Mode | What runs | Writes? |
|---|---|---|
| **`list`** (default) | `supabase migration list` + `supabase db push --dry-run` | no |
| **`push`** (must be selected) | both of the above, then `db push`, then `migration list` again | **yes** |

**Auth: one secret.** `SUPABASE_PROD_DB_URL` — the production Postgres URI (Supabase →
Project Settings → Database → Connection string → **URI**, session pooler, password
filled in, percent-encoded). Chosen over `link` + `--linked`, which needs *two*
credentials (`SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`) and puts a management-API
token — able to delete the project outright — on a public repo. Same migration applier
either way.

**It does not recreate the MCP-tool problem.** `schema_migrations` records the migration
**filename** timestamp, exactly as `db push --linked` does. (`CLAUDE.md` Migration
Workflow: the Supabase MCP tool records the *apply* timestamp instead, which breaks the
next `db push` with "Remote migration versions not found in local migrations directory.")

**Three guards, each of which fails the job:**

1. **Ref.** Refuses anything but `refs/heads/main`. `workflow_dispatch` offers a branch
   picker, so the single easiest way to damage prod with this file is to dispatch from a
   feature branch and apply its unmerged migrations. The CLI cannot see this — the files
   simply look like migrations.
2. **Project.** The expected ref (`nezhuwyfirrbmyojpiyx`) is a literal in the workflow —
   it already ships to every browser inside `NEXT_PUBLIC_SUPABASE_URL` — and the run
   fails if the secret doesn't reference it. This also puts the target project in the log,
   so a misdirected dispatch is visible rather than silent.
3. **No leakage.** The connection string is never echoed. GitHub masks exact secret values
   but **not substrings**, and the Postgres password is inside it, so the project check is
   shell globbing.

**Flags that are deliberately absent:**

- **`--include-all`.** Without it the CLI stops and names any local migration timestamped
  *before* prod's newest ("Found local migration files to be inserted before the last
  migration on remote database"). That stop is correct: two open branches can pick the
  same `NNN` and ordering is by timestamp (`CLAUDE.md` Enforced Patterns #3), so
  out-of-order application is a live hazard here. The flag converts a loud stop into a
  silent out-of-order apply.
- **Any rollback / `db reset` / seed.** `CLAUDE.md`'s rule is a **new migration**, never an
  edit or an undo. Recovery from a bad migration is Supabase PITR, outside this workflow.

`--yes` is passed to both CLI calls because `db push` prompts (*"Do you want to push these
migrations to the remote database?"*) and would otherwise hang on a non-TTY runner. On the
dry run that is hang-safety only; `--dry-run` is what guarantees nothing is written.

> ### ⚠️ What this workflow does **not** check: the `081` failure
>
> It applies **schema only**. It has no idea what Vercel is currently serving, so it cannot
> tell you whether the code that reads the new schema has deployed. Migration `081` shipped
> ahead of its push once and produced a live *"could not find function `save_game_config`
> in the schema cache."*
>
> The ordering rule is `CLAUDE.md` Migration Workflow §3/§3b and it still applies in full:
> for an **addition**, the migration goes to prod **first**, then the code that reads it;
> for a **removal** (`DROP COLUMN`/`DROP FUNCTION`), the code that stops using it deploys
> **first**, then the drop. Applying a `DROP` from here while the old code is still live
> breaks prod in the other direction. **That sequencing is the operator's judgement — no
> guard in this file can make it for you.**

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

### 1.5 Vercel Active-CPU burn — incident + fix (2026-07-24)

**The third resource fire** (after the Disk-IO email and the Supabase-egress scare): Vercel
warned at **75% of the 4 CPU-hr Hobby Active-CPU allowance** (~3 hrs used, ~1 week left) with
essentially only Zach + CC generating traffic. Active CPU bills *compute only* — I/O wait (DB
queries, external calls) is free — so the burn was rendering per request, not slow queries.
Exceeding the Hobby cap **pauses the feature ~30 days with no mid-cycle buyout**; during a live
BBMI round that means the app is dead for the rest of the trip. (Pro removes the cliff but not
the inefficiency, which scales with real users — so it was fixed, not upgraded around.)

**Root cause — a redirect loop, NOT background polling.** `src/middleware.ts` matched
`/api/trpc` and, for a request with no valid session, returned a **307 to `/login`**. `fetch`
follows a redirect **preserving the method**, so each failed tRPC call re-issued as a request to
`/login` and rendered the **entire `/login` page** — an Edge invocation *plus* a full page
render, returning HTML no tRPC client can parse. The request never reached tRPC, so
`authedProcedure`'s clean `UNAUTHORIZED` → 401 (`src/server/trpc.ts:98-103`) was never produced
and the client never learned the session was dead. It just kept polling.

The cost is per *failed tick*, and with the global `retry: 1` each tick costs **two** of them.
7-day prod runtime logs showed the signature: `games.configHash`, `scores.listByGame`,
`competitions.leaderboard`, `matchOutcomes.listByGame` all **~93% 307**, with **`/login` topping
the path list** and **~1,150 `/login` renders in a single 30-minute window**. The sustained burn
traced to **six open desktop tabs plus CI** — not to phones. (Full derivation:
`DATA_FRESHNESS_AUDIT.md` §6.4, §8-F1.)

**Correction to the original diagnosis (recorded deliberately).** This was first diagnosed as
*backgrounded polling* and "fixed" by adding `refetchIntervalInBackground: false` to the
leaderboard poll. **That was wrong twice over.** The option is optional and **never assigned a
default** anywhere in `@tanstack/query-core`; its one runtime read is
`if (this.options.refetchIntervalInBackground || focusManager.isFocused())`
(`queryObserver.js:215`), so leaving it unset is `undefined` — falsy at that exact `||`, i.e.
already identical to `false`. Background polling was **already paused**; the commit was inert and
was dropped. Corroborating evidence the mechanism was never phone-side: a **locked PWA generates
zero requests**, yet the burn continued. The lesson is the one worth keeping — *a plausible
mechanism that matches the symptom is not the mechanism.*

**The fix: a 401, not a matcher exclusion.** Middleware now returns a tRPC-shaped
`UNAUTHORIZED`/401 for `/api/trpc` and keeps the 307 for page routes. An abandoned attempt
excluded `/api/trpc` from the matcher instead; **that is the one thing this must not do.**
Middleware is the **confirmed token-refresh path** (`DATA_FRESHNESS_AUDIT.md` §6.3): its
`getUser()` rotates cookies via `setAll` onto the returned response, which is why a user who only
polls a leaderboard — never navigating — keeps a live session. Verified empirically: a locked
Android PWA ~85 minutes past access-token expiry resumed to clean 200s. The remaining paths can't
replace it (the tRPC context prefers `getClaims()`, which does no refresh; the browser client is
foreground-only). And because Supabase **rotates** refresh tokens, a server-side refresh whose
cookies never reach the browser strands it on a *consumed* token — the next refresh fails
permanently, which is a hard logout mid-round. **`/api/trpc` stays matched; only the failure
response changed.**

Paired with it, the client now **backs off a dead session** (`authExpiry.ts` + a global
`QueryCache.onError`): a 401 triggers one `refreshSession()` — self-healing the common
expired-access-token case — or, if the session is truly gone, navigates to `/login` (carrying
`?next=`) so the poll loop tears down instead of firing forever. This fixes a real
**mid-round-expiry bug** independent of cost: before it, an expired session left the leaderboard
silently frozen on stale scores while the app kept polling, and nobody would know until they
compared phones. In-flight scores are safe (localStorage outbox, `CLAUDE.md` #15).

**No predicted reduction is recorded here.** The mechanism is understood and the measurements
above are real, but the post-fix curve has not been observed yet, and the last number this
section carried was derived from a commit that did nothing. **Checkable-after** (re-read the
Vercel dashboard): the 307 rate on the four poll endpoints should collapse toward ~0 and `/login`
should fall off the top of the path list. Those are the observations that would justify a number;
until then there isn't one. Web Analytics is **not enabled** — the usage breakdown came from
Observability runtime logs.

**No scheduled work exists** (no `vercel.json`, no crons, no `revalidate` intervals), which is
part of why a request-driven loop was the only mechanism that fit "3 CPU-hrs on near-zero
traffic." **Cross-ref §1.3:** a left-open tab polling a *preview* URL burned this same CPU pool
**and** hit prod Supabase with the service-role key — the two-bill version of the same loop;
scoping that key to Production closes that half.

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

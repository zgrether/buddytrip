# BuddyTrip — Plan of Attack: Prototype → Production

*Migration strategy for turning the buddytripworkflow prototype into a production application.*
*Last updated: 2026-03-11 — Phase 0 complete, Phase 1 in progress (task 5 of 20)*

---

## TL;DR

**Greenfield build on Supabase.** New repo (`buddytrip`), clean Next.js 15 scaffold, Supabase for Postgres + Auth + Realtime. The existing `slowcountrylife` repo is retired — no migration needed (no live users, no production data worth preserving). The `buddytripworkflow` repo is frozen as the spec — never commit to it.

**Estimated effort:** 5 phases, each 2–4 sessions.

---

## Repo Structure

| Repo | Purpose | Status |
|------|---------|--------|
| `zgrether/buddytripworkflow` | Spec only — prototype + all docs | Frozen. Read-only reference. |
| `zgrether/buddytrip` | The real app | Active development |
| `zgrether/slowcountrylife` | Previous attempt | Retired. Do not use. |

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 15 (App Router) | |
| UI | React 18 + Tailwind v4 | |
| API | tRPC v11 + TanStack Query v5 | Type-safe end-to-end |
| Database | Supabase (Postgres) | 26 tables per SCHEMA.md |
| Auth | Supabase Auth | Email/password for v1; OAuth (Google etc.) addable later |
| Realtime | Supabase Realtime | 4 channels per REALTIME.md |
| Validation | Zod | Shared client/server schemas |
| Icons | Lucide React | Same as prototype |
| Testing | Vitest + Playwright | Required on every task |
| Deployment | Vercel | Connected to `buddytrip` repo |

**Real-time strategy:** Start with polling (3–5s refetch) for votes and notifications. Use Supabase Realtime for chat and live leaderboard scores per REALTIME.md. Upgrade notifications to Realtime in Phase 4 if polling feels laggy.

---

## Infrastructure

| Service | Project Name | Status |
|---------|-------------|--------|
| Supabase | BuddyTrip | Active — 26 tables created, seed data loaded |
| GitHub | `buddytrip` (private) | Active |
| Vercel | `buddytrip-app` | Connected to GitHub, env vars set |

**Environment variables set in Vercel:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**PAT note:** GitHub PAT needs both `repo` AND `workflow` scopes (workflow scope required for `.github/workflows/` commits). Revoke after each session.

---

## Spec Document Authority

When in doubt, these documents are the source of truth:

| Question | Defer to |
|----------|---------|
| What does it look like / how does it behave? | `buddytrip-2.html` |
| What shape is the data? | `types.ts` and `SCHEMA.md` |
| Who can do what? | `PERMISSIONS.md` |
| What needs Realtime vs. polling? | `REALTIME.md` |
| What's the overall plan? | This document |
| What decisions were made in the prototype? | `CONTEXT.md` |
| How does scoring work? | `SCORING_PLAYBOOK.md` |

If spec documents conflict with each other → stop and flag, do not silently resolve.

---

## Phase 0 — Scaffold + Database ✅ COMPLETE

**All 10 tasks complete. Committed and pushed.**

| Task | What | Status |
|------|------|--------|
| 0.1 | Next.js 15 scaffold with full stack installed | ✅ |
| 0.2 | Supabase client (browser + server), `.env.local` | ✅ |
| 0.3 | tRPC + TanStack Query wired end-to-end | ✅ |
| 0.4 | Supabase Auth: sign-up, sign-in, sign-out, middleware, `/login` page | ✅ |
| 0.5 | 26 tables created via `supabase/migrations/001_initial_schema.sql` | ✅ |
| 0.6 | `round_results` view, `trip_status` function, `updated_at` triggers | ✅ |
| 0.7 | RLS enabled on all 26 tables, priority policies written | ✅ |
| 0.8 | `supabase/seed.sql` with full BBMI mock data | ✅ |
| 0.9 | Migrations and seed applied to Supabase project | ✅ |
| 0.10 | Smoke test: sign-up → create trip → query back | ✅ |

**Notes:**
- `CLAUDE.md` created in repo root — read automatically by Claude Code each session
- Seed data is in `supabase/seed.sql` only, never in migration files
- To wipe test data before launch: `TRUNCATE TABLE users CASCADE`
- BBMI 2025 trip dates may need adjustment — `getTripStatus()` uses `new Date()` so 2025 dates show as `completed`

---

## Phase 1 — Backend Routers 🔄 IN PROGRESS (task 5 of 20)

**Goal:** All tRPC routers built and tested against Supabase. No UI changes. Every router has a Vitest test file.

| Task | Router | Status |
|------|--------|--------|
| 1.0 | CI workflow (`.github/workflows/ci.yml`) — Vitest + Playwright on every push | ✅ |
| 1.1 | Shared middleware: `requireAuth`, `requireTripMember`, `requireTripRole` | ✅ |
| 1.2 | Users router: `getMe`, `updateMe`, `search` | ✅ |
| 1.3 | Trips router: `list`, `getById`, `create`, `update`, `lockDestination`, `unlockDestination`, `archive`, `delete` | ✅ |
| 1.4 | Trip members router: `list`, `add`, `updateRole`, `remove`, `updateRsvp` | ✅ |
| 1.5 | Ideas router: `list`, `create`, `update`, `remove`, `vote` | 🔄 In progress |
| 1.6 | Idea comments router: `list`, `create` | ⬜ |
| 1.7 | Date poll router: `get`, `addWindow`, `vote`, `lockWindow`, `unlock` | ⬜ |
| 1.8 | Reservations router: `list`, `create`, `update`, `remove` | ⬜ |
| 1.9 | Expenses router: `list`, `create`, `updateSplits`, `remove` | ⬜ |
| 1.10 | Messages router: `list`, `send` (team channel filtered by team assignment) | ⬜ |
| 1.11 | Notifications router: `list`, `markAllRead`, `pushNotification` helper + 4 triggers wired | ⬜ |
| 1.12 | Quick info tiles router: `list`, `create`, `update`, `remove` | ⬜ |
| 1.13 | Events router: `getByTrip`, `upsert` | ⬜ |
| 1.14 | Teams router: `list`, `upsert` | ⬜ |
| 1.15 | Team assignments router: `list`, `assign`, `remove` | ⬜ |
| 1.16 | Rounds router: `list`, `create`, `update`, `remove` | ⬜ |
| 1.17 | Play groups router: `list`, `create`, `update` | ⬜ |
| 1.18 | Group results router: `list`, `submit`, `computeScores` (pure fn in `src/lib/scoring.ts`) | ⬜ |
| 1.19 | Side events router: `list`, `create`, `submitResult` | ⬜ |
| 1.20 | Series router: `list`, `create`, `linkTrip`, `transferOwnership` | ⬜ |

**Resuming mid-phase:** Start new session with:
> Read `CLAUDE.md`. We are mid-way through Phase 1. Check the git log to see which routers are complete and continue from where we left off.

**Done when:** All 20 tasks committed, all tests pass, PR created, `npx tsc --noEmit` clean.

---

## Phase 2 — Frontend Core Screens

**Goal:** All 7 screens implemented to match `buddytrip-2.html`. Open the prototype in a browser alongside the app and match screen-for-screen.

| Task | Screen | Key Work |
|------|--------|---------|
| 2.1 | **Dashboard** | Live/ready/upcoming/past sections, notification bell, trip cards with status badges and score strips |
| 2.2 | **TripNew** | 2-step wizard (basics → co-planner invites), validates invitees against `users` table |
| 2.3 | **TripDetail shell** | 5-tab layout (Home, Schedule, Crew, Comp, More), BottomNav context switching, breadcrumbs |
| 2.4 | **TripDetail > Home tab** | Quick Info Tiles, destination vote panel + lock, date poll panel, competition explainer/hero |
| 2.5 | **TripDetail > Schedule tab** | Reservation list + Add Booking form (6 reservation types) |
| 2.6 | **TripDetail > Crew tab** | Member roster, role badges, RSVP status, promote/demote/remove with inline confirmation |
| 2.7 | **TripDetail > Comp tab** | Competition CTA or team assignment view depending on `hasComp` |
| 2.8 | **TripDetail > More tab** | Expenses list + Add Expense form, trip settings panel (owner only) |
| 2.9 | **IdeaComparison** | Side-by-side destination comparison, voting, comments, lock/unlock |
| 2.10 | **CompetitionSetup** | Team builder, round builder, player assignment |
| 2.11 | **TripMessages** | Trip chat + team chat stacked, team privacy via team assignment |

**Each screen task is done when:**
1. Visually matches `buddytrip-2.html` on mobile viewport
2. All tRPC queries wired (no mock data)
3. Permission gates match `PERMISSIONS.md`
4. Happy path Playwright E2E test passes
5. Committed and pushed

---

## Phase 3 — Competition + Live Features

**Goal:** The competition day experience — score entry, live leaderboard, Realtime channels.

| Task | What |
|------|------|
| 3.1 | **LiveLeaderboard** — 4 tabs (Overview, Groups, Trip Info, History) |
| 3.2 | **ScoreEntry component** — bottom sheet for group-based score submission |
| 3.3 | **Scramble format** — 3-way result selector (Team A / Halved / Team B) |
| 3.4 | **Stableford format** — point entry per player |
| 3.5 | **Sabotage format** — same as scramble with format-specific description |
| 3.6 | **Skins format** — numeric skins-won per team |
| 3.7 | **Supabase Realtime: live leaderboard** — subscribe to `group_results` filtered by `event_id` |
| 3.8 | **Supabase Realtime: chat** — trip channel + team channel subscriptions |
| 3.9 | **Supabase Realtime: notifications** — bell count updates without refresh |
| 3.10 | **Public scoreboard** — share link generation + copy button |
| 3.11 | **Round lifecycle** — 4 states (upcoming/active/submitted/closed) per `SCORING_PLAYBOOK.md` Task A |

**Realtime implementation order:** leaderboard first (highest stakes), then notifications, then chat. See `REALTIME.md` for channel specs and reconnect pattern.

---

## Phase 4 — Polish + Launch Prep

**Goal:** Everything that makes it feel finished and production-ready.

| Task | What |
|------|------|
| 4.1 | Light/dark theme toggle — full WCAG-AA palette per prototype (see `CONTEXT.md` notes from task 7.1) |
| 4.2 | Empty states for all lists — specific copy per section per prototype |
| 4.3 | Navigation audit — all breadcrumbs, back buttons, deep links work round-trip |
| 4.4 | Mobile responsive pass — test on real devices, prototype is mobile-first |
| 4.5 | Error handling — loading states, error boundaries, offline indicators |
| 4.6 | Seed data cleanup script — `TRUNCATE TABLE users CASCADE` wipes all test data |
| 4.7 | E2E test suite — critical paths: create trip → invite → vote → lock → score → leaderboard → chat |
| 4.8 | Performance pass — TanStack Query stale times, prefetching on hover, image optimization |
| 4.9 | Deploy to Vercel production, verify build, smoke test live URL |

---

## Phase 5 — Post-Launch (v2 Backlog)

Not started. Add ideas here, implement after launch.

- Custom date picker (replace `<input type="date">`)
- Quick Score page — no-auth standalone scorecard
- Competition without a trip (`events.trip_id` nullable)
- OAuth login (Google, GitHub) — addable to Supabase Auth without schema changes
- Magic link / passwordless auth
- Multi-team events beyond 2 teams
- Push notifications (PWA)
- Field Mode — bumped fonts + larger tap targets for outdoor scoring
- Series history dashboard
- Advanced scoring: Sabotage elimination tracking, Skins payout breakdown
- Seed database with past BBMI data

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BBMI 2025 trip dates show as `completed` | High | Low | Adjust `start_date`/`end_date` in seed data to include today for demo |
| Realtime reconnect drops score updates | Low | High | Invalidate TanStack Query on reconnect per REALTIME.md reconnect pattern |
| Team chat privacy gap | Low | Medium | RLS policy on `messages` table enforces team membership at DB level |
| Prototype drift after freeze | Low | Medium | Prototype is frozen — new ideas go to Phase 5 backlog only |
| Test coverage gaps | Medium | Medium | CI blocks merge on failing tests; every task requires tests before commit |

---

## Success Criteria

The app is "done" (Phase 4 complete) when:

1. All 7 screens from the prototype are implemented and navigable
2. Full user journey works end-to-end: create account → create trip → invite crew → vote on destination → lock destination → set dates → create competition → assign teams → enter scores → view leaderboard → chat with team
3. 3-tier permission model enforced (owner/planner/member) — matches `PERMISSIONS.md` exactly
4. Notifications fire for 5 core events (destination locked, dates locked, crew added, chat message, score submitted)
5. Trip chat and team chat work with privacy (team members only see their own team's channel)
6. Light/dark theme works with WCAG-AA contrast
7. Mobile-first layout matches the prototype on real devices
8. All Vitest unit tests pass
9. All Playwright E2E tests pass
10. CI passes on every push
11. Deployed to Vercel and accessible at production URL

---

## How to Use This Plan

1. **Work one phase at a time, in order** — each phase builds on the previous
2. **Use `buddytrip-2.html` as the visual spec** — open in browser, match screen-for-screen
3. **Use `types.ts` as the data spec** — every interface maps to a Supabase table
4. **Use `PERMISSIONS.md` as the auth spec** — every row maps to a `requireTripRole` check
5. **Commit after each task** — not at the end of a phase
6. **Tests before commit** — no task is done without passing tests
7. **Read `CLAUDE.md`** at the start of every Claude Code session

### Resuming a session mid-phase

> Read `CLAUDE.md`. We are mid-way through Phase [N]. Check the git log to see which tasks are complete and continue from where we left off.

### Starting a new phase

Copy the full task list for that phase from this document and paste it as the Claude Code prompt, prefixed with:
> Read `CLAUDE.md` before starting.

---

*This document lives in `buddytripworkflow` alongside the prototype spec. Copy it to `buddytrip` repo root if you want Claude Code to reference it directly.*

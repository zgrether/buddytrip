# BuddyTrip — Project Status

*Single source of truth for project state, architecture, and what's next.*
*Last updated: 2026-04-03*

---

## What It Is

A mobile-first group trip planning and golf competition app. Built around
BBMI (Buddy Banks Memorial Invitational) as a real-world prototype, designed
to generalize to any recurring friend group trip.

**Core features:** trip creation, crew management, destination voting, date
polling, scheduling, chat, expenses, Ryder Cup-style team scoring with live
leaderboard, in-app notifications.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 18 + Tailwind v4 |
| API | tRPC v11 + TanStack Query v5 |
| Database | Supabase (Postgres) — 26+ tables, 28 migrations |
| Auth | Supabase Auth (email/password, Google OAuth, magic link) |
| Email | Resend (invite emails) |
| Realtime | Supabase Realtime (chat, leaderboard, notifications) |
| Validation | Zod |
| Icons | Lucide React |
| Testing | Vitest (156 tests) + Playwright E2E |
| CI | GitHub Actions |
| Deployment | Vercel |
| Styling | `--color-bt-*` CSS token system, light/dark mode |

**Repo:** github.com/zgrether/buddytrip (private)
**Deployed:** bbmi.app
**Key files:** `CLAUDE.md` (enforced patterns), `STYLE_GUIDE.md` (design
system), `PERMISSIONS.md` (role matrix), `DEFERRED.md` (backlog)

---

## Architecture Overview

### Screens

| Screen | Route | Status |
|--------|-------|--------|
| Dashboard | `/` | ✅ |
| New Trip | `/trips/new` | ✅ Two-step wizard |
| Trip Detail | `/trips/[tripId]` | ✅ 4 tabs: Home, Schedule, Crew, Competition |
| Idea Comparison | `/trips/[tripId]/compare` | ✅ |
| Trip Messages | `/trips/[tripId]/messages` | ✅ Trip + team chat |
| Live Leaderboard | `/trips/[tripId]/leaderboard` | ✅ 4 sub-tabs |
| Competition Setup | `/trips/[tripId]/competition` | ✅ |

### Realtime Channels

Five Supabase Realtime subscriptions, all implemented:

| Channel | Table | Hook |
|---------|-------|------|
| Trip chat | `messages` (channel=trip) | `useRealtimeChat.ts` |
| Team chat | `messages` (channel=team) | `useRealtimeChat.ts` |
| Live leaderboard | `group_results` | `useRealtimeLeaderboard.ts` |
| Side events | `side_events` | `useRealtimeLeaderboard.ts` |
| Notifications | `notification_events` | `useRealtimeNotifications.ts` |

Everything else uses TanStack Query with stale-while-revalidate.
Destination and date votes use 30s polling (intentional — small group,
low urgency). See hooks in `src/hooks/` for channel configuration.

### Database

26+ tables created via `supabase/migrations/`. Migrations are the
authoritative schema source. Key additions beyond the original spec:
`catalog_ideas`, `ghost_crew`, `scoreboard_shares`, `rounds.closed_at/closed_by`,
`date_poll_votes.answer` expanded to include `'maybe'`, `users.is_guest`,
`trip_members.status` includes `'invited'`.

### Permission Model

Three roles: Owner > Planner > Member. Full matrix in `PERMISSIONS.md`.
Enforced via `requireTripRole()` middleware (tRPC), RLS policies (Supabase),
and `canEdit`/`isOwner` guards (frontend).

### Scoring Formats

Four formats implemented: Scramble, Stableford, Sabotage, Skins.
Round lifecycle: upcoming → active → submitted → closed (4 states).
Schema supports N teams; UI handles N teams with 6-color palette.

---

## Phase Status

### Phase 0 — Scaffold + Database ✅ COMPLETE
All 10 tasks. Next.js scaffold, Supabase project, tRPC + TanStack Query,
auth, 26 tables, RLS, seed data.

### Phase 1 — Backend Routers ✅ COMPLETE
All 20 tasks. 20+ tRPC routers with auth middleware, CI green (156 tests).

### Phase 2 — Frontend Core Screens ✅ COMPLETE
All 11 screens scaffolded and wired to tRPC.

### Phase 3 — Competition + Live Features ✅ COMPLETE
All 12 tasks. Four scoring formats, Realtime channels, public scoreboard,
round lifecycle.

### Phase 4 — Polish + Launch Prep 🔄 IN PROGRESS

| Task | What | Status |
|------|------|--------|
| 4.0 | Fix HIGH bugs (play groups, invite, expenses, chat, dates, rounds) | ✅ |
| 4.1 | User profile edit screen | ✅ |
| 4.2 | Medium bugs (share feedback, ISO dates, copy, layout, 404, signup) | ✅ |
| 4.2.1 | Competition tab chicken-and-egg fix | ✅ |
| 4.3 | Light/dark theme toggle (WCAG-AA palette) | 🔄 In progress |
| 4.4 | Visual match to prototype | — |
| 4.5 | Empty states audit | — |
| 4.6 | Navigation audit (breadcrumbs, back buttons, deep links) | — |
| 4.7 | Mobile responsive pass | — |
| 4.8 | Error handling (loading states, error boundaries) | — |
| 4.9 | Playwright E2E (fix middleware auth, add to CI) | — |
| 4.10 | Seed data cleanup script | — |
| 4.11 | Performance pass | — |
| 4.12 | Deploy to Vercel production, smoke test | — |

### Phase 5 — Post-Launch (v2 Backlog)

Not started. Items tracked in `DEFERRED.md`.

---

## Success Criteria (Phase 4 Complete = "Done")

1. All screens implemented and navigable
2. Full user journey end-to-end: create account → create trip → invite
   crew → vote destination → lock → set dates → create competition →
   assign teams → enter scores → view leaderboard → chat
3. Three-tier permission model enforced per `PERMISSIONS.md`
4. Notifications fire for 5 core events
5. Chat works with team privacy
6. Light/dark theme with WCAG-AA contrast
7. Mobile-first layout on real devices
8. All Vitest + Playwright tests pass
9. CI green on every push
10. Deployed to Vercel production

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Realtime reconnect drops score updates | Low | Invalidate TanStack Query on reconnect |
| Playwright E2E broken | High | Fix middleware auth redirect in Phase 4.9 |
| Token migration debt (17+ hardcoded hex) | Medium | Tracked in STYLE_GUIDE.md Section 7; fix incrementally |

---

## Key Patterns (enforced via CLAUDE.md)

1. **Optimistic updates** — TanStack Query `onMutate` with rollback
2. **TypeScript cache typing** — explicit generics on `queryClient.setQueryData`
3. **Migration naming** — `NNN_descriptive_name.sql`
4. **RLS INSERT RETURNING split** — separate INSERT and SELECT to avoid RLS race
5. **Middleware auth** — `requireAuth` before any `requireTripMember`/`requireTripRole`
6. **Test isolation** — 4 shared persistent users, unique trips per test

---

## Workflow

Design/discuss in Claude → write precise CC spec → CC implements →
review screenshots → iterate. Opus for complex multi-file work, Sonnet
for targeted single-file changes. `CLAUDE.md` must be read by CC at the
start of every session.

---

## Files to Delete

These markdown files were in the repo and have been fully superseded:

| File | Why delete |
|------|-----------|
| `TODO.md` | Prototype-era TODO. All items resolved. |
| `TODO2.md` | Prototype walkthrough issues. All resolved. |
| `MIGRATION_PLAN.md` | Prototype→production migration. Fully complete. |
| `PLAYBOOK.md` | Pre-migration playbook. All 27 tasks done. |
| `README.md` | Describes the prototype, not the production app. Replace with this file or a new README. |
| `CC_DATES_PANEL.md` | Prototype task spec. Completed. |
| `CC_DATES_PANEL_REAL.md` | Production task spec. Completed. |
| `TRIP_PLANNING_SPECS.md` | Three specs (TripNew, TripDetail, Crew). All implemented. |
| `REALTIME.md` | Architecture implemented; hooks are now authoritative. |
| `SCHEMA.md` | Design spec; migrations are now authoritative. |
| `SCORING_PLAYBOOK.md` | Tasks A/D/E done. Remaining B/C/F moved to DEFERRED.md. |

## Files to Keep

| File | Why keep |
|------|---------|
| `PROJECT_STATUS.md` | This file — project tracker |
| `DEFERRED.md` | Clean backlog of open work |
| `STYLE_GUIDE.md` | Active design system reference |
| `PERMISSIONS.md` | Active permission matrix (note: Quick Info Tiles gate should say `canEdit`, not `isOwner`) |
| `CLAUDE.md` | Enforced patterns for CC sessions |

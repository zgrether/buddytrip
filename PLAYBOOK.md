# BuddyTrip — Pre-Migration Playbook

*The complete task list to turn the prototype into a migration-ready contract.*

---

## How to Use This Document

This playbook is organized into **phases**, each containing **tasks**. Tasks are meant to be done one at a time, in order within each phase. Some tasks have **decision points** — these are called out explicitly with the tradeoffs so you can make an informed call.

Every task has a **why** — skip the task if the why doesn't apply, but read it before you skip.

Estimated total effort: **7–10 working sessions** (assuming 2–4 hours per session with Claude Code doing the implementation).

### Opus vs. Sonnet Guidance

Each task is tagged with the recommended model. The rule of thumb:

- **Sonnet** — Clear spec, mechanical execution. "Here's exactly what to change and where."
- **Opus** — Architectural decisions, cross-cutting refactors, documentation that requires understanding the whole system. "Think about how this fits together."

### On the Prototype Format

**Yes, a single HTML file with good documentation is a completely valid prototype.** The prototype's job is to answer three questions: What does it look like? How does the data flow? What are the edge cases? A single HTML file answers all three — you can open it in a browser and click through every screen, every role, every state. No build step, no dependencies, no environment setup.

What the prototype is NOT is a codebase to migrate line-by-line. Nobody is going to copy-paste 4700 lines of inline-styled React-via-CDN into a production app. The migration is a **rewrite guided by the prototype**, not a refactor of it. The prototype is the spec — the pictures, the interactions, the data shapes. The documentation files (SCHEMA.md, PERMISSIONS.md, REALTIME.md, MIGRATION_PLAN.md) are the engineering spec. Together, they're the contract.

The single-file format actually has advantages over a scaffolded app for this purpose: there's no build system to break, no dependency version conflicts, no "it works on my machine" issues. Anyone (human or AI) can open the HTML file and see exactly what you're building. That clarity is more valuable than a half-migrated codebase with real components but broken data flow.

Keep building in the single file through this playbook. The migration to Vite + TypeScript happens *after* the prototype is complete and documented, as a clean break.

---

## Phase 0: Bug Fixes
*Fix everything that's broken before building anything new.*

### Task 0.1 — Add the missing `Send` icon to the ICONS dict
**Model: Sonnet**

**What:** Line 1573 references `<Ic n="Send" ... />` but `Send` doesn't exist in the `ICONS` dict (line 144). This renders an empty SVG in the chat input.

**Why:** Any icon name not in the dict fails silently. This is the only instance I found, but after fixing it, do a grep for every `<Ic n="` call and cross-reference against the ICONS keys to make sure nothing else is missing.

**How:** Add the Lucide `Send` path to the ICONS object. The Lucide source is: `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`.

---

### Task 0.2 — Fix the Competition Explainer icon rendering
**Model: Sonnet**

**What:** In the `HomeTab` Competition explainer modal (around line 1677), the checklist items use `item.icon` as text content inside a `<span>` — but `item.icon` contains icon *names* like `'Users'`, `'Flag'`, `'BarChart2'`. They render as literal text strings, not as SVG icons.

**Why:** It looks broken. Each item should render `<Ic n={item.icon} ... />` instead of `{item.icon}`.

---

### Task 0.3 — Fix hardcoded scores that should be computed
**Model: Sonnet** (the function is straightforward; just summing data)

**What:** Team scores appear in three places as hardcoded constants:
- `Dashboard` (line 642): `const scores = { 'team-a': 6.5, 'team-b': 8.5 }`
- `TripDetail > HomeTab` (line 1595): `const scores = { 'team-a': 6.5, 'team-b': 8.5 }`
- `LiveLeaderboard` (line 4406): `const ptsA = 6.5, ptsB = 8.5`

Meanwhile, actual round results exist in `ROUND_RESULTS` and side event results exist in `BBMI_EVENT.sides[].result`.

**Why:** If someone changes a round result in the mock data, the leaderboard won't reflect it. More importantly, this needs to be a function for the real app. Building it now means the prototype *proves* the scoring engine works.

**How:** Write a `computeTeamScores(event)` function that sums `ROUND_RESULTS` + `sides[].result` for each team. Use it everywhere scores appear. Verify the output matches the current hardcoded values.

---

### Task 0.4 — Fix expense split using first names instead of user IDs
**Model: Sonnet**

**What:** The `ExpenseRow` component (line 2499) builds the assignment set from `exp.splitAmong.map(s => s.name)` and toggles by first name. Two people named "Ben" would collide.

**Why:** This will break the moment you have duplicate first names. Expenses should track `userId`, not display names.

**How:** Change `splitAmong` in `EXPENSES` mock data to `[{ userId: 'p-brad' }, { userId: 'p-zach' }, ...]`. Update `ExpenseRow` to use `userId` as the set key and resolve display names at render time.

---

### Task 0.5 — Fix the "Welcome back, Grether" hardcoding
**Model: Sonnet**

**What:** The Dashboard greeting (search for "Welcome back") is hardcoded. It should reflect `CURRENT_USER` and update when the dev role switcher changes.

**Why:** Minor, but it undermines trust in the prototype if the greeting doesn't match the active role.

---

## Phase 1: Data Model Stabilization
*Make every mock data object match the shape you'd put in a database.*

### Task 1.1 — Unify user identity
**Model: Opus** (this touches every data structure and every component that references a user — Opus is better at tracking the ripple effects across 4700 lines)

**What:** Three identity patterns exist:
1. `CURRENT_USER._id` = `'zach'`
2. Player IDs in `BBMI_EVENT.players` = `'p-zach'`
3. Attendee `userId` in trips = `'zach'`

Messages use `userId: 'brad'`, votes use `userId: 'brad'`, but players use `_id: 'p-brad'`.

**Why:** A real backend has one `users` table. Every reference to a user must use the same ID. The `p-` prefix on player IDs creates a mapping burden that serves no purpose.

**How:** Pick one format. I recommend plain IDs without prefixes: `'brad'`, `'zach'`, `'jd'`, etc. Update `BBMI_EVENT.players` to use `_id: 'brad'` instead of `_id: 'p-brad'`. Update all `playerIds` arrays in groups. Update `teamId` references on the team membership side (currently tracked on the player object — see Task 1.4).

---

### Task 1.2 — Replace array indexes with stable IDs for votes
**Model: Opus** (the vote/idea/date-window relationships are intertwined across multiple screens — IdeaComparison, TripDetail destination panel, date panel — and getting the filter logic wrong breaks voting silently)

**What:** `IDEA_VOTES` tracks `ideaIndex: 0` and `DATE_VOTES` tracks `proposedDateIndex: 0`. If idea 0 gets deleted, all votes for idea 1 now point to the wrong idea.

**Why:** This is a data corruption bug. In a real database, you'd never reference a row by its position in an array.

**How:** Give each idea an `_id` field (e.g., `'idea-scottsdale'`, `'idea-bandon'`). Change `IDEA_VOTES` to use `ideaId` instead of `ideaIndex`. Same for date windows — give each proposed date an `_id` and reference it in votes. Update all the vote-filtering code that currently uses array index comparisons.

---

### Task 1.3 — Add `createdAt` and `updatedAt` everywhere
**Model: Sonnet** (mechanical — just adding fields to mock data objects)

**What:** The following objects are missing timestamps:
- `IDEA_VOTES` — no timestamps (when was the vote cast?)
- `DATE_VOTES` — no timestamps
- `DESTINATION_LOCK` — no timestamp (when was it locked?)
- `EXPENSES` — no timestamps
- `RESERVATIONS` — no `createdAt`
- Trip `attendees` — no `joinedAt` or `rsvpAt`
- `ROUND_RESULTS` — no timestamps (when was the score submitted?)

**Why:** Timestamps are needed for notification ordering, conflict resolution, and audit trails. Adding them to mock data now means the real backend schema will include them from day one.

**How:** Add `createdAt: new Date('...')` to every object. Use plausible dates that tell a story (votes cast over a few days, expenses added during the trip, etc.).

---

### Task 1.4 — Normalize team membership
**Model: Sonnet** (clear spec, just restructuring data)

**What:** Currently, a player's team is stored as `teamId: 'team-a'` on the player object inside `BBMI_EVENT.players`. This means to find Team Hammer's roster, you filter all players by `teamId`.

**Why:** This works, but it conflates "who is on this trip" with "what team are they on for this competition." A player belongs to a trip (via `attendees`), and separately belongs to a team within a competition. These are two different relationships. A future trip could have the same players on different teams.

**How:** Create a `TEAM_ASSIGNMENTS` array: `[{ eventId, teamId, userId }]`. Remove `teamId` from the player objects in `BBMI_EVENT.players`. The players array becomes just the competition roster (who's playing, what's their handicap, what group are they in).

> **Decision Point:** You could also keep `teamId` on the player object since each player only belongs to one team per event. The tradeoff is simplicity now vs. flexibility later. If you ever want to support competitions where teams change between rounds (unlikely for BBMI but possible for other trip types), the normalized approach is better. **My recommendation:** normalize it. The code change is small and the data model is cleaner.

---

### Task 1.5 — Normalize group assignments
**Model: Sonnet**

**What:** `groupId: 'g1'` is on the player object AND `playerIds: ['p-brad', ...]` is on the group object. This is a dual representation — if one changes, the other is stale.

**Why:** Single source of truth. Groups should own the membership.

**How:** Remove `groupId` from player objects. Keep the `playerIds` array on each group. If you need to look up "what group is this player in?", filter groups — it's a small list (4 groups max).

---

### Task 1.6 — Create a proper User lookup object
**Model: Sonnet** (but tell it exactly which components need updating — list them from this doc)

**What:** Currently, user display info is scattered. `CURRENT_USER` has `name`, `firstName`, `nickname`, `email`. Players have `name` and `nickname`. Attendees have `name`. Messages have `userName`. There's no single place to resolve "given a userId, what's their display info?"

**Why:** In the real app, you'll have a `users` table. The prototype should simulate this so components resolve names consistently.

**How:** Create a `USERS` lookup object:
```javascript
const USERS = {
  'brad':    { _id: 'brad',    name: 'Brad Giesler',   nickname: 'Brad',    email: 'brad@...' },
  'zach':    { _id: 'zach',    name: 'Zach Grether',   nickname: 'Grether', email: 'zgrether@...' },
  // ... all 16 players + any non-player crew
}
```
Then remove `userName` from messages, votes, and comments. Resolve display names at render time: `USERS[msg.userId]?.nickname || 'Unknown'`.

---

## Phase 2: Missing Features That Block Migration
*These are gaps where the prototype can't demonstrate the full user journey.*

### Task 2.1 — Make TripNew actually create a trip
**Model: Opus** (this is the biggest architectural change in the playbook — lifting MOCK_TRIPS to App-level state ripples through every component that reads trip data)

**What:** The "Create Trip" / "Let's Go" button in `TripNew` currently navigates to an existing mock trip. It doesn't actually add a new entry to `MOCK_TRIPS`.

**Why:** The create → view journey is the single most important user flow. If the prototype can't demonstrate it end-to-end, it's not a complete contract.

**How:** When the user clicks Create:
1. Generate a new trip ID (e.g., `'trip-' + Date.now()`)
2. Build a trip object from the form data (name, optional destination, optional crew)
3. Push it onto `MOCK_TRIPS`
4. If vote path with 2+ ideas: set `comparisonMode: true`, populate `ideas`
5. If known destination: set `comparisonMode: false`, set `location`
6. Navigate to `trip-detail` with the new ID
7. The Dashboard should now show the new trip

This requires making `MOCK_TRIPS` mutable with a `useState` at the App level, or using a module-level array with a forceUpdate pattern.

> **Decision Point:** Should `MOCK_TRIPS` become React state in the App component (passed down as props/context), or stay as a module-level mutable array with `setState` triggers? **My recommendation:** Lift it to App-level state. It's more work now, but it's exactly the pattern you'll use with a real data layer (React Query / Supabase hooks). The alternative (module-level mutation) is the pattern that causes bugs.

---

### Task 2.2 — Derive trip status dynamically
**Model: Opus** (the status function itself is simple, but finding and replacing every `trip.status` reference across 4700 lines without breaking anything requires understanding the full context)

**What:** Trip status (`planning`, `ready`, `active`, `completed`) is hardcoded in `MOCK_TRIPS[].status`. Your TODO correctly identifies that it should be computed.

**Why:** Hardcoded status means the prototype lies. If you lock a destination and dates on the `planning` trip, it still shows as "Planning" because the status field doesn't update.

**How:** Write a `getTripStatus(trip)` function:
```
planning → ready:  lockedDest AND (lockedDates OR knownDates)
ready → active:    today >= startDate
active → completed: today > endDate
```
Remove `status` from trip objects. Call `getTripStatus()` everywhere `trip.status` is currently read (Dashboard, StatusBadge, header card, etc.).

> **Decision Point:** Should crew count gate the `ready` status? (e.g., "need at least 4 confirmed before Ready"). **My recommendation:** No, not for the prototype. It's a product decision that varies per trip. Note it as a future setting per trip, but don't block on it.

---

### Task 2.3 — Build the notification event layer
**Model: Opus** (designing the event schema, choosing the right triggers, and wiring them into existing mutation points across the app is an architectural task)

**What:** No notification system exists yet. The trigger inventory is documented in the TODO but nothing is wired.

**Why:** Notifications are how users know something happened without being on the screen when it happens. The prototype needs to demonstrate this pattern, not the full delivery system.

**How:**
1. Create a `NOTIFICATION_EVENTS` array at module level
2. Create a `pushNotification({ type, tripId, actorId, payload, createdAt })` helper
3. Wire it into 5 high-value triggers:
   - Destination locked → notify all crew
   - Dates locked → notify all crew
   - New crew member added → notify organizers
   - New trip chat message → notify all crew (except sender)
   - Score submitted → notify all crew
4. Add a bell icon to `TopNav` with an unread count
5. Build a minimal dropdown/overlay that lists recent events
6. Mark as read when the dropdown opens

Don't build push notifications, digests, or frequency controls. Just the in-app event log.

---

### Task 2.4 — Wire up score entry
**Model: Opus for the design/component structure, then Sonnet for the implementation once the approach is decided**

**What:** The LiveLeaderboard shows scores but there's no way to *enter* them. The Groups tab says "Tap for scorecard" but tapping does nothing.

**Why:** The scoring loop (enter score → see it on leaderboard) is a core feature. Without it, the prototype doesn't demonstrate the live experience.

**How:** Build a `ScoreEntry` component that:
1. Shows one round's scorecard for one group
2. Lets the designated scorer enter team points (for Scramble) or individual points (for Stableford)
3. On submit, updates `ROUND_RESULTS` and triggers a recalculation via `computeTeamScores`
4. Shows a confirmation and returns to the leaderboard

Keep it simple — one round, one group, numeric inputs. The format-specific logic (Sabotage eliminations, Skins payouts) can be stub-level with a "format not yet implemented" message for the complex ones.

---

### Task 2.5 — Implement team chat privacy
**Model: Sonnet** (straightforward filter logic)

**What:** Both teams' chat messages are visible in the prototype regardless of which team the viewer is on. The mock data for `TRIP_MESSAGES[tripId].team` is shared across all viewers.

**Why:** This is a trust requirement. Even in the prototype, switching roles should show different team chat content.

**How:** Filter `TRIP_MESSAGES[tripId].team` based on `CURRENT_USER`'s team membership. When viewing as a non-team-member, show "You're not on a team yet" or similar. When the dev role switcher changes, the team chat should update to show only that role's team messages.

---

### Task 2.6 — Add expense creation
**Model: Sonnet** (follows the same pattern as TripNew — form → validate → push to array)

**What:** The "Add" button on the expenses section shows a "coming soon" toast. You can view and edit splits but can't create a new expense.

**Why:** Expenses are part of the core trip lifecycle. The prototype should show the full create → view → edit flow.

**How:** Build a simple "Add Expense" form: title, amount, paid by (dropdown of crew), split among (checkboxes). On submit, push to the `EXPENSES` array. This matches the pattern of TripNew creating a trip — it proves the write path works.

---

## Phase 3: Architectural Cleanup
*Make the code structure match what the real app will look like.*

### Task 3.1 — Extract the scoring engine into a pure function
**Model: Sonnet** (if you've already done Task 0.3, this is just a refactor of that function)

**What:** Score computation is scattered (hardcoded in three places, round results in a separate object, side results embedded in the event).

**Why:** The scoring engine is the most complex business logic in the app. It needs to be a testable, standalone function that takes event data in and returns team totals out. In the real app, this runs on both client (for optimistic updates) and server (for authoritative results).

**How:** Create a `computeScores(event, roundResults)` function at module level that:
1. Sums round points per team from `roundResults`
2. Sums side event points per team from `event.sides`
3. Returns `{ teamId: totalPoints }` for each team
4. Also returns `remaining` (total possible minus awarded)
5. Use it in Dashboard, TripDetail HomeTab, and LiveLeaderboard

---

### Task 3.2 — Replace DESTINATION_LOCK / DATE_POLL globals with trip-level state
**Model: Opus** (this is tightly coupled with Task 2.1's state-lifting and affects TripDetail, IdeaComparison, and the date panel — getting the reactive wiring right requires full-system understanding)

**What:** `DESTINATION_LOCK` and `DATE_POLL` are module-level mutable objects outside React's state management. They "survive navigation" but they also bypass React's rendering cycle, requiring manual `setState` calls to trigger re-renders.

**Why:** This pattern works in the prototype but teaches the wrong muscle memory. In the real app, this data lives on the trip object (server state), and React Query or Supabase subscriptions handle the reactivity.

**How:** Move lock state and date poll state onto the trip objects themselves. When a destination is locked, update the trip object directly:
```javascript
setTrips(ts => ts.map(t => t._id === tripId ? { ...t, lockedDestination: { ... } } : t))
```
This requires lifting `MOCK_TRIPS` to App-level state (see Task 2.1).

---

### Task 3.3 — Document the permission model
**Model: Opus** (requires reading every conditional in the prototype and understanding the intent behind each one — this is analysis, not code)

**What:** Permissions are enforced via `if (isOwner)` and `if (canEdit)` checks scattered throughout components, but there's no single reference for what each role can do.

**Why:** When you build RLS policies in Supabase, you need a clear, complete list of "Role X can do Action Y on Resource Z." If this only exists implicitly in UI code, you'll miss permissions during migration.

**How:** Add a `PERMISSIONS.md` file (or a section in the README) that lists every action and which roles can perform it. Example format:
```
| Action                    | Owner | Planner | Member |
|---------------------------|-------|---------|--------|
| Create trip               | ✓     | —       | —      |
| Edit trip name            | ✓     | ✓       | —      |
| Lock destination          | ✓     | —       | —      |
| Vote on destination       | ✓     | ✓       | ✓      |
| Enter scores              | ✓     | ✓       | —      |
| View team chat (own team) | ✓     | ✓       | ✓      |
| View team chat (other)    | —     | —       | —      |
| Delete trip               | ✓     | —       | —      |
```

Walk through every `isOwner`, `canEdit`, and `viewerRole` check in the prototype and add rows for each.

---

### Task 3.4 — Define the complete TypeScript interfaces
**Model: Opus** (this is the single most important artifact for migration — it needs to account for every relationship, every optional field, and every edge case in the data model; getting it wrong means the database schema is wrong)

**What:** The mock data objects don't have formal type definitions. In a JavaScript prototype this is fine, but the migration needs explicit types.

**Why:** These interfaces become your database schema. They're the single most important artifact for migration. Get them right and the Supabase table creation is mechanical.

**How:** Create a `types.ts` file (can live alongside the prototype as a reference doc, doesn't need to be imported). Define interfaces for:

- `User` — id, name, nickname, email, avatarUrl?
- `Series` — id, name, fullName, createdBy
- `Trip` — id, title, seriesId?, description, lockedDestination?, startDate?, endDate?, createdBy, createdAt, updatedAt
- `TripMember` — tripId, userId, role (owner|planner|member), rsvpStatus, joinedAt
- `Idea` — id, tripId, title, location, description, imageUrl?, pros, cons, costTier, archived, createdBy, createdAt
- `IdeaVote` — id, tripId, ideaId, userId, createdAt
- `IdeaComment` — id, ideaId, userId, text, createdAt
- `DateWindow` — id, tripId, startDate, endDate, isLocked, createdAt
- `DateVote` — id, windowId, userId, availability (yes|no|maybe), createdAt
- `Event` (competition) — id, tripId, title, subtitle, motto?, status, createdAt
- `Team` — id, eventId, name, shortName, color
- `TeamAssignment` — eventId, teamId, userId
- `Player` — eventId, userId, handicap
- `PlayGroup` — id, eventId, roundId?, name, teeTime, playerIds
- `Round` — id, eventId, day, title, course, format, pointsAvailable, status
- `RoundResult` — roundId, teamId, points, submittedBy, createdAt
- `SideEvent` — id, eventId, name, icon?, pointsAvailable, status
- `SideResult` — sideEventId, teamId, points, submittedBy, createdAt
- `Reservation` — id, tripId, type, title, date, startTime?, confirmationNumber?, cost?, notes?
- `Expense` — id, tripId, title, amount, paidByUserId, createdAt
- `ExpenseSplit` — expenseId, userId, amount?
- `Message` — id, tripId, channel (trip|team), teamId? (for team messages), userId, text, createdAt
- `NotificationEvent` — id, tripId, type, actorId, payload, createdAt, readAt?
- `QuickInfoTile` — id, tripId, label, value, createdBy

> **Decision Point:** Should `lockedDestination` be a field on Trip, or a separate `TripDestination` entity? If you want a history of destination changes (locked → reopened → relocked), you need a separate entity. If you only care about the current state, a field on Trip is simpler. **My recommendation:** Field on Trip for now. Destination history is a nice-to-have, and you can always extract it later. The current prototype only tracks the current lock state.

---

## Phase 4: UX Polish & Edge Cases
*Catch the things that look wrong or feel broken.*

### Task 4.1 — Handle empty states consistently
**Model: Sonnet** (audit and add missing empty state messages — mechanical)

**What:** Several screens show different empty states or no empty state at all:
- Expenses: "No expenses yet" (good)
- Schedule tab with no reservations: nothing shown (should say something)
- Competition tab with no event: handled (the CTA card shows)
- Messages with no messages: "No messages yet — say something" (good)
- Past Trips section: collapsed toggle, no empty state if empty

**Why:** Empty states are the first thing a new user sees. They should guide the user toward the next action.

**How:** Audit every list/section in the app. If it can be empty, make sure there's a clear message and (for owner/planner) a call to action.

---

### Task 4.2 — Verify all navigation paths work round-trip
**Model: Sonnet** (but give it the explicit list of paths to test — it's QA work, not design)

**What:** Some navigation paths may be one-way:
- Breadcrumbs on IdeaComparison go back to TripDetail ✓
- LiveLeaderboard has "← TRIP HOME" ✓
- CompetitionSetup — does "back" work correctly?
- Messages breadcrumb — does tapping the trip name go back to the right trip?

**Why:** Dead-end navigation is the fastest way to frustrate users.

**How:** Walk through every screen as each role. Tap every back button, breadcrumb link, and navigation element. Document any that don't work or feel wrong.

---

### Task 4.3 — Test the complete user journey per role
**Model: Opus** (this is holistic testing that requires understanding the full system and identifying gaps that Sonnet would miss)

**What:** Walk through the full lifecycle for each role and document dead ends:

**Owner journey:** Create trip → Name it → Add destination ideas → Invite crew → Lock destination → Set dates → Enable competition → Assign teams → Add rounds → Trip goes live → Enter scores → View leaderboard → Archive trip

**Planner journey:** Open trip → View destination vote → Cast vote → View dates → Vote on dates → Add crew members → Set up rounds → Enter scores

**Member journey:** Open trip → View destination vote → Cast vote → Vote on dates → View leaderboard → Read chat → Send message

**Why:** Any step that dead-ends or requires a workaround is a gap in the prototype. The migration dev (Opus or you) needs to know every screen transition works.

---

### Task 4.4 — Add a "completed" trip to mock data
**Model: Sonnet**

**What:** The Dashboard has a "Past Trips" section but no mock trip with `status: 'completed'`.

**Why:** The completed state has distinct visual treatment (no accent bar, muted card). Without a mock example, you can't verify it looks right, and the migration dev won't know how to render it.

**How:** Add a trip like "BBMI 2024" with `status: 'completed'`, past dates, a final score, and a winner. This also lets you test the Past Trips toggle.

*(Note: If you implement Task 2.2 — derived status — this trip just needs an `endDate` in the past and it'll auto-derive as completed.)*

---

## Phase 5: Documentation for Handoff
*Write down everything the migration dev needs to know.*

### Task 5.1 — Update the README with current screen inventory
**Model: Opus** (needs to reflect the state of the whole app accurately after all changes)

**What:** The README screen inventory is mostly accurate but may have drifted after these changes. It needs to be the single source of truth for "what screens exist and what route key maps to them."

**Why:** The migration dev uses this to create React Router routes.

---

### Task 5.2 — Create SCHEMA.md from the TypeScript interfaces
**Model: Opus** (annotating foreign keys, indexes, and creation-time vs. server-computed fields requires deep understanding of how the data flows through the system)

**What:** Take the TypeScript interfaces from Task 3.4 and annotate them with:
- Which fields are required vs. optional at creation
- Which fields are server-computed (createdAt, status)
- Which fields have foreign key relationships
- Which fields need indexes (any field used in a WHERE or ORDER BY)

**Why:** This becomes the Supabase migration SQL. The more explicit you are here, the less guesswork during migration.

---

### Task 5.3 — Create REALTIME.md documenting which features need subscriptions
**Model: Opus** (requires understanding both the frontend interaction patterns and the backend implications)

**What:** Document which data channels need real-time updates:
- Trip chat messages → real-time (Supabase Realtime subscription on `messages` table filtered by `tripId` and `channel = 'trip'`)
- Team chat messages → real-time (same, filtered by `teamId`)
- Live leaderboard scores → real-time (subscribe to `round_results` and `side_results` for the active event)
- Everything else → standard fetch with stale-while-revalidate

**Why:** This determines how you configure Supabase Realtime channels and where you use TanStack Query vs. Supabase subscriptions in the React code.

---

### Task 5.4 — Create MIGRATION_PLAN.md with the phased migration steps
**Model: Opus** (this is the migration roadmap — it needs to account for dependency order, risk, and the full system architecture)

**What:** Document the migration sequence:
1. Scaffold Vite + React + TypeScript + Tailwind + React Router
2. Port shared components (Card, Btn, Avatar, etc.)
3. Port each screen one at a time, starting with Dashboard (read-only)
4. Stand up Supabase: create tables from SCHEMA.md
5. Add Supabase Auth (replace CURRENT_USER)
6. Replace mock data with Supabase queries, one screen at a time
7. Add RLS policies from PERMISSIONS.md
8. Wire up Realtime channels from REALTIME.md
9. Deploy to Vercel

**Why:** When you hand the prototype to Opus and say "go wire this up," this document is the task list. No ambiguity, no guessing.

---

## Decision Summary

All decision points from this playbook, collected for quick reference:

| # | Decision | Recommendation | Alternatives |
|---|----------|---------------|-------------|
| 1.4 | Normalize team membership into separate array vs. keep on player object | Normalize (cleaner, more flexible) | Keep on player (simpler, less code change) |
| 2.1 | Lift MOCK_TRIPS to App-level state vs. keep as module-level mutable | Lift to state (matches real app pattern) | Module-level with forceUpdate (faster to implement) |
| 2.2 | Crew count gates Ready status | No — note as future per-trip setting | Yes — require minimum 4 confirmed |
| 3.4 | lockedDestination as Trip field vs. separate TripDestination entity | Field on Trip (simpler, sufficient) | Separate entity (supports destination change history) |

---

## Model Usage Summary

Quick reference for Opus vs. Sonnet across all tasks:

| Phase | Opus Tasks | Sonnet Tasks |
|-------|-----------|-------------|
| Phase 0: Bugs | — | 0.1, 0.2, 0.3, 0.4, 0.5 |
| Phase 1: Data Model | 1.1, 1.2 | 1.3, 1.4, 1.5, 1.6 |
| Phase 2: Features | 2.1, 2.2, 2.3, 2.4 (design) | 2.4 (implement), 2.5, 2.6 |
| Phase 3: Architecture | 3.2, 3.3, 3.4 | 3.1 |
| Phase 4: Polish | 4.3 | 4.1, 4.2, 4.4 |
| Phase 5: Docs | 5.1, 5.2, 5.3, 5.4 | — |

**Totals: ~13 Opus tasks, ~14 Sonnet tasks**

---

## What "Done" Looks Like

When all phases are complete, the prototype will have:

- **Zero known bugs** — every icon renders, every score computes, every navigation path works round-trip
- **Stable data model** — every object has a unique ID, timestamps, and uses consistent user references
- **Complete user journeys** — create trip, plan trip, live trip, and completed trip are all demonstrable
- **TypeScript interfaces** — the definitive schema for every entity
- **Permission matrix** — every action mapped to every role
- **Notification event layer** — 5 triggers wired, bell icon with unread count
- **Score entry** — at least one format fully functional
- **Documentation** — README, SCHEMA.md, PERMISSIONS.md, REALTIME.md, MIGRATION_PLAN.md

At that point, you can hand the prototype + docs to Opus and say: "Build the real app. The prototype is the UI spec. The schema docs are the database spec. The migration plan is the task list. Go."

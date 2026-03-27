# BuddyTrip

A mobile-first group trip planning and competition app. Built around BBMI (Buddy Banks Memorial Invitational) as a real-world prototype, but designed to generalize to any recurring friend group trip — golf, wine country, Disney, bachelor party, etc.

**Stack:** Single-file HTML prototype (`buddytrip.html`) — React via CDN, inline CSS variables, no build step
**Repo also contains:** React + TypeScript + Vite scaffold in `src/` (partially synced, prototype is source of truth)
**Status:** Active prototype — all screens functional, mock data only, no backend

---

## What It Does

BuddyTrip solves the coordination problem for recurring group trips:

- **Planning phase** — propose destinations, vote on ideas, poll dates, build a crew roster
- **Booking phase** — centralize reservations, confirmations, expenses
- **Competition** — Ryder Cup-style team scoring across multiple round formats
- **Live event** — real-time leaderboard, score entry by group, live standings
- **Communication** — trip-wide chat + private team chat (filtered by team membership)
- **Notifications** — in-app activity feed with bell icon, unread count, and 5 event types

---

## Single-File Prototype

All active development happens in **`buddytrip.html`** (~5,390 lines). Open it directly in a browser — no server needed.

### Mock Trips

| Trip | ID | Designed Status | Notes |
|---|---|---|------|
| BBMI 2025 | `trip-bbmi-live` | `active` (Live) | Bandon Dunes — scoring in progress, Day 3 |
| BBMI 2026 | `trip-bbmi` | `planning` | Destination comparison active (Scottsdale vs Bandon), date poll locked to Oct 2026 |
| BBMI 2027 | `trip-new-deciding` | `planning` | Early stage — 1 idea, no dates, 3 attendees |
| BBMI 2024 | `trip-bbmi-2024` | `completed` | Bandon Dunes — Team Hammer won 14–12, past dates (Mar 2024) |

> **Note:** Trip status is derived dynamically by `getTripStatus(trip)` using `new Date()`. Since BBMI 2025 has 2025 dates, it will show as `completed` when opened after March 2025. To see it as `active`, adjust its `startDate`/`endDate` to include today's date.

### Mock Users / Dev Switcher

Role switcher always visible bottom-right during development:

| Role | User | userId | Can Do |
|---|---|---|---|
| `owner` | Brad | `brad` | Everything — settings, lock destination, transfer, delete |
| `planner` | Grether | `zach` | Add/edit content, invite crew, competition setup |
| `member` | Rob | `rob` | Vote, chat, view — no editing privileges |

**Important:** The role switcher changes `viewerRole` (which controls UI gating via `isOwner`/`canEdit`) but does NOT change `CURRENT_USER`. All data mutations (votes, messages, expenses) are always attributed to `zach` regardless of the selected role.

---

## Trip Status Model

Four statuses with distinct visual treatment, derived dynamically by `getTripStatus(trip)`:

| Status | Badge | Derivation Rule | Dashboard Card |
|---|---|---|---|
| `completed` | ✓ Done (gray) | `endDate` in the past | Muted — no accent bar, no scoreboard |
| `active` | ▶ LIVE (teal) | `startDate` reached, `endDate` not passed | Teal accent bar, live dot, scoreboard strip |
| `ready` | ✓ Ready (violet) | Destination + dates locked, not yet active | Violet accent bar, countdown strip |
| `planning` | ⊞ Planning (blue) | Default — missing destination or dates | Neutral border, no accent bar |

**Derivation priority:** completed → active → ready → planning (first match wins).

**`effectiveStartDate`** priority: `lockedDateWindow.start` → `trip.startDate`
**`effectiveEndDate`** priority: `lockedDateWindow.end` → `trip.endDate`

No `status` field exists on trip objects — fully derived at render time.

---

## Screen Inventory

### Route Map

| Screen | Route Key | Props | Status |
|---|---|---|---|
| Dashboard | `trips` | navigate, viewerRole, trips, notifications, onMarkAllRead | ✅ |
| New Trip | `trip-new` | navigate, showToast, setTrips, notifications, onMarkAllRead | ✅ 2-step wizard (basics → invites) |
| Trip Detail | `trip-detail` | navigate, showToast, tripId, viewerRole, trips, setTrips, notify, notifications, onMarkAllRead | ✅ 5 tabs (see below) |
| Competition Setup | `comp-setup` | navigate, showToast, tripId, viewerRole, trips, notifications, onMarkAllRead | ✅ Manual team assignment; draft mode stubbed |
| Idea Comparison | `idea-comparison` | navigate, showToast, tripId, viewerRole, trips, setTrips, notify, notifications, onMarkAllRead | ✅ Side-by-side voting, comments, lock/unlock |
| Trip Messages | `trip-messages` | navigate, showToast, tripId, viewerRole, trips, notify, notifications, onMarkAllRead | ✅ Trip Chat + Team Chat stacked |
| Live Leaderboard | `live-leaderboard` | navigate, showToast, tripId, notify, notifications, onMarkAllRead | ✅ 4 tabs: Overview, Groups, Trip Info, History |

### TripDetail Tabs

| Tab | ID | Always Shown | Contents |
|---|---|---|---|
| Home | `home` | Yes | Destination panel, date panel, competition hero/CTA, about card, chat teaser |
| Schedule | `schedule` | Yes | Reservations (accommodations, tee times), date voting |
| Crew | `crew` | Yes | Roster management, add members, invite flow, trip history |
| Comp | `competition` | Only when `hasComp` | Teams accordion, rounds, courses (via SectionAccordion) |
| More | `more` | Yes | Expenses (list + add form), settings panel (owner-only) |

### Notable Sub-Components (not routed)

| Component | Parent | Description |
|---|---|---|
| ScoreEntry | LiveLeaderboard | Bottom-sheet modal for entering group scores per round |
| TripChat | TripDetail, TripMessages | Reusable chat with scroll-to-bottom, unread pill, draft state |
| AddExpenseForm | TripDetail > More | Inline form for creating new expenses |
| TripSettingsPanel | TripDetail > More | Owner-only: series linking, ownership transfer, archive, delete |

---

## Navigation Architecture

### Bottom Nav — context-aware

**Outside a trip** (Dashboard, TripNew): 3 items — Home · New Trip · Live
**Inside a trip** (TripDetail, CompetitionSetup, TripMessages): 4 items — Home · Trip Home · Messages · Live

- **Trip Home** — navigates back to that trip's `trip-detail`
- **Messages** — navigates to `trip-messages` with unread badge (red dot)
- **Live** — always navigates to `live-leaderboard`
- IdeaComparison and LiveLeaderboard do **not** show BottomNav

### Breadcrumbs

Pattern: `Trips > [Trip Name] > [Sub-screen]`

| Screen | Breadcrumb |
|---|---|
| TripNew | `Trips › New Trip` |
| TripDetail | `Trips › {trip.title}` |
| CompetitionSetup | `Trips › {trip.title} › Competition Setup` |
| IdeaComparison | `Trips › {trip.title} › Where to?` |
| TripMessages | `Trips › {trip.title} › Messages` |
| LiveLeaderboard | No breadcrumb — uses `← TRIP HOME` back button in header |

Root "Trips" always navigates to `trips` (Dashboard). Middle crumbs navigate to `trip-detail`.

### Navigation Graph

```
Dashboard ──→ TripDetail ──→ IdeaComparison
    │              │──→ TripMessages
    │              │──→ CompetitionSetup
    │              │──→ LiveLeaderboard ──→ ScoreEntry (modal)
    │              └──→ (tabs: Home, Schedule, Crew, Comp, More)
    ├──→ TripNew ──→ TripDetail (after creation)
    └──→ LiveLeaderboard (via scoreboard strip on live trip card)

TopNav notification click ──→ TripDetail (for that notification's trip)
```

---

## Data Architecture

### Module-Level Data Objects

| Object | Description |
|---|---|
| `CURRENT_USER` | Logged-in user — hardcoded to Zach Grether (`zach`) |
| `USERS` | Global user directory (19 entries: 16 BBMI players + 3 invite-flow accounts) |
| `BBMI_EVENT` | Competition event: teams, players (16), groups (4), rounds (4), side events (3) |
| `TEAM_ASSIGNMENTS` | Normalized team membership: `[{ eventId, teamId, userId }]` |
| `MOCK_TRIPS` | 4 trips (initialized at module level, lifted to App-level `useState`) |
| `IDEA_VOTES` | Destination votes keyed by `tripId` + `ideaId` + `userId` |
| `IDEA_COMMENTS` | Comments on destination ideas |
| `DATE_VOTES` | Votes on proposed date ranges |
| `RESERVATIONS` | Bookings (accommodations, tee times) for `trip-bbmi-live` |
| `EXPENSES` | Trip expenses with `paidByUserId` and `splitAmong[].userId` |
| `TRIP_MESSAGES` | Chat messages: `{ [tripId]: { trip: [...], team: { [teamId]: [...] } } }` |
| `ROUND_RESULTS` | Aggregated round scores per team (derived from GROUP_RESULTS) |
| `GROUP_RESULTS` | Per-group scores per round — the source of truth for scoring |
| `NOTIFICATION_EVENTS` | In-app activity feed (5 seed entries, 2 unread on first load) |

### Key Helper Functions

| Function | Description |
|---|---|
| `getTripStatus(trip)` | Derives `planning` / `ready` / `active` / `completed` from trip data |
| `computeScores(event, roundResults)` | Pure function — returns `{ teamId: points, remaining }` |
| `getTeamId(eventId, userId)` | Lookup team assignment from TEAM_ASSIGNMENTS |
| `aggregateGroupResults(roundId)` | Sums GROUP_RESULTS into ROUND_RESULTS for a round |
| `pushNotification(opts)` | Creates a notification event and appends to NOTIFICATION_EVENTS |

### Trip-Level State (on trip objects, not globals)

- `lockedDestination` — `{ title, location, createdAt }` or `null`
- `datePoll` — `{ open, lockedId, windows: [], votes: [] }` or `null`

These replaced the former `DESTINATION_LOCK` and `DATE_POLL` module-level globals (task 3.2).

### Messages Shape

```js
TRIP_MESSAGES[tripId] = {
  trip: [{ _id, userId, text, createdAt }, ...],
  team: {
    'team-a': [{ _id, userId, text, createdAt }, ...],
    'team-b': [{ _id, userId, text, createdAt }, ...],
  }
}
```

Team chat is filtered by the current user's team via `getTeamId()`. Users not on a team see "You're not on a team yet."

### Notification Types

| Type | Icon | Trigger |
|---|---|---|
| `destination_locked` | MapPin (teal) | Owner locks destination in IdeaComparison |
| `dates_locked` | Calendar (blue) | Owner locks dates in TripDetail date panel |
| `crew_added` | Users (owner color) | Member added via TripSettingsPanel |
| `chat_message` | MessageCircle (gray) | New message sent in TripMessages |
| `score_submitted` | Trophy (orange) | Score entered in LiveLeaderboard > ScoreEntry |

---

## Destination + Date Panel Logic

### Destination Panel
- Shows when `trip.comparisonMode && !trip.lockedDestination`
- Lock stored as `trip.lockedDestination`; writes via `setTrips()`
- Edit/reopen clears lock without navigating away
- Card grid: `repeat(min(count, 3), minmax(0, 1fr))`

### Date Panel
- **No dates:** date pickers + Set Dates + Poll the crew
- **Poll open:** windows, I'm in / Can't do it, Lock In, Add window
- **Confirmed (green):** compact row, Change button reopens picker
- **`effectiveStartDate`** priority: `lockedWindow.start → trip.startDate`

---

## Design System

```
--bt-accent:     #00d4aa   teal — primary, live, accent
--bt-accent-dim: #009e80   dimmed teal
--bt-base:       #0d1117   page background
--bt-card:       #161b22   card background
--bt-tag-bg:     #0d2a22   tag/chip background
--bt-danger:     red       destructive, unread
--bt-live:       #00d4aa   live indicator (same as accent)
--bt-planning:   #7c93d4   planning status blue
--bt-blue-bg:    #161e35   planning badge background
--bt-owner:      #f0a84a   owner role color
Ready color:     #a78bfa   violet (hardcoded, not a CSS var)
```

**Icon system:** All icons must exist in the `ICONS` dict (~line 144). Do NOT reference icon names that aren't listed. Missing icons render as empty SVGs with no error.

---

## Permission Model

Three-tier role system. Full matrix documented in `PERMISSIONS.md`.

| | Owner | Planner | Member |
|---|---|---|---|
| Lock/unlock destination | ✓ | — | — |
| Manage crew roles | ✓ | — | — |
| Trip settings (transfer, archive, delete) | ✓ | — | — |
| Add ideas, manage dates, setup competition | ✓ | ✓ | — |
| Add crew, create expenses | ✓ | ✓ | — |
| Vote on destination/dates, chat, view | ✓ | ✓ | ✓ |

Team chat privacy is enforced by `TEAM_ASSIGNMENTS` lookup — all roles see only their own team's chat.

---

## Key Engineering Rules

1. **Hooks at top level only** — `useState`/`useRef` cannot live inside IIFEs, nested functions, or conditionals. This has caused multiple crashes.
2. **IIFE vs Component** — use IIFEs for pure render logic. Extract to named component when you need `useRef`/`useEffect`.
3. **State via setTrips** — Trip-level data (destination lock, date poll) lives on trip objects and is updated via `setTrips()`. No module-level mutable globals for trip state.
4. **Module-level arrays need nonces** — `NOTIFICATION_EVENTS`, `GROUP_RESULTS`, and `EXPENSES` are module-level mutable objects outside React state. Mutations must be paired with a nonce counter (`notifNonce`, `scoreNonce`) to force re-renders.

---

## Reference Documents

| File | Description |
|---|---|
| `buddytrip.html` | The prototype — all screens, all data, opens directly in a browser |
| `types.ts` | Complete TypeScript interfaces for all 25+ entities (migration target schema) |
| `PERMISSIONS.md` | Full permission matrix — every action × every role, with RLS migration notes |
| `PLAYBOOK.md` | Pre-migration task list — phases, decision points, model recommendations |
| `CONTEXT.md` | Session-to-session state — completed tasks, notes, next steps |

---

## Running

Open `buddytrip.html` directly in a browser. No build step required.

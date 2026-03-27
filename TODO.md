# BuddyTrip — TODO

---

## 🔥 Next Session Priorities

### 1. Notification System — Design Pass
Mapped trigger inventory this session. Need to decide on delivery model before building UI.

**Trigger inventory (ready to implement):**

| Trigger | Who |
|---|---|
| Destination vote cast | Organizers |
| Destination locked | All crew |
| New destination idea added | All crew |
| Date poll opened | All crew |
| Date vote cast | Organizers |
| Dates locked | All crew |
| Trip status → Ready | All crew |
| Trip status → Live (day of) | All crew |
| New crew member joined/RSVP'd | Organizers |
| Member RSVP changed | Organizers |
| New Trip Chat message | All crew (with mute option) |
| New Team Chat message | Teammates only |
| Mentioned in a comment | That person |
| Destination comment posted | Other commenters on that idea |
| Competition score submitted | All crew |
| New round added to schedule | All crew |

**Key design questions to answer:**
- Frequency control: immediate / daily digest / off — per-trip, not global
- Live scoring: notify every score, or only lead changes? Blowout vs close game matters.
- Live scoring is closer to a WebSocket push problem than a notification problem — don't conflate them

**Suggested first build:** in-app notification center (bell icon in TopNav), not push yet. Show unread dot, list of recent events. Push is a later layer.

---

### 2. Trip Status Transition — Ready → Live
Status is currently set in mock data. Need auto-transition logic:

- `planning → ready`: when `lockedDest && (lockedWindow || knownDateSet.start)` — could add crew minimum as optional gating
- `ready → active`: when `today >= startDate` — purely date-driven, no user action
- `active → completed`: when `today > endDate`

For prototype: derive status dynamically from trip data instead of a hardcoded `status` field. This makes the status always accurate and eliminates the need to manually update mock data.

**Competition-gated Ready (optional):** if `hasComp`, require at least 2 teams with players assigned before `ready`. This is a product decision — note it's not implemented yet.

---

### 3. TripNew — Simplify Creation Flow
Current `TripNew.tsx`/`trip-new` screen is a stub. Needs a real tight implementation.

**Fields at creation only:**
- Trip name (required, autofocused)
- Dates or "TBD" toggle
- Location (free text, optional)
- Invite by name/email (optional, skippable)

**UX target:** Single scrollable card, no wizard/stepper, one big Create button. Everything else lives in TripDetail post-creation.

**New trip routing logic (decided this session):**
- 1 idea → lock it, go to `trip-detail`
- 2+ ideas → go to `trip-detail` with destination panel open (comparison mode)

---

### 4. Messages — Unread State Management
Currently unread count is approximated (any message not from CURRENT_USER = unread). Real implementation needs:
- Last-read timestamp per thread per user
- Unread = messages after last-read timestamp
- Marking read when you open the thread or scroll to bottom
- Badge should clear when Messages screen is opened

---

### 5. Team Chat — Privacy Model
Currently both teams' members can see team chat in the prototype (mock data). Real implementation:
- Team Chat messages must be filtered server-side by team membership
- Client should never receive the other team's messages
- For prototype: could fake this by only showing team chat when `CURRENT_USER` is on that team

---

## 🟡 Backlog

### Competition Setup — Captain's Draft Mode
Two team formation modes:
- **Manual** (default) — owner assigns players
- **Captain's Draft** — owner picks 2 captains, serpentine draft order, each captain selects in turn

### Trip Settings — Owner Screen
- Assign to Series
- Transfer Ownership
- Competition suspend (don't delete rounds, show suspended state)
- Archive trip
- Delete trip (type name to confirm)

**Series concept:** Named recurring event (BBMI) that owns historical record. Individual trips belong to series. Series record doesn't move when ownership transfers.

### Crew Invite Flow
- Account lookup (existing BuddyTrip user?)
- In-app invite vs email invite link
- Planner promotion after accepting
- Bulk invite by email list

### Expense Improvements
- Settlement view (net who-owes-who)
- Mark as paid
- Receipt photo
- CSV/Venmo export

### Scoring — Sabotage Format
Last-place elimination logic not yet wired into score entry or leaderboard. Shows as active but doesn't process eliminations.

### Dashboard Personalization
"Welcome back, Grether" is hardcoded. Should reflect active role from dev switcher (and eventually real auth).

### Past Trips
Currently a collapsed toggle. Long-term: searchable, filterable by series, win/loss record per series.

---

## ✅ Done

- [x] Scoring engine (LiveLeaderboard, LiveScoreEntry, RoundBuilder)
- [x] Dashboard with Live/Upcoming/Past sections
- [x] Trip status model — planning / ready / live with distinct card treatments
- [x] TripDetail 5-tab structure (Home, Schedule, Crew, Competition, More)
- [x] Role system (Owner / Planner / Member) + dev switcher
- [x] Planning Arc hidden from member role
- [x] Add Competition modal with team assignment
- [x] Quick Info tiles (owner-editable)
- [x] Trip header card
- [x] Expense split editing
- [x] IdeaComparison with comment threads + timestamps
- [x] Date voting with availability bars
- [x] Destination panel — grid layout, always visible, inline vote + lock
- [x] Date panel — above tabs, 3 states, wired Change button
- [x] Edit destination — clears lock reactively, no navigation
- [x] Context-aware bottom nav (3 outside trip, 4 inside)
- [x] Messages screen — stacked Trip Chat + Team Chat
- [x] TripChat component — max height, scroll-to-bottom, new-message pill
- [x] Home tab chat teaser — compact unread indicator
- [x] Breadcrumbs — consistent Trips > Trip > Screen pattern
- [x] LiveLeaderboard — native ← TRIP HOME back link
- [x] Notification trigger inventory mapped (not built)

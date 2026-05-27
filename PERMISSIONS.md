# BuddyTrip — Permission Model

*Authoritative reference for which roles can perform which actions.*
*Enforced via `requireTripRole()` middleware (tRPC), RLS policies
(migrations 003, 008, 009, 010), and frontend `canEdit`/`isOwner` guards.*

---

## Roles

| Role | Variable | Description |
|------|----------|-------------|
| **Owner** | `viewerRole === 'owner'` | Full control. Creates the trip, manages the crew, locks decisions. |
| **Planner** | `viewerRole === 'planner'` | Planning authority. Can edit trip details, manage dates, add ideas, add crew. Cannot lock destinations or manage roles. |
| **Member** | `viewerRole === 'member'` | Participant. Can vote, comment, chat, and view everything. Cannot edit trip configuration. |

**Derived flags used in code:**
- `isOwner = viewerRole === 'owner'`
- `canEdit = viewerRole === 'owner' || viewerRole === 'planner'`

---

## Permission Matrix

### Trip Management

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| Create trip | ✓ | ✓ | ✓ | None (any logged-in user) | TripNew |
| Edit trip description | ✓ | ✓ | — | `canEdit` | AboutCard |
| View planning progress arc | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Access trip settings panel | ✓ | — | — | `isOwner` | TripDetail MoreTab |
| Link/unlink series | ✓ | — | — | `isOwner` (inside settings) | TripSettingsPanel |
| Transfer ownership | ✓ | — | — | `isOwner` (inside settings) | TripSettingsPanel |
| Archive trip | ✓ | — | — | `isOwner` (inside settings) | TripSettingsPanel |
| Delete trip | ✓ | — | — | `isOwner` (inside settings) | TripSettingsPanel |

### Destination

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| Set up destination (initial) | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Vote on destination | ✓ | ✓ | ✓ | None | TripDetail HomeTab, IdeaComparison |
| Lock destination | ✓ | — | — | `isOwner` | TripDetail HomeTab, IdeaComparison |
| Unlock / edit destination | ✓ | — | — | `isOwner` | TripDetail HomeTab |
| Reopen destination vote | ✓ | — | — | `isOwner` | IdeaComparison |
| Override destination (manual) | ✓ | — | — | `isOwner` | IdeaComparison |
| Navigate to full comparison view | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |

### Ideas (Destination Comparison)

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| Add idea / destination option | ✓ | — | — | `isOwner` | TripDetail HomeTab, IdeaComparison |
| Remove idea | ✓ | — | — | `isOwner` | IdeaComparison |
| Edit idea description | ✓ | ✓ | — | `canEdit` | IdeaComparison |
| Edit idea pros / cons | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab, IdeaComparison |
| Remove golf course from idea | ✓ | ✓ | — | `canEdit` | IdeaComparison |
| Remove activity from idea | ✓ | ✓ | — | `canEdit` | IdeaComparison |
| Comment on idea | ✓ | ✓ | ✓ | None | IdeaComparison |
| Lock in idea as destination | ✓ | — | — | `isOwner` | IdeaComparison |

### Dates

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| Set dates (known dates) — `trips.lockDates` | ✓ | ✓ | — | `canEdit` | DatesPlanningRow |
| Toggle poll mode on/off — `datePoll.setPollMode` | ✓ | ✓ | — | `canEdit` | DatesPlanningRow |
| Add date window to poll — `datePoll.addWindow` | ✓ | ✓ | — | `canEdit` | DatesPlanningRow |
| Remove date window — `datePoll.removeWindow` | ✓ | ✓ | — | `canEdit` | DatesPlanningRow |
| Vote on date windows — `datePoll.castDateVote` | ✓ | ✓ | ✓ | None | DatePollCard |
| Vote on behalf of member — `datePoll.castVoteForMember` | ✓ | ✓ | — | `canEdit` | DatePollCard |
| Notify crew poll opened — `datePoll.notifyCrewPollOpen` | ✓ | ✓ | — | `canEdit` (opt-in, once) | DatePollCard |
| Reset poll votes — `datePoll.resetPoll` | ✓ | ✓ | — | `canEdit` | DatePollCard |
| Lock date window — `datePoll.lockDateWindow` | ✓ | ✓ | — | `canEdit` | DatePollGrid popover |
| Change locked dates | ✓ | ✓ | — | `canEdit` | TripSettingsModal |

### Quick Info Tiles

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View tiles | ✓ | ✓ | ✓ | None | TripDetail HomeTab |
| Add tile | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Edit tile | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Delete tile | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |

### Crew

Roster management is **Owner-only** (Task 53). Planners can plan the trip,
but the crew list — who's in, what they're called, what role they hold — is
the Owner's responsibility. Both the Crew tab UI (`isOwner` gate) and the
underlying tRPC procedures enforce this.

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View crew roster | ✓ | ✓ | ✓ | None | TripDetail CrewTab |
| Add crew member | ✓ | — | — | `isOwner` | TripDetail CrewTab |
| Add guest crew (ghost) | ✓ | — | — | `isOwner` | TripDetail CrewTab |
| Edit guest crew (name/email) | ✓ | — | — | `isOwner` | MemberEditor |
| Rename a member (trip-scoped nickname) | ✓ | — | — | `isOwner` | MemberEditor |
| Send invite to member | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Send invitation blast | ✓ | — | — | `isOwner` | InvitationCenter |
| Change own RSVP status | ✓ | ✓ | ✓ | `isMe` | TripDetail CrewTab |
| Promote Member → Planner | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Demote Planner → Member | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Remove crew member | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Set travel info (self) | ✓ | ✓ | ✓ | `isMe` | TripDetail CrewTab |
| Set travel info (other) | ✓ | — | — | `isOwner` | MemberEditor |

### Competition

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View competition / leaderboard | ✓ | ✓ | ✓ | None | TripDetail CompTab, LiveLeaderboard |
| Enable competition | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Disable competition | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Edit teams | ✓ | ✓ | — | `canEdit` | TripDetail CompTab, CompetitionSetup |
| Add / remove rounds | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Add / remove side events | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Enter scores | ✓ | ✓ | ✓ | None (any trip member) | LiveLeaderboard |

### Competition Event — Agenda Link

| Action | Owner | Planner | Member | Gate |
|--------|:-----:|:-------:|:------:|------|
| Link competition event to agenda item | ✓ | ✓ | — | `canEdit` |
| Unlink competition event from agenda item | ✓ | ✓ | — | `canEdit` |

### Logistics

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View bookings | ✓ | ✓ | ✓ | None | TripDetail ScheduleTab |
| Add booking | ✓ | ✓ | — | `canEdit` | TripDetail ScheduleTab |

### Expenses

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View expenses | ✓ | ✓ | ✓ | None | TripDetail MoreTab |
| Add expense | ✓ | ✓ | — | `canEdit` | TripDetail MoreTab |
| Edit expense splits | ✓ | — | — | `isOwner` | TripDetail MoreTab |

### Messages

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View trip chat | ✓ | ✓ | ✓ | None | TripDetail, TripMessages |
| Send trip chat message | ✓ | ✓ | ✓ | None | TripDetail, TripMessages |
| View own team chat | ✓ | ✓ | ✓ | Team membership (`team_assignments`) | TripDetail, TripMessages |
| Send team chat message | ✓ | ✓ | ✓ | Team membership (`team_assignments`) | TripDetail, TripMessages |
| View other team's chat | — | — | — | Blocked by RLS + team filtering | TripMessages |

---

## RLS Enforcement Summary

These are implemented in production via Supabase RLS policies.

### Owner-only actions
RLS checks `trip_members.role = 'owner'` for the requesting user:

- Destination lock / unlock / override
- Idea creation and removal
- All roster management — add, invite, rename, promote, demote, remove,
  guest-crew CRUD, invitation blast
- Trip settings (series link, ownership transfer, archive, delete)
- Expense split modification

### Owner + Planner actions
RLS checks `trip_members.role IN ('owner', 'planner')`:

- Trip description edit
- Idea detail editing (description, pros/cons, golf, activities, lodging)
- Date setup, poll management, and date locking
- Quick info tile CRUD
- Competition setup (enable, disable, teams, rounds, sides)
- Expense creation
- Booking creation

### All-member actions
RLS checks `EXISTS (SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = auth.uid())`:

- Vote on destinations and dates
- Comment on ideas
- Send chat messages (trip channel)
- Enter scores
- Change own RSVP status
- View all trip data

### Team-scoped actions
RLS checks team assignment in addition to trip membership:

- View team chat: `team_assignments.user_id = auth.uid() AND team_assignments.team_id = message.team_id`
- Send team chat: same check on INSERT

---

## Resolved Design Decisions

These were open questions during development. Documented here for reference.

| Question | Decision |
|----------|---------|
| Score entry gating | Any trip member can enter scores — no role restriction |
| Expense editing scope | Owner-only for split modification |
| Idea creation | Owner-only (simplifies idea-stage flow) |
| Idea removal | Owner-only |
| Self-service RSVP | Implemented — members change their own status |
| Trip creation | Any logged-in user can create |

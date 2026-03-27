# BuddyTrip — Permission Model

*Complete reference for which roles can perform which actions. Derived from every `isOwner`, `canEdit`, and `viewerRole` check in the prototype.*

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
| Add idea / destination option | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab, IdeaComparison |
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
| Set dates (known dates) | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Open date poll | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Add date window to poll | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Vote on date windows | ✓ | ✓ | ✓ | None | TripDetail HomeTab |
| Lock date window | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Close date poll (without locking) | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |
| Change locked dates | ✓ | ✓ | — | `canEdit` | TripDetail HomeTab |

### Quick Info Tiles

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View tiles | ✓ | ✓ | ✓ | None | TripDetail HomeTab |
| Add tile | ✓ | — | — | `isOwner` | TripDetail HomeTab |
| Edit tile | ✓ | — | — | `isOwner` | TripDetail HomeTab |
| Delete tile | ✓ | — | — | `isOwner` | TripDetail HomeTab |

### Crew

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View crew roster | ✓ | ✓ | ✓ | None | TripDetail CrewTab |
| Add crew member | ✓ | ✓ | — | `canEdit` | TripDetail CrewTab |
| Send invite to member | ✓ | ✓ | — | `canEdit && !isMe` | TripDetail CrewTab |
| Promote Member → Planner | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Demote Planner → Member | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |
| Remove crew member | ✓ | — | — | `isOwner && !isMe` | TripDetail CrewTab |

### Competition

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View competition / leaderboard | ✓ | ✓ | ✓ | None | TripDetail CompTab, LiveLeaderboard |
| Enable competition | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Disable competition | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Edit teams | ✓ | ✓ | — | `canEdit` | TripDetail CompTab, CompetitionSetup |
| Add / remove rounds | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Add / remove side events | ✓ | ✓ | — | `canEdit` | TripDetail CompTab |
| Enter scores | ✓ | ✓ | ✓ | None (no role check) | LiveLeaderboard |

### Logistics

| Action | Owner | Planner | Member | Gate | Component |
|--------|:-----:|:-------:|:------:|------|-----------|
| View bookings | ✓ | ✓ | ✓ | None | TripDetail LogisticsTab |
| Add booking (stub) | ✓ | ✓ | — | `canEdit` | TripDetail LogisticsTab |

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
| View own team chat | ✓ | ✓ | ✓ | Team membership (TEAM_ASSIGNMENTS) | TripDetail, TripMessages |
| Send team chat message | ✓ | ✓ | ✓ | Team membership (TEAM_ASSIGNMENTS) | TripDetail, TripMessages |
| View other team's chat | — | — | — | Blocked by team filtering | TripMessages |

---

## Notes for Migration (RLS Policies)

### Owner-only actions (enforce via RLS + server function)
These actions have the highest trust requirement. In Supabase, enforce with RLS policies that check `trip_members.role = 'owner'` for the requesting user:

- Destination lock / unlock / override
- Crew role management (promote, demote, remove)
- Trip settings (series link, ownership transfer, archive, delete)
- Quick info tile CRUD
- Expense edit (split modification)

### Owner + Planner actions (enforce via RLS)
Check `trip_members.role IN ('owner', 'planner')`:

- Trip description edit
- Idea / destination addition and detail editing
- Date setup, poll management, and date locking
- Competition setup (enable, disable, teams, rounds, sides)
- Crew addition and invitations
- Expense creation
- Booking creation

### All-role actions (enforce via trip membership)
Check `EXISTS (SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = auth.uid())`:

- Vote on destinations
- Vote on dates
- Comment on ideas
- Send chat messages (trip channel)
- Enter scores
- View all trip data

### Team-scoped actions (enforce via team membership)
Check team assignment in addition to trip membership:

- View team chat: `team_assignments.user_id = auth.uid() AND team_assignments.team_id = message.team_id`
- Send team chat: same check on INSERT

### Open questions for production

1. **Score entry gating** — Currently any user can enter scores (LiveLeaderboard has no `viewerRole` prop). Should this be restricted to Owner + Planner? Or to the designated scorer for each group?
2. **Expense editing scope** — Currently only Owner can edit splits. Should Planner also be able to? Should the person who created the expense be able to edit it?
3. **Idea removal** — Currently Owner-only. Should the person who proposed an idea be able to remove it?
4. **Self-service RSVP** — Members can't currently change their own RSVP status through the UI. This should be added.
5. **Trip creation** — Currently unprotected (any logged-in user). Is this correct, or should it require an invitation to a series?

# BuddyTrip — Permission Model

*Authoritative reference for which roles can perform which actions.*
*Enforced via `requireTripRole()` / `requireTripMember` middleware (tRPC,
`src/server/middleware.ts`), Supabase RLS policies, and frontend
`canEdit`/`isOwner` guards. The tRPC gates are the source of truth — this doc
mirrors them.*

*Last reconciled against the code: 2026-06-07 (see **Audit notes** at the end
for what changed and the open questions).*

---

## Roles

The role lives on `trip_members.role`. In code the values are **capitalized**
and the middle role is named **`Planner`**, but the **user-facing term is
"Organizer."** This doc uses *Organizer* for readability; treat it as identical
to the code's `Planner`.

| Role (UI) | Code value (`TripRole`) | Description |
|-----------|-------------------------|-------------|
| **Owner** | `'Owner'` | Full control. Creates the trip, owns the crew roster, locks decisions, transfers/deletes the trip. |
| **Organizer** | `'Planner'` | Planning authority. Edits trip details, dates, ideas, lodging, agenda, competition, news, tiles. Cannot manage the roster, lock the destination, transfer, or delete. |
| **Member** | `'Member'` | Participant. Views everything on the trip, votes, chats (crew), logs expenses + own travel. Cannot edit trip configuration. |

**Derived flags used in code:**
- `isOwner = viewerRole === 'Owner'`
- `canEdit = viewerRole === 'Owner' || viewerRole === 'Planner'` (Owner **or** Organizer)

**Hierarchy & access notes:**
- `requireTripRole(min)` is **hierarchical**: Owner (3) ≥ Organizer/Planner (2) ≥ Member (1). So an Owner satisfies any Organizer-gated action; `requireTripRole("Planner")` admits Owner **and** Organizer, not Members.
- **Non-members are fully blocked.** There is no "outsider" / guest read role — `requireTripMember` rejects anyone without a `trip_members` row (`FORBIDDEN`). Access is all-or-nothing membership.
- The **Organizers chat** is the one place "Organizer" is gated by message visibility (`visibility = 'planning'`) rather than the role check directly — same effect (Owner + Organizer only).

---

## Permission Matrix

Each row notes the **tRPC procedure** (authoritative gate).

### Trip management — `trips`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| Create trip | ✓ | ✓ | ✓ | `create` *(any authed; creator becomes Owner)* |
| View trip | ✓ | ✓ | ✓ | `getById` *(member)* |
| List my trips | ✓ | ✓ | ✓ | `list` *(any authed; own memberships)* |
| Rename trip | ✓ | ✓ | — | `renameTripName` |
| Edit "about" message | ✓ | ✓ | — | `updateAboutMessage` |
| Change destination | ✓ | ✓ | — | `changeDestination` |
| Lock destination | ✓ | — | — | `lockDestination` *(Owner)* |
| Transfer ownership | ✓ | — | — | `transferOwnership` *(Owner)* |
| Delete trip | ✓ | — | — | `delete` *(Owner)* |

### Trip dates — `datePoll` + `trips.lockDates`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| Set / change locked dates | ✓ | ✓ | — | `trips.lockDates` |
| Toggle poll mode | ✓ | ✓ | — | `datePoll.setPollMode` |
| Add / remove date window | ✓ | ✓ | — | `datePoll.addWindow` / `removeWindow` |
| Lock the winning window | ✓ | ✓ | — | `datePoll.lockDateWindow` |
| Clear dates / return to poll | ✓ | ✓ | — | `datePoll.unlock` / `returnToPoll` |
| Vote on a window (self) | ✓ | ✓ | ✓ | `datePoll.castDateVote` |
| Vote on behalf of a member | ✓ | — | — | `datePoll.castVoteForMember` **(Owner only)** |

### Destination ideas — `ideas`, `ideaLodging`, `archivedIdeas`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View ideas | ✓ | ✓ | ✓ | `ideas.list` |
| Browse global idea catalog | ✓ | ✓ | ✓ | `ideas.catalogList` *(any authed)* |
| Vote on an idea | ✓ | ✓ | ✓ | `ideas.vote` |
| Add idea | ✓ | — | — | `ideas.create` *(Owner)* |
| Remove idea | ✓ | — | — | `ideas.remove` *(Owner)* |
| Edit idea details | ✓ | ✓ | — | `ideas.update` |
| Suggest / edit lodging options on an idea | ✓ | ✓ | ✓ | `ideaLodging.create` / `update` / `remove` *(member)* |
| Archive an idea to personal archive | ✓ | — | — | `archivedIdeas.archive` *(Owner)* |
| View / remove **own** archived ideas | ✓ | ✓ | ✓ | `archivedIdeas.list` / `remove` *(self, via RLS)* |

### Crew / roster — `tripMembers`, `ghostCrew`

Roster management is **Owner-only**. Organizers plan the trip; the crew list —
who's in, what they're called, what role they hold — is the Owner's.

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View roster | ✓ | ✓ | ✓ | `tripMembers.list`, `checkEmail` |
| Add member | ✓ | — | — | `tripMembers.add` *(Owner)* |
| Invite by email / blast | ✓ | — | — | `inviteByEmail`, `sendInvitationBlast` *(Owner)* |
| Promote/demote role | ✓ | — | — | `updateRole` *(Owner; not self)* |
| Rename (trip nickname) | ✓ | — | — | `updateNickname` *(Owner; not the Owner)* |
| Remove member | ✓ | — | — | `remove` *(Owner; not self)* |
| Add / edit / remove ghost (placeholder) crew | ✓ | — | — | `ghostCrew.create` / `update` / `remove` *(Owner)* |
| Set **own** travel info | ✓ | ✓ | ✓ | `tripMembers.updateTravel` *(self)* |
| Set **another member's** travel info | ✓ | — | — | `tripMembers.updateMemberTravel` *(Owner)* |

### Lodging & logistics — `logistics`

(One router backs lodging + transport + general logistics.)

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View | ✓ | ✓ | ✓ | `list` |
| Add / edit / remove | ✓ | ✓ | — | `create` / `update` / `remove` |
| Confirm / unconfirm a booking | ✓ | ✓ | — | `confirm` / `unconfirm` |

### Schedule / agenda — `schedule`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View agenda | ✓ | ✓ | ✓ | `list` |
| Add / edit / remove items | ✓ | ✓ | — | `create` / `update` / `remove` |
| Reorder items | ✓ | ✓ | — | `reorder` |

### Quick-info tiles (header dock) — `quickInfoTiles`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View tiles | ✓ | ✓ | ✓ | `list` |
| Add / edit / remove tile | ✓ | ✓ | — | `create` / `update` / `remove` |

### Expenses & receipts — `expenses`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View expenses | ✓ | ✓ | ✓ | `list` |
| Add an expense / receipt | ✓ | ✓ | ✓ | `create` **(any member)** |
| Opt self in / out of a split | ✓ | ✓ | ✓ | `optOut` *(self)* |
| Edit a receipt's splits | ✓ | — | — | `updateSplits` *(Owner)* |
| Remove an expense | ✓ | ✓ | — | `remove` |

### Competition — `competitions`, `teams`, `events`, `teamAssignments`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View competition / teams / events / leaderboard | ✓ | ✓ | ✓ | `*.list` / `getByTrip` |
| Create / edit competition | ✓ | ✓ | — | `competitions.create` / `update` |
| Delete competition | ✓ | — | — | `competitions.delete` *(Owner)* |
| Create / edit teams | ✓ | ✓ | — | `teams.create` / `update` |
| Delete a team | ✓ | — | — | `teams.delete` *(Owner)* |
| Create / edit / reorder / delete events | ✓ | ✓ | — | `events.*` |
| Link event ↔ agenda item | ✓ | ✓ | — | `events.linkToAgendaItem` |
| Set point distributions / placements (scoring) | ✓ | ✓ | — | `events.setPointDistributions` / `setPlacements` |
| Assign member to a team | ✓ | ✓ | — | `teamAssignments.assign` |
| Remove a team assignment | ✓ | — | — | `teamAssignments.remove` *(Owner)* |

> **Scoring is Organizer+ today** (`setPlacements`). There is no member-facing
> "enter your own score" path — see open question Q2.

### News / trip board — `news`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| Read posts / unread count / mark read | ✓ | ✓ | ✓ | `list` / `unreadCount` / `markRead` |
| Read roster + competition draw (for composing) | ✓ | ✓ | ✓ | `roster` / `competitionDraw` |
| Create / edit / delete / pin a post | ✓ | ✓ | — | `create` / `update` / `delete` / `setPinned` |

### Chat / messaging — `messages`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| Read / send **Crew** chat | ✓ | ✓ | ✓ | `list` / `send` *(visibility `crew`)* |
| Read / send **Organizers** chat | ✓ | ✓ | — | `list` / `send` *(visibility `planning`)* |
| Read / send **Team** chat | team members only | — | — | `list` / `send` *(channel `team`; team assignment required)* |
| Mark a channel read | ✓ | ✓ | ✓ | `markRead` *(per visibility; planning = Organizer+)* |
| Clear a channel's messages | ✓ | — | — | `clearChannel` *(Owner)* |

### Account / profile (not trip-scoped) — `users`, `feedback`

| Action | Who | tRPC |
|--------|-----|------|
| View / edit own profile + avatar | any authed (self) | `users.getMe` / `updateMe` / `updateAvatar` |
| Delete own account | any authed (self) | `users.deleteMe` |
| Email-exact user lookup | any authed | `users.search` |
| Send product feedback | any authed | `feedback.send` *(no trip gate)* |

---

## Audit notes (2026-06-07)

This pass reconciled the doc against the tRPC routers. Highlights:

### Nomenclature
- **Planner → Organizer** throughout. The role value in code is still
  `'Planner'`; "Organizer" is the user-facing label (RoleBadge, the system
  message "*X is now an organizer*", the "Organizers" chat tab). The
  organizers-only chat is message **visibility `'planning'`**, not a role
  string. Role-variable casing corrected to capitalized (`'Owner'`, etc.) — the
  old doc used lowercase (`'owner'`), which never matched the code.

### Removed — rows deleted because the feature no longer exists
- **Link/unlink series** — the `series` table/feature was dropped (migration
  024). No router, no UI.
- **Archive trip** — no `trips.archive`. (Idea archiving exists via
  `archivedIdeas`, which is different and now documented.)
- **Comment on idea** — the `idea_comments` table + router were removed in
  pre-launch cleanup (`ideas.ts:28-29`).
- **Planning progress arc** — the stepper/arc was removed (only a stale test
  reference remains).
- **`datePoll.notifyCrewPollOpen` / `resetPoll`** — these procedure names no
  longer exist; the live equivalents are `unlock` / `returnToPoll`.
- Granular idea rows (**edit pros/cons, remove golf course, remove activity,
  reopen vote, override destination, full comparison view**) — collapsed into
  the single `ideas.update` (Organizer+) the code actually exposes. The
  multi-option side-by-side "comparison" flow described in the old doc isn't a
  set of role-gated endpoints anymore.

### Corrected — behavior the old doc had wrong
- **Add expense** — old doc said Organizer+ (`canEdit`); code allows **any
  member** (`expenses.create` is `requireTripMember`). Documented as any member.
- **Vote on behalf of member** — old doc said Organizer+; code is **Owner only**
  (`castVoteForMember`).
- **Disable/delete competition** & **delete team** — Owner only (the old doc
  lumped all competition edits under `canEdit`).
- **Organizers chat** — the old "trip chat: any member" row missed the
  crew-vs-organizers split; planning-visibility chat is Owner+Organizer only.
- **`clearChannel`** (clear a chat) — Owner only; wasn't documented.

### Added — features missing from the old doc
News/trip board, schedule/agenda (was conflated with logistics), idea-lodging
suggestions, archived ideas, team assignments, expense opt-out + remove, the
profile/account + feedback endpoints, and the full logistics CRUD (the old doc
only listed view + add).

### Open questions (need your intent — not resolvable from code)
- **Q1 — Self-service RSVP.** The old doc claimed members change their own
  going/maybe/out status; there is **no such procedure**. `trip_members.status`
  exists but is only set by the Owner on add/invite. Is self-service RSVP
  intended (re-add an endpoint), or is attendance now Owner-managed? Doc
  currently reflects code (no self-RSVP).
- **Q2 — Score entry.** Old doc said "any member enters scores." There's **no
  scores router**; scoring is `events.setPlacements` (Organizer+), and the live
  leaderboard is mid-rebuild. Should members enter their own scores once the
  engine ships, or stay Organizer-entered?
- **Q3 — Member "add expense".** Confirm any member *should* be able to log a
  receipt (current behavior) vs. Organizer+.
- **Q4 — RLS parity.** I documented the tRPC gates (source of truth). The old
  "RLS Enforcement Summary" referenced dropped features (series/archive) and
  old migration numbers; it's removed pending a separate RLS-vs-tRPC parity
  check — flag if you want that audited next.

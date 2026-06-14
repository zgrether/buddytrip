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

The role lives on `trip_members.role`. The middle role's value is **`Organizer`**
in both code and DB — renamed from `Planner` in migration 029 (PR #339), across
the `TripRole` type, every `requireTripRole` gate, the CHECK constraints, and all
30 RLS policies. The trip-state word **`planning`** and the planning/organizers
chat visibility (`messages.visibility = 'planning'`) were intentionally left
unchanged — those describe a phase, not the role.

| Role | Code/DB value (`TripRole`) | Description |
|------|----------------------------|-------------|
| **Owner** | `'Owner'` | Full control. Creates the trip, owns the crew roster, locks decisions, transfers/deletes the trip. |
| **Organizer** | `'Organizer'` | Planning authority. Edits trip details, dates, ideas, lodging, agenda, competition, news, tiles. Cannot manage the roster, lock the destination, transfer, or delete. |
| **Member** | `'Member'` | Participant. Views everything on the trip, votes, chats (crew), logs expenses + own travel. Cannot edit trip configuration. |

**Derived flags used in code:**
- `isOwner = viewerRole === 'Owner'`
- `canEdit = viewerRole === 'Owner' || viewerRole === 'Organizer'`

**Hierarchy & access notes:**
- `requireTripRole(min)` is **hierarchical**: Owner (3) ≥ Organizer (2) ≥ Member (1). So an Owner satisfies any Organizer-gated action; `requireTripRole("Organizer")` admits Owner **and** Organizer, not Members.
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
| **Edit / configure a game** (status incl. drop, points distribution, course, participants) | ✓ | ✓ | **game organizer of *that* game** | `games.update` / `setStatus` / `setPointsDistribution` / `applyCourse` / `addParticipants` |
| **Enter a game's results** (manual placement; finish/compute) | ✓ | ✓ | **game organizer of *that* game** | `games.setManualResults` / `finish` |
| **RUN: post results / open score correction** | ✓ | **—** | **game organizer of *that* game** | `games.post` / `openCorrection` *(Owner or game-delegate only — **not** a plain Organizer)* |
| Enter a per-hole score (until posted) | ✓ | ✓ | ✓ | `scores.upsertEntry` / `deleteEntry` *(any member; **blocked** once the game is posted & not in correction)* |
| Delegate / revoke a game organizer | ✓ | ✓ | — | `games.addOrganizer` / `removeOrganizer` *(trip staff only — a delegate can't sub-delegate)* |
| View who runs a game | ✓ | ✓ | ✓ | `games.listOrganizers` |

> **Per-game organizer delegation (Slice D1 §8).** Game edit/configure/enter-results
> resolves to **`canEdit || isGameOrganizer(gameId)`** — trip Owner/Organizer, OR a
> user granted organizer of *that specific game* (`game_organizers` row). It is
> **game-isolated**: a pick'em delegate cannot touch the scramble. Enforced at BOTH
> layers — the `requireGameEdit` tRPC middleware and the `is_game_organizer(game)`
> RLS path on `games` (UPDATE) + `game_results` (migration 045). Granting is a
> trip-staff act (`requireTripRole('Organizer')`).

> **Competition RUN-actions are owner/game-delegate scoped — narrower than game
> edit (Slice D Run/Post §5).** Posting results and opening score correction
> (`games.post` / `games.openCorrection`) gate on **`isOwner || isGameOrganizer(gameId)`**
> — the trip **Owner** or *that game's* delegate. A plain **Organizer (the trip
> planner) is NOT a run-action** unless they're also the game's delegate: running
> the competition is owner/delegate-scoped, distinct from trip-planner scope.
> Enforced server-side by `requireGameRunAction`. "Post" publishes the current
> standing and is **re-runnable** (Open → Posted ⇄ Correcting) — never a permanent
> finalize. A posted game's scores are frozen (`scores.upsertEntry`/`deleteEntry`
> return FORBIDDEN) until the owner/delegate opens correction; results stay
> visible to everyone throughout.

> **Scoring is Organizer+ today** (`setPlacements`). There is no member-facing
> "enter your own score" path yet — the intent (see Resolved notes) is for any
> member to score games they're in, once the scoring engine is rebuilt.

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
- **Planner → Organizer** — now a *full* rename (migration 029 / PR #339): the
  `TripRole` type, every `requireTripRole` gate, the `trip_members.role` +
  `invites.role` CHECK constraints, and all 30 RLS policies store/check
  `'Organizer'`. The trip-state word **`planning`** and the organizers-chat
  visibility (`messages.visibility = 'planning'`) were deliberately kept — they
  name a phase, not the role. Role-variable casing also corrected to
  capitalized (`'Owner'`, etc.) — the old doc used lowercase (`'owner'`).

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

### Resolved (product decisions, 2026-06-07)
- **RSVP — removed, confirmed.** There is no self-service RSVP and none is
  planned. `trip_members.status` stays purely as Owner-managed membership state
  (in / invited / out); the only "RSVP" left in the code is comments noting its
  removal. No action.
- **Score entry — intent: any member.** A member should be able to enter/edit
  the score of any game they're in. This is **not built yet** — there's no
  scores router; today's only scoring path is `events.setPlacements`
  (Organizer+). Captured here as the target permission for the scoring engine
  when it ships (member-scoped to games they belong to).
- **Add expense — any member.** Confirmed; matches `expenses.create`
  (`requireTripMember`).

### RLS parity audit (2026-06-07)
Compared every live write-policy (post-029) to the tRPC matrix above.

**Result:** RLS is **equal-or-looser** than the tRPC gates everywhere — never
*stricter* — so no tRPC-allowed action is blocked by RLS (no broken features),
and because **all writes go through tRPC** (correctly gated), there is no active
access hole. Most tables match exactly (member SELECT; member expense insert +
Owner split-edit; Owner idea-create / Organizer idea-edit; Organizer logistics /
schedule / news / tiles / competition; Owner competition+team delete; member
votes/reads).

Spots where RLS was *looser* than the tRPC intent — harmless today (tRPC is the
only write path) but tightened in **migration 030** so RLS is a true backstop:

| Table / cmd | Was | Now (migration 030) |
|-------------|-----|---------------------|
| `trip_members` INSERT/UPDATE | self **or** Owner+Organizer | self **or** Owner — matches Owner-only roster mgmt |
| `invites` INSERT | any trip member | Owner — matches `inviteByEmail` |
| `date_poll_votes` "_ghost" (vote for a guest) | Owner+Organizer | Owner — matches `castVoteForMember` |

**`trips` UPDATE left as Owner+Organizer (intentional).** Organizers
legitimately update most trip columns (rename, about, dates, change
destination); only `lockDestination` / `transferOwnership` are Owner-only, and
those are **column-level** distinctions row-level RLS can't express without a
trigger. tRPC enforces them — not worth a trigger for defense-in-depth here.

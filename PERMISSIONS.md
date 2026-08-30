# BuddyTrip — Permission Model

*Authoritative reference for which roles can perform which actions.*
*Enforced via `requireTripRole()` / `requireTripMember` middleware (tRPC,
`src/server/middleware.ts`), Supabase RLS policies, and frontend
`canEdit`/`isOwner` guards. The tRPC gates are the source of truth — this doc
mirrors them.*

*Last reconciled against the code: 2026-07-31 (see **Audit notes** at the end
for what changed and the open questions).*

*The **Owner/Organizer principle** below is the ratified INTENT (#770). Where the
code differs, the code is ground truth and the difference is enumerated as a
deviation — this doc no longer describes drift as though it were design.*

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
| **Owner** | `'Owner'` | Everything an Organizer can do, plus changing who is trusted, ending containers, and erasing others' content. |
| **Organizer** | `'Organizer'` | **Everything the Owner can do**, except the five exceptions in the principle below. |
| **Member** | `'Member'` | Participant. Views everything on the trip, votes, chats (crew), logs expenses + own travel. Cannot edit trip configuration. |

### The Owner/Organizer principle

> **An Organizer helps run the trip. Only the Owner changes who is trusted,
> ends a container, or erases everyone else's content.**

That is the whole rule. Everything else an Owner can do, an Organizer can do.

It yields exactly **five** exceptions:

| # | Exception | Procedure | Why |
|---|---|---|---|
| 1 | Creating or elevating Organizers | `tripMembers.updateRole` | the Owner declares who he trusts; a trusted party can't extend that trust |
| 2 | Deleting the trip | `trips.delete` | ends the top-level container |
| 3 | Transferring ownership | `trips.transferOwnership` | hands over the trust relationship itself |
| 4 | Deleting a competition | `competitions.delete` | ends a container **within** the trip — see below |
| 5 | Clearing a chat channel | `messages.clearChannel` | erases everyone's content inside a container that survives — see below |

**Why the rule says "a container" and not "the trip".** Exception 4 is the one
that generalises it. A competition is not a unit of work; it is a container that
teams, rosters, assignments and whole games live inside, and removing it cascades
across all of them (there is a `delete_competition_cascade` RPC precisely because
it is not a single-row delete). Ending something that other people's work lives
inside is the Owner's call, at any level of the tree — not only at the top.

**The test for a NEW object,** so this carries without anyone editing this file
again: ask whether deleting it *destroys a container other objects live in and
cascades to them*, or whether it removes *one unit of work*. A competition is
the former. A **game is the latter** — an Organizer may delete a game, reset its
scoring, and reset it to skeleton, even though those are destructive, because a
game is a thing the Organizer is there to run. Safety for destructive-but-
in-scope actions belongs in a **confirmation dialog, not a permission gate**
(all three such actions already have one).

**The SECOND reason, which the container test does not catch.** Exception 5
fails that test and is still Owner-only, so the distinguishing property is worth
stating on its own: `messages.clearChannel` doesn't *end* anything — the channel
keeps existing — it **erases everyone else's contributions inside it**. A game
reset destroys work too, but that work *is* the game, and the game is the one
unit the Organizer is there to run. Clearing chat destroys thirty people's
messages while the trip carries on around the hole. So there are two independent
Owner-only reasons, and a new procedure needs to clear both:

1. **Ending a container** others' work lives inside (exceptions 2, 4).
2. **Erasing others' content inside a container that survives** (exception 5).

Neither is "it's destructive" — destructiveness alone is a confirmation-dialog
problem. What makes these Owner-only is *whose* work is lost and whether the
thing it lived in is going with it. Note the asymmetry that decides ties: if an
Organizer genuinely needs to clear a channel mid-trip they can ask the Owner,
and the cost is one message; if an Organizer clears it and shouldn't have,
nothing brings it back. Being wrong in the restrictive direction is cheap.

Stated as a PRINCIPLE rather than a list of permitted actions on purpose: a list
has to be re-derived and re-checked every time a feature is added, and the
previous version of this section was a list (*"Edits trip details, dates, ideas,
lodging, agenda, competition, news, tiles"*) that had already drifted out of step
with the code. A principle tells you what to do for the NEXT procedure without
anyone updating this file.

**Applying it to new work:** gate on `requireTripRole("Organizer")` unless the
action is one of the five above, or trips either reason — it ends a container,
or it erases others' content. If you find yourself writing
`requireTripRole("Owner")` for anything else, that is a deviation from this rule
and needs a reason — not a shrug.

> **⚠️ The code now matches this principle except for ONE deviation.** #786
> reconciled 9 across both layers (migration 101 + the tRPC guards); the invite
> pair moved, was reverted twice (#790, #823), and landed on the third attempt;
> and the six-procedure `trip_members` cluster moved once **migration 122** built
> the role-column trigger that migrations 030 and 101 had only *named* — it had
> never actually existed. Migration 123 then scoped removal to Members and
> ghosts, and 124 fixed a cascade regression 123 shipped.
> **`ghostCrew.update` is the one that remains**, blocked by a hardcoded Owner
> check inside `link_guest_to_account()`, which is the only gate on a merge
> primitive `authenticated` can call directly via PostgREST. It is enumerated
> with its blocker in **Audit notes → Owner/Organizer deviations** at the end of
> this file. Until it is reconciled, the per-row matrix below
> reflects the CODE, which is ground truth; where a row says Owner-only and the
> principle says Organizer, the row is a known deviation, not a counter-example
> to the rule.

**Derived flags used in code:**
- `isOwner = viewerRole === 'Owner'`
- `canEdit = viewerRole === 'Owner' || viewerRole === 'Organizer'`

**Hierarchy & access notes:**
- `requireTripRole(min)` is **hierarchical**: Owner (3) ≥ Organizer (2) ≥ Member (1). So an Owner satisfies any Organizer-gated action; `requireTripRole("Organizer")` admits Owner **and** Organizer, not Members.
- **Non-members are fully blocked.** There is no "outsider" / guest read role — `requireTripMember` rejects anyone without a `trip_members` row (`FORBIDDEN`). Access is all-or-nothing membership.
- The **Organizers chat** is the one place "Organizer" is gated by message visibility (`visibility = 'planning'`) rather than the role check directly — same effect (Owner + Organizer only).
- **Team chat is the one surface where trip ROLE grants nothing at all.** Access is a `team_assignments` row for that specific team, and the hierarchy above does not apply: an Owner who is not on the team cannot read it, and neither can an Organizer or a game delegate. This is deliberate — a private room the people running the trip can read is not a private room — and it is enforced by `messages_select`'s team arm, which carries **no staff branch**. That arm predates `pickem_picks_select` (migration 001) and is the template to copy for any future no-staff-branch policy; every OTHER policy in this schema carries `has_trip_role(...) OR is_game_delegate(...)` as an unconditional escape hatch and is the wrong one to copy here. Pinned by `teamChatPolicy.rls.test.ts`, which drives PostgREST with real JWTs and was checked against both plausible wrong builds (a staff branch, and a policy that leaks across teams).

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
| Lock destination | ✓ | ✓ | — | `lockDestination` *(Organizer+, #786)* |
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
| Vote on behalf of a member | ✓ | ✓ | — | `datePoll.castVoteForMember` *(Organizer+, #786)* |

### Destination ideas — `ideas`, `ideaLodging`, `archivedIdeas`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View ideas | ✓ | ✓ | ✓ | `ideas.list` |
| Browse global idea catalog | ✓ | ✓ | ✓ | `ideas.catalogList` *(any authed)* |
| Vote on an idea | ✓ | ✓ | ✓ | `ideas.vote` |
| Add idea | ✓ | ✓ | — | `ideas.create` *(Organizer+, #786)* |
| Remove idea | ✓ | ✓ | — | `ideas.remove` *(Organizer+, #786)* |
| Edit idea details | ✓ | ✓ | — | `ideas.update` |
| Suggest / edit lodging options on an idea | ✓ | ✓ | ✓ | `ideaLodging.create` / `update` / `remove` *(member)* |
| Archive an idea to personal archive | ✓ | ✓ | — | `archivedIdeas.archive` *(Organizer+, #786)* |
| View / remove **own** archived ideas | ✓ | ✓ | ✓ | `archivedIdeas.list` / `remove` *(self, via RLS)* |

### Crew / roster — `tripMembers`, `ghostCrew`

Roster management **split in #786**, and the rows below reflect the code today.
Inviting is still Owner-only. The *rule* it should follow is settled and its DB
half has shipped — an Organizer may invite a **Member**, only the Owner may
invite an **Organizer** (migration 103) — but the tRPC guard cannot follow yet,
because both procedures write `trip_members` and that policy is Owner-only. See
the worked example in the audit notes. The rest of this block is
still Owner-only, and that is a **known deviation with a named blocker**, not a
second rule: widening `trip_members` writes at the RLS layer would let an
Organizer set any member's `role` via direct PostgREST, so it needs a
role-column trigger first (see *Audit notes → Owner/Organizer deviations*).
Only `updateRole` is legitimately Owner-only on principle (exception 1).

An earlier version of this paragraph justified the whole block ("the crew list
is the Owner's"), which read as a principle and competed with the actual one.

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View roster | ✓ | ✓ | ✓ | `tripMembers.list`, `checkEmail` |
| Add member | ✓ | ✓ | — | `tripMembers.add` *(Owner/Organizer; only the Owner may add someone AS an Organizer — mig 122)* |
| Invite by email / blast | ✓ | ✓ | — | `inviteByEmail`, `sendInvitationBlast` *(Owner/Organizer; only the Owner may invite someone AS an Organizer — the split is in the procedure, mirrored at the DB by mig 103)* |
| Promote/demote role | ✓ | — | — | `updateRole` *(Owner; not self)* |
| Rename (trip nickname) | ✓ | ✓ | — | `updateNickname` *(Owner/Organizer; not the Owner)* |
| Remove member | ✓ | ✓ | — | `remove` *(Owner/Organizer; not self. An Organizer may remove **Members and ghosts only** — removing an Owner or a fellow Organizer is Owner-only, enforced at the DB by mig 122/123, because removal is a stronger form of `updateRole`)* |
| Add / remove ghost (placeholder) crew | ✓ | ✓ | — | `ghostCrew.create` / `remove` *(Owner/Organizer; only the Owner may add one AS an Organizer)* |
| **Edit** ghost (placeholder) crew | ✓ | **—** | — | `ghostCrew.update` *(Owner — see the deviations note; `link_guest_to_account` checks Owner inside the function, and that check is the only gate on a merge primitive `authenticated` can call directly)* |
| Set **own** travel info | ✓ | ✓ | ✓ | `tripMembers.updateTravel` *(self)* |
| Set **another member's** travel info | ✓ | ✓ | — | `tripMembers.updateMemberTravel` *(Owner/Organizer)* |

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
| Edit a receipt's fields/splits | ✓ | — | **paid_by_user_id = self** | `updateSplits` *(Owner any receipt, or a Member editing one they paid for — same own-receipt exception as remove)* |
| Remove an expense | ✓ | ✓ | **paid_by_user_id = self** | `remove` *(Owner/Organizer any receipt, or a Member removing one they paid for — so a mistyped self-logged receipt isn't stuck waiting on staff)* |

### Competition — `competitions`, `teams`, `teamAssignments`

| Action | Owner | Organizer | Member | tRPC |
|--------|:-----:|:---------:|:------:|------|
| View competition / teams / leaderboard | ✓ | ✓ | ✓ | `*.list` / `getByTrip` |
| Create / edit competition | ✓ | ✓ | — | `competitions.create` / `update` |
| Delete competition | ✓ | — | — | `competitions.delete` *(Owner — CASCADE-deletes its games + all scores/results; gate is the **competition** owner via `requireCompetitionRole('owner')` + the RPC's `assert_competition_owner`, normally the same person as the trip Owner)* |
| Create a team | ✓ | ✓ | — | `teams.create` *(co-admin)* |
| **Edit team identity** (name / short / color) | ✓ | **—** | **captain of *that* team** | `teams.update` *(Owner or that team's captain — **not** a plain Organizer; mig 065)* |
| Delete a team | ✓ | — | — | `teams.delete` *(Owner)* |
| Assign member to a team | ✓ | ✓ | — | `teamAssignments.assign` |
| Remove a team assignment | ✓ | ✓ | — | `teamAssignments.remove` *(Organizer+, #786)* |
| **Reorder a team's roster** (canonical order) | ✓ | **—** | **captain of *that* team** | `teamAssignments.reorder` *(Owner or that team's captain — **not** a plain Organizer; same gate as `teams.update`; mig 094)* |
| Appoint / clear a team captain | ✓ | — | — | `teamAssignments.setCaptain` *(Owner)* |
| **Edit / configure a game** (status — pending/active/complete only, points distribution, course, participants) | ✓ | ✓ | **delegate of *that* game** | `games.update` / `setStatus` / `setPointsDistribution` / `applyCourse` / `addParticipants` |
| **Set what a game is worth** (`points_total`) | ✓ | ✓ | **delegate of *that* game** | `games.saveConfig` / `setPointsTotal` *(delegate tier since migration 158 — see the flag below)* |
| **Enter a game's results** (manual placement; finish/compute — every format) | ✓ | ✓ | **delegate of *that* game** | `games.setManualResults` / `finish` *(`finish` absorbed `games.post`; see the flag below)* |
| **RUN: open score correction** | ✓ | see flag | **delegate of *that* game** | `games.openCorrection` |
| Enter a per-hole score (until posted) | ✓ (any unit) | ✓ (any unit) | ✓ (any unit in *their* game) | `scores.upsertEntry` / `deleteEntry` — **scoped** (see below); **blocked** once the game is posted & not in correction |
| ↳ a plain **Member** | their own **unit** only | — | — | member scores only the match/group they play in; a non-participant scores nothing |
| Delegate / revoke a game organizer | ✓ | ✓ | — | `games.addOrganizer` / `removeOrganizer` *(trip staff only — a delegate can't sub-delegate)* |
| View who runs a game | ✓ | ✓ | ✓ | `games.listOrganizers` |

> **Score-entry is SCOPED (mig 072 — this SUPERSEDES the old "any member" rule).**
> Entering/clearing a per-hole score (`scores.upsertEntry`/`deleteEntry`) is gated
> to a three-tier model, enforced **server-side** (the tRPC guard `canWriteScore`
> **and** the `score_entries` write RLS via `can_score_unit()` — hiding the button
> is not enough, anyone can call the API directly):
> - **Owner / Organizer (comp owner/co-admin)** → any unit, any game (`canEditGame`).
> - **Delegate of *that* game** → any unit in that game (game-isolated).
> - **Member** → only the **unit they participate in**; a **non-participant** member
>   scores nothing.
>
> The "unit" is resolved per format from `game_matches` + `game_participants`
> (`src/lib/scoreUnit.ts::memberCanScoreUnit`, mirrored by the SQL `can_score_unit`):
> **stroke** = the individual player (own row only) · **1v1 match** = the match's
> two players · **rack** = the play_group (cart) · **2v2 match** = the match's two
> side groups. The UI reflects this: a unit you can't score taps through to the
> read-only **scorecard**, not a dead entry screen (owner/delegate keep entry).
>
> **Deferred (needs a data link that doesn't exist):** singles (1v1) matches imply
> a foursome (~2 matches per cart), but there's no `match ↔ foursome` link, so we
> can't yet let one cart-mate keep BOTH matches' cards. For now a 1v1 member scores
> **only their own match**. Building it needs a "which matches form a foursome"
> link; the unit check is already the clean boundary to widen.

> **Roster-removal lock once scoring starts (team-identity).** Once a competition
> has **any entered score** (`score_entries` exists for any of its games), its team
> rosters are **locked for REMOVALS** — `teamAssignments.remove`, a *move/trade*
> (`teamAssignments.assign` to a **different** team), and `teams.delete` all throw
> (`PRECONDITION_FAILED`). **Adding** a player to a team (`assign` with no prior
> membership) stays allowed — an add can't orphan anyone in an existing match.
> Before the first score, full roster editing per the role gates above. Enforced
> server-side (`assertRosterUnlocked`); the Rosters sheet disables the removal
> controls with an explanation (the add path stays live). Leaderboard standings are
> never gated — they stay visible to all roles. Mid-competition trades are parked in
> DEFERRED (durable per-score attribution); this lock is the BBMI-safe stance.

> **Team captain — IDENTITY plus roster ORDER (mig 064/065, extended by 094).**
> A team's captain (one per team, `team_assignments.is_captain`, even a plain
> trip Member) may, **for their own team only**:
>
> - edit its **IDENTITY** — name, short name, color (`teams.update`, mig 065); and
> - set its **roster ORDER** (`teamAssignments.reorder`, mig 094).
>
> Both are admitted by the same tRPC gate (`requireTeamIdentityEdit`, scoped to
> the specific `teamId`) and backed by matching RLS on `teams` and
> `team_assignments`. Both deliberately **drop Organizer** at the tRPC layer.
>
> **MEMBERSHIP stays OWNER-ONLY** — add/remove (`teamAssignments.assign` /
> `remove`) and appointing the captain itself (`setCaptain`; a captain can't
> sub-appoint). Captain-led *membership* management — a captain picking who is on
> the team — remains parked for the future captain's-draft feature.
>
> **Why order moved and membership didn't (mig 094).** Until 094 this doc grouped
> reorder with assign/remove/setCaptain as "roster/structure", owner-only. The
> line that actually matters is **membership vs display order**: assign, remove
> and setCaptain change *who is on a team* or *who holds the role*; reorder is
> validated as a strict permutation of the team's current members, so it can
> neither add, drop, nor move anyone — it only changes how an existing roster is
> *presented* in the assignment pickers. A captain who may already rename and
> recolour their team may also order it. (Reorder is also written as UPDATE-only,
> never an upsert, so it cannot create a row even if that validation regressed.)
>
> The client mirrors this exactly: `useCanEditTeam` resolves identity edit =
> Owner OR this-team's-captain, and the Edit Team modal splits its roster
> affordances — drag handles / ↑↓ gate on `canReorder` (owner **or** captain),
> while ★ captain, × remove and + Add player gate on `canManage` (owner only).
> Three tiers: owner (full), captain (identity + order; membership read-only),
> member (read-only).

> **Per-game delegation (Slice D1 §8).** Game edit/configure/enter-results
> resolves to **`canEdit || isGameDelegate(gameId)`** — trip Owner/Organizer, OR a
> user granted delegate of *that specific game* (`game_delegates` row). It is
> **game-isolated**: a pick'em delegate cannot touch the scramble. Enforced at BOTH
> layers — the `requireGameEdit` tRPC middleware and the `is_game_delegate(game)`
> RLS path on `games` (UPDATE) + `game_results` (migration 045, table/function
> renamed `game_organizers`→`game_delegates` / `is_game_organizer`→`is_game_delegate`
> in migration 061). Granting is a trip-staff act (`requireTripRole('Organizer')`).

> **`points_total` joined the delegate tier in migration 158, and this document
> was SILENT on it before that.** Not wrong — absent. The column appeared in no
> row of the matrix, and that silence is what let the code look like drift when
> it was in fact a decision: Slice D (#360) had deliberately put the total above
> the delegate tier, pinned by `games.d_addgame.test.ts` ("a delegate can
> distribute to the total but CANNOT change the total") and stated in that
> file's header as "owner sets the total; a game-delegate distributes within".
>
> **Why it was revisited.** The rationale was that the Owner sets the total
> because they understand which games are being played and how they should be
> weighted. That describes who *typically* does it, not who should be
> *permitted* to — the permission had been derived from the habit. Pick'em made
> it concrete: a delegate builds the slate, opens picks, locks them and enters
> results, and the total is a primary control on the settings page they own.
> Asking the Owner to change one number is the wrong shape for a role this
> document defines as an Owner scoped to one game. The sibling column had
> agreed all along — `points_distribution` was always in the delegate tier, so
> the split was the odd thing rather than the widening.
>
> **What did NOT move.** `delegates` keeps the staff gate: granting delegation
> is "changes who is trusted", so a delegate still cannot sub-delegate.
>
> **The failure mode that came with it, now fixed.** Both columns were gated
> *inside* `save_game_config`, a function the delegate is ADMITTED to by
> `assert_game_edit`. So their save SUCCEEDED, every other column persisted,
> and the gated one was dropped with no error — the page reports saved and the
> value is gone. That is worse than a refusal and is how the points gate went
> unnoticed for three months.
>
> **And it was not an oversight — it had a guardian.**
> `games.saveConfig.test.ts` pinned the silent ignore by name: *"a DELEGATE's
> own save leaves the delegate list untouched"*, with the comment "even claiming
> a different delegate, the non-Organizer branch must not apply it". So someone
> chose the behaviour once, and a test protected it from then on. The list it
> guards genuinely does need protecting; what nobody revisited was whether the
> caller should be TOLD. Worth knowing before reading a silent drop elsewhere as
> carelessness — a passing test is not evidence that the failure mode was
> considered, only that the outcome was.
>
> 158 widens `points_total` (removing one instance)
> and makes `delegates` REFUSE a change outright. An *unchanged* delegate set
> still passes, because a payload builder may include the key and refusing on
> presence would stop a delegate saving anything at all.
>
> **The client was stricter than this table, too.** The delegate picker was
> gated on `useGameEditAccess.isOwner` while `games.addOrganizer` /
> `removeOrganizer` are `requireTripRole('Organizer')` — so an Organizer could
> not see a control the server would have accepted, and the prop's own comment
> claimed it "matches the server gate". The prop is now `canDelegate`, fed by
> `canManageGame` (Owner or Organizer, delegates excluded — the same predicate
> the danger zone uses, not a new one).

> **Competition RUN-actions (Slice D Run/Post §5).** Opening score correction
> (`games.openCorrection`) is enforced server-side by `requireGameRunAction`.
> Finalizing a game — every format, including the non-golf placement post that
> used to have its own `games.post` procedure — runs behind `requireGameEdit`.
> Both gates resolve to the SAME predicate — `requireGameEdit` and
> `requireGameRunAction` are the same function with a different error string
> (identical parsing, identical `canEditGame`, identical `next()`), and
> `canEditGame` passes anyone at `co_admin` or above, which the trip→competition
> mapping grants every trip **Organizer**. So both are: **Owner, Organizer, or
> that game's delegate** — consistent with the Owner/Organizer principle at the
> top, since neither changes who is trusted nor ends a container. (An earlier
> version of this note claimed the RUN tier was narrower and excluded a plain
> Organizer. The code
> never did that, and #770 resolved it in the code's favour.) Finalizing is
> **re-runnable** (Open → Posted ⇄ Correcting), never a permanent lock-out. A
> posted game's scores are frozen (`scores.upsertEntry`/`deleteEntry` return
> FORBIDDEN) until the owner/delegate opens correction; results stay visible to
> everyone throughout.

> **WHO TYPED A SCORE IS A RECORD, NEVER A PERMISSION.**
> `score_entries.submitted_by` (and `match_hole_outcomes.submitted_by`) records
> who entered a number, for audit only. It is **never** read by a gate — not by
> a tRPC guard, not by an RLS policy, not in a `WHERE`. Verified: the column is
> only ever written (`scores.ts:107`, `matchOutcomes.ts:100`) and reassigned by
> the guest-merge function; migration 033 declares it inline as *"WHO typed it —
> audit only, never a gate."*
>
> **This is a deliberate product decision, not an oversight.** Anyone permitted
> to score a unit may enter scores for anyone in it — one person keeps the card
> for the group, which is how golf actually works. Gating on `submitted_by`
> would mean every player has their own phone out for every hole, which is
> precisely what we decided not to build. The permission question is always
> *"may this person score this UNIT?"* (the three-tier scoped model above) and
> never *"is this their own row?"*.
>
> The tell to watch for: a change that adds `submitted_by` to a policy, a guard,
> or a filter — usually proposed as tightening score integrity. Integrity here
> lives in the unit scope, which is already server-enforced at both layers.
> (Recorded here by the 2026-08-08 rules audit. It was a *permission* rule that
> lived only in `COMPETITION_ENGINE.md` — a document the repo's own audit marks
> stale — so it was one cleanup away from being lost.)

> **Per-hole scoring is member-facing and SCOPED** (`scores.upsertEntry`/
> `deleteEntry`, mig 072): a member enters scores for the match/group they play
> in; owner/organizer/delegate score more broadly. See the scoped-model note under
> the competition table above. (Non-golf placement scoring — `games.finish`'s
> manual arm / `setManualResults` — stays owner/organizer/delegate.)

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
| Read / send **Team** chat | only if on that team | only if on that team | only if on that team | `list` / `send` *(channel `team`; a `team_assignments` row for THAT team)* |
| Mark a room read | ✓ | ✓ | ✓ | `markRead` *(per ROOM: crew / planning / team+teamId; planning = Organizer+, team = that team's members)* |
| Clear a channel's messages | ✓ | — | — | `clearChannel` *(Owner — sanctioned exception 5, not a deviation)* |

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
- **Vote on behalf of member** — old doc said Organizer+; code was **Owner only**
  at the time of that audit (`castVoteForMember`). #786 moved it back to
  Organizer+, so the old doc's row is now the correct one again — kept here
  because this section records what the 2026-06-07 audit found, not current state.
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
- **Score entry — SHIPPED and scoped (mig 072).** The `scores` router
  (`upsertEntry`/`deleteEntry`) is live and SERVER-scoped: owner/organizer/
  delegate score broadly; a member scores only the match/group they play in; a
  non-participant scores nothing. This SUPERSEDED the earlier "intent: any member"
  target (which was intentionally tightened — anyone-scores-anything was a score-
  integrity risk at the real event). See the scoped-model note under the
  competition table.
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
| `invites` INSERT | any trip member | Owner (030) → Owner+Organizer (101) → **Owner+Organizer, but `role = 'Organizer'` is Owner-only** (103). The two layers now AGREE — 101's widening was too loose (it assumed the signup trigger creates the `trip_members` row; it does not, the invitee's own client does, via the self-insert arm), and 103 narrowed it to match the procedure's split. |
| `date_poll_votes` "_ghost" (vote for a guest) | Owner+Organizer | Owner (030) → **Owner+Organizer** (101) — still matches `castVoteForMember` |

**`trips` UPDATE left as Owner+Organizer (intentional).** Organizers
legitimately update most trip columns (rename, about, dates, change
destination); only `lockDestination` / `transferOwnership` are Owner-only, and
those are **column-level** distinctions row-level RLS can't express without a
trigger. tRPC enforces them — not worth a trigger for defense-in-depth here.

---

## Audit notes (2026-07-31) — Owner/Organizer deviations

#770 ratified the principle at the top of this file: **an Organizer can do
everything the Owner can, except elevating crew to Organizer and deleting the
trip.** The code predates that rule and does not match it yet. This section is
the enumerated gap — the rule is the intent, these are the exceptions to it, and
each is now a *deviation from a stated rule* rather than an open question.

### Conforming (the five sanctioned exceptions)

| Procedure | Exception |
|---|---|
| `tripMembers.updateRole` | 1 — creating/elevating Organizers |
| `trips.delete` | 2 — ends the top-level container |
| `trips.transferOwnership` | 3 — hands over the trust relationship |
| `competitions.delete` | 4 — ends a container *within* the trip |
| `messages.clearChannel` | 5 — erases others' content inside a surviving container |

`competitions.delete` is gated differently from the rest: it uses
`requireCompetitionRole("owner")` (the competition's own role model), not
`requireTripRole`. It is Owner-only at both layers (`competitions_delete` policy)
and **stays that way** — it was never among the deviations below.

`messages.clearChannel` **was** among the deviations and has been ruled a
sanctioned exception instead. It is the only exception justified by the second
Owner-only reason (erasing others' content) rather than the container test; see
the principle section.

**A correction to this file's own arithmetic.** Earlier versions of this section
said 21 deviations, then 20. Both were wrong: the enumerated table has always
listed **19**, and the headline number was never recounted after the table was
written. There are **23** `requireTripRole("Owner")` call sites in
`src/server/routers/` (not 24), of which 4 are sanctioned exceptions
(`updateRole`, `trips.delete`, `transferOwnership`, `clearChannel`) — leaving
19. `competitions.delete`, the fifth exception, is gated by
`requireCompetitionRole` and was never a call site here at all. Counts below are
from an enumeration, not a carried-forward figure.

### Reconciled — 9 of 19, in #786

Moved to `requireTripRole("Organizer")` with their backing RLS moved in the same
change (migration 101), so no layer disagrees:

| Area | Procedures | RLS that moved with them |
|---|---|---|
| Ideas | `ideas.create`, `ideas.remove`, `archivedIdeas.archive` | `ideas_insert`, `ideas_delete` (archive is self-scoped — none) |
| Trip state | `trips.lockDestination` | none — `trips_update` was already Owner+Organizer |
| Dates | `datePoll.castVoteForMember` | all four `date_poll_votes` policies |
| Competition | `teamAssignments.remove` | `team_assignments_delete` |
| Games (destructive) | `games.delete`, `games.resetScoring`, `games.resetToSkeleton` | `assert_game_owner()` (delete needed none — `games_write` was already Owner+Organizer) |

### Deviations — 1 remaining

The resolved rows are kept struck-through rather than deleted: what unblocked them
is the useful part, and #824 spent months being described as blocked by a trigger
that had never been built.

These are NOT drift. Each is a deviation from the ratified rule that a specific
gate prevents moving, and the blocker is the work, not the guard swap.

| Procedures | Blocked by |
|---|---|
| ~~`tripMembers.add`, `.remove`, `.updateNickname`, `.updateMemberTravel`, `ghostCrew.create`, `.remove`~~ | **RESOLVED — migration 122** built the `trip_members` role-column trigger that migrations 030 and 101 had only *named*. It had never existed; `pg_trigger` returned nothing for the table until then, and everything downstream reasoned about its behaviour rather than its existence. With the column defended, the policies widened to `is_trip_planner` and the six guards followed. Migration 123 then scoped removal: an Organizer may remove **Members and ghosts only**, because removal is a stronger form of `updateRole`. (124 fixed a regression 123 shipped — a trip DELETE cascades through `trip_members`, and an Organizer row then hit the Owner check after the Owner's own row had already gone.) |
| ~~`tripMembers.inviteByEmail`, `.sendInvitationBlast`~~ | **RESOLVED on the third attempt** (#788 → reverted #790 → #823 → reverted → landed). Two tangled problems, both now closed: *(a)* it **minted the role it was gated on** — fixed by the role-INPUT split in the procedure (the guard admits Organizers; the procedure refuses a non-Owner granting `Organizer`), mirrored at the DB by migration 103; *(b)* it **could not do its job as an Organizer** — its `trip_members` INSERT and `last_emailed_at` UPDATE were refused by the Owner-only policies, which migration 122 widened. Re-verified by probe before re-widening: both writes now succeed as an Organizer writing directly, with an `Organizer`-role insert still refused. `sendInvitationBlast` moved wholesale — it takes no role. |
| `ghostCrew.update` | **`link_guest_to_account()`** (migration 095) checks Owner **inside the function**, and that check is the only thing standing in front of it. The wrapper is `GRANT EXECUTE ... TO authenticated` **by design** — the core `merge_guest_to_real_user` is revoked from `authenticated` because it takes two arbitrary ids and moves one identity's entire history onto another ("an account-takeover primitive", migration 095). So the wrapper is reachable from a browser JWT, and widening tRPC alone half-opens it: editing a placeholder's name would work, pasting an email that matches an account would still fail at the database. **Verified by probe:** an Organizer calling `rpc(link_guest_to_account)` directly is refused by that check; calling the core is refused by the ACL; the Owner succeeds. Remove the check and the first becomes allowed — an Organizer could merge any placeholder on their trip into any account, moving `game_participants`, `score_entries`, `game_results`, `team_assignments` and the `game_matches` side JSONB. Migration 122's trigger does **not** cover this; it guards `trip_members.role`, and the merge moves everything else. **NOT a signup-path risk** — see the correction below. |
| `teamAssignments.setCaptain` | **NOT a deviation — decided, and this row previously said otherwise.** Appointing a captain is Owner-only by decision, recorded in the matrix above with its reasoning (captain is an *identity* tier; roster and structure stay Owner-only). This row used to end "that is a product call, not a code one", which kept the question open and got it re-asked at least three times. It is not open. The shared-assert concern (`assert_competition_owner` guarding both `set_team_captain` and `delete_competition_cascade`) is moot while `setCaptain` is not being widened. |

> **Correction, recorded because the earlier wording sent readers the wrong way.**
> This row used to say the Owner check sits in a merge path "which runs in the
> signup trigger". The **merge** runs in the signup trigger; the **wrapper does
> not**. `handle_new_user` calls `merge_guest_to_real_user` **directly** —
> verified against the deployed bodies, which show no reference to
> `link_guest_to_account` and no back-edge from the core. So the Owner check is
> unreachable from signup and changing this function carries **no signup risk**.
>
> The conclusion was right and the reason was wrong, in the direction that made
> this look scarier and less tractable than it is. The real reason to keep it is
> stronger: it is the sole gate on an account-merge primitive a browser JWT can
> call. If Organizers should ever link placeholders, the shape is **not**
> deleting the check — it is widening it to `is_trip_planner` **inside the
> wrapper**, where it still covers the PostgREST path. That is a decision about
> the trust boundary, not a cleanup.

**A procedure that takes a role as INPUT cannot be gated on role alone.** This is
the misjudgement that produced the #790 revert, stated precisely: "inviting crew
doesn't change who is trusted" is true for `role: "Member"` and false for the
default. Before widening any guard, check whether the procedure can *write* the
very role it is being gated on.

### Worked example — `inviteByEmail`, half-landed

The rule above is what the fix was built from. The shape is settled and the DB
half has shipped; the guard half is blocked. Both are worth having on file,
because the blocker is NOT the shape:

1. **The guard admits the wider role.** `requireTripRole("Organizer")`.
   ⛔ **Blocked** — see step 5.
2. **The procedure refuses the narrower act.** `role === "Organizer" &&
   ctx.tripRole !== "Owner"` → `FORBIDDEN`. Not `UNAUTHORIZED`: `authExpiry`
   treats a 401 as a dead session and hard-navigates to `/login`, logging
   someone out mid-invite (#689). The message names the rule, not the state
   (#809). ⛔ Blocked with step 1 (unreachable while the guard is Owner-only).
3. ✅ **RLS enforces the same split independently** — migration 103, shipped.
   This is the half that is easy to skip and mustn't be, and it stands on its
   own: the direct-PostgREST bypass is closed no matter what the guard does.
4. ✅ **The unsafe default is removed.** `.default("Organizer")` → `"Member"`.
   Dead from the UI (`CrewSearchInput` always passes `role`), so it only ever
   governed a direct API call — where the safe value belongs.
5. ⛔ **The procedure must be ABLE to do the job.** `inviteByEmail` INSERTs a
   `trip_members` row; `sendInvitationBlast` UPDATEs `last_emailed_at`. Both
   policies are Owner-only, so an Organizer passes the guard and is refused by
   the database. #823 tried steps 1–2 and CI caught it immediately.

   **The trap worth naming:** #796 made those writes `assertAffected`-checked,
   and "the silent-write bug is fixed" reads a lot like "the write works." It
   isn't. #796 changed a silent failure into a loud one — which is exactly what
   made #823 fail in CI rather than write nothing and report success, the way
   #788 did. A permission is not widenable until the write it performs is
   permitted, not merely audible.

**Why the tRPC check alone was never enough.** `inviteByEmail` is not the only
way its write is reached. It creates an `invites` row carrying `role`, and the
invitee's own browser later copies that role into `trip_members`
(`src/app/invite/page.tsx`), which RLS permits through the **self-insert arm** of
`trip_members_insert` (`user_id = auth.uid()::text` — no role predicate). So an
Organizer inserting an `invites` row *by direct PostgREST* could mint an
Organizer without ever calling the procedure.

Migration 101 had widened `invites_insert` to `is_trip_planner` on the reasoning
that accepting an invite "creates a `trip_members` row through the signup path,
not through this policy." **`handle_new_user()` does not create that row** — it
only sets `invites.accepted_at`. That correction is the whole reason migration
103 exists, and it is the concrete form of #720's rule: *a tRPC check is not a
policy.*

**A guard test proves the gate, not the write.** The parity suite asserts
not-FORBIDDEN, which says the caller was admitted — it cannot see a write that
the caller's RLS then refuses inside the mutation. When widening a guard,
enumerate the tables the procedure WRITES and confirm each policy moved, and
cross-reference `SILENT_WRITES_AUDIT.md`: an unchecked write listed there will
report a refusal as success.

**One client flag guarding two powers is the client-side equivalent, and it is a
PATTERN, not a coincidence — four instances found in one sweep (#789).** Whenever
the server splits two powers apart, look for the single client flag that was
guarding both; it will not fail loudly, it will just widen the wrong one.

| Flag | Moved | Stayed |
|---|---|---|
| `useGameEditAccess.isOwner` | the game Danger Zone → `canManageGame` | the delegation grant |
| `useCanEditTeam.isOwner` (TeamSheet roster) | add / remove → `canManageRoster` | the captain ★ |
| `TeamsPanel.canEdit` (board cards) | drag-to-trade / remove → `canManageRoster` | team create/delete, the captain ★ |
| `IdeaZonePanel.isOwner` | ideas + lock-destination → `canEdit` | crew add / remove / invite |

Two rules fell out of it. **A flag whose two consumers now disagree gets SPLIT,
never loosened** — loosening widens the power nobody reviewed, with no server
change to point at. And **a display string is not a permission**:
`GameIdentityHeader`'s `assignedLabel` reads `isOwner ? "you" : ownerName`, whose
no-delegate fallback *is* the trip Owner, so an Organizer must keep seeing the
owner's name. Flipping it with the rest makes the header lie.

**Three gates, not one.** The reconciliation had to move a tRPC guard, an RLS
policy, AND a hardcoded role check inside a plpgsql body — and the third kind is
invisible to a `pg_policies` sweep. Two were found this way (`assert_game_owner`,
`link_guest_to_account`); a third (`assert_competition_owner`) turned out to be
shared with a sanctioned exception. When auditing a permission boundary here,
grep the function bodies, not only the policies.

**Migration 030's parity principle still governs.** It aligned RLS to the tRPC
gates so the database mirrors the API; #786 kept that alignment and moved both
layers together. What changed is the reference point 030 took as given, not the
rule that the layers must agree.

**A client-affordance gap, deliberately left open.** These changes are the
permission layer only. The client still gates several of the moved actions on
`isOwner` — notably `useGameEditAccess.isOwner`, which guards `GameDangerZone` in
all three game hulls AND the delegation grant, so the two need splitting before
either moves. An Organizer is permitted by the server but not yet shown the
button. Tracked separately; nothing is broken by the gap, but the change is not
user-visible until it closes.


---

## Pick'em sheets — proxy entry (migration 163)

**Read follows write.** Whoever may enter a sheet for someone may read it. The
two are the same predicate — `_pickem_can_proxy_for` — used by both
`save_pickem_picks_for` and the proxy arm of `pickem_picks_select`, so they
cannot drift apart.

| Actor | Own sheet | Own team | Other team | Anyone |
|---|---|---|---|---|
| Participant | ✅ | — | — | — |
| **Team captain** | ✅ | ✅ | ❌ | — |
| Owner / Organizer / game delegate | ✅ | ✅ | ✅ | ✅ |

**Why this exists at all, and why it is not a "visibility" feature.**
`pickem_picks_write` requires `user_id = auth.uid()`, and a placeholder has no
`auth.uid()`. **A guest's sheet can only ever be written by someone else** — so
without proxy entry every placeholder scores home-team defaults. 15 guests
already hold picks; 97 sit on teams.

**The one hard boundary: a captain never reads the other team's sheets before
the reveal.** Same-team is not a threat — you are not competing with teammates,
and under confidence scoring diversifying does not help a sum. Cross-team is,
and it is the only refusal in this feature carrying real weight.

**Staff read any sheet, and that is a deliberate reversal.** Phase 0 refused it
on the grounds that the Owner holds the lock button. The counter: he also sets
the slate, the spreads, the multipliers and the results, so confidentiality from
him was theater — and its price was that nobody could enter for the placeholders.
The lever if it ever matters is that an Owner can remove a delegate or organizer.

**A plain participant's refusal is untouched**, and is now the load-bearing
guard: `pickemPicksPolicy.rls.test.ts` still turns exactly **6 red** when
`_pickem_can_proxy_for` is replaced with `SELECT true`.

**The captain tier is dormant.** Zero captains are set anywhere in the database;
`is_captain` is settable via an owner-only ★ in `TeamsPanel`. Captaincy is not
required to run a trip — this elevates something that already exists rather than
creating a dependency.

**Three gates, and this feature adds a fourth kind.** Beyond the tRPC guard, the
RLS policy and the hardcoded role check inside a plpgsql body, `pickem_picks`
now has a **definer helper referenced BY a policy**. Grep for
`_pickem_can_proxy_for` and you find both the write gate and the read arm; change
it and you move both. That is the intent — but it means the policy text alone no
longer tells you who can read a sheet.

**`entered_by` is not a permission, it is a receipt.** Every save stamps
`auth.uid()`; proxy is `entered_by <> user_id`. It is never a parameter, so it
cannot be forged even though the write core is executable by `authenticated`.

**Measured cost.** The proxy arm makes the board's 272-row read **7.8 ms → 47.2
ms** as `authenticated` (EXPLAIN ANALYZE, local stack). Acceptable at BBMI's
scale — 16 people × 16 games is that read. If it ever matters, the fix is to
hoist the arm into a set-returning `_pickem_proxy_targets(game_id)` evaluated
once per statement rather than once per row.

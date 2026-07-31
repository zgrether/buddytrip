# Push Notifications — trigger-site inventory & taxonomy

Companion to the registry (`src/lib/notificationTypes.ts`). The registry is the
code source of truth for the four **categories**; this doc is the source of truth
for which **write sites** may fan out to them, and how.

**Status: the `scores` category is WIRED (Phase 3).** One wire point —
`games.finish`, which covers all four formats — produces two notifications: "a
game is final" and, when it becomes true, "the cup is clinched". Everything else
in the table below is still unwired: `planning`, `invites` and `chat` are
untouched, every BATCH row is untouched (their coalescing is undesigned), and
every **NEVER** row is untouched and must stay that way.

That last one is enforced MECHANICALLY, not remembered:
`src/server/lib/pushCallSites.guard.test.ts` fails the build if any file outside
a short allowlist imports a send helper, and names the NEVER-marked routers
explicitly so the failure says which prohibition was breached. Adding a call site
means adding a line to that allowlist AND a row here — deliberately, not by an
import that slips through.

## Categories (registry — confirmed)

| Key | Label | Default | Covers | Excludes (load-bearing) |
|-----|-------|:-------:|--------|--------|
| `scores` | Scores & results | **ON** | game/round finalized (any format) · **cup clinched** | per-hole entry, pairing setup, any per-write mechanical event |
| `planning` | Trip planning | **ON** | dates locked · destination locked · itinerary changed | one push per field-edit (itinerary is BATCH) |
| `invites` | Invites & admin | **ON** | invited to a trip · added to a team · RSVP nudge | duplicating the existing invite email |
| `chat` | Chat messages | **OFF** | new messages, any channel | per-channel prefs — one global switch |

## Eligibility markings

Every candidate write site is one of:

- **ELIGIBLE** — a real milestone; safe to wire in Phase 3.
- **BATCH** — genuine but bursty; must be debounced/coalesced, never 1:1 per write.
- **NEVER** — high-frequency mechanical write. A permanent property of the event,
  not a Phase 3 judgment call. Wiring one of these is how you nuke your delivery
  reputation across 30 phones in an afternoon.

## Inventory

Volumes are per **BBMI-scale trip** (~30 people, ~4 days, competition-heavy);
"per day" = a live tournament day.

**`games.post` is gone** — it was a second finalize that existed only for non-golf
and has been merged into `games.finish` (one procedure, branching on
`result_strategy`). Two corrections to what this table used to say: there is now
ONE finalize row to wire, not two, and the old `post` volume estimate of ~5–15/day
was wrong — non-golf side events run ~1–5 per **trip**, so nothing about the
disappearance of that row raises the volume budget.

| Write site (tRPC) | What happened | Category | Eligibility | Est. volume |
|---|---|---|---|---|
| `scores.upsertEntry` | A hole score entered | `scores` | **NEVER** | ~540/day (30×18). Mechanical. Never wire. |
| `scores.deleteEntry` | A hole score cleared | `scores` | **NEVER** | churny corrections; mechanical |
| `games.finish` | Game/round finalized (EVERY format, incl. a non-golf result posted to the cup) | `scores` | **ELIGIBLE** | ~5–15/day golf + ~1–5/**trip** non-golf. **The natural Phase 3 first wire.** |
| `games.openCorrection` | Correction window opened | `scores` | BATCH | rare; only notify affected players |
| competition leaderboard → cup decided | **Cup clinched** | `scores` | **ELIGIBLE** | ~1–3/trip. **Highest-value push in the app** — "Manhattans clinched." |
| `matches.setPairings` / `assignPlayer` / `reorder` | Pairings/roster setup | `scores` | **NEVER** | setup-time mechanical churn |
| `matches.setHandicap` / `setPointValue` | Config tweak | `scores` | **NEVER** | mechanical |
| `datePoll.lockDateWindow` | Dates locked | `planning` | **ELIGIBLE** | ~1/trip |
| `datePoll.castDateVote` / `castVoteForMember` | A vote cast | `planning` | **NEVER** | ~hundreds during polling |
| `trips.lockDestination` | Destination locked | `planning` | **ELIGIBLE** | ~1/trip |
| `trips.changeDestination` | Destination changed | `planning` | **ELIGIBLE** | ~1–2/trip |
| `schedule.create` / `update` / `reorder` | Itinerary item changed | `planning` | **BATCH** | ~5–20 over trip life; bursty — coalesce |
| `logistics.confirm` / `create` / `update` | Lodging/transport changed | `planning` | **BATCH** | bursty; coalesce |
| `tripMembers.inviteByEmail` / `sendInvitationBlast` | Crew invited | `invites` | BATCH | ~30 at setup. **Already sends email** — decide push-vs-email, don't double. |
| `tripMembers.add` | Member joins | `invites` | **ELIGIBLE** | ~30/trip; notify existing crew sparingly |
| `teamAssignments.assign` | Added to a team | `invites` | BATCH | ~30/trip setup burst; coalesce per recipient |
| `tripMembers.updateTravel` / `updateMemberTravel` | RSVP / travel change | `invites` | **NEVER** (or heavily BATCH) | ~30–60 over trip life; low signal |
| `tripMembers.updateRole` | Role changed | `invites` | **ELIGIBLE** | rare; notify the affected user |
| `messages.send` (trip channel) | New chat message | `chat` | BATCH | hundreds/day live; coalesce hard. OFF by default. |
| `messages.send` (team channel) | New team-chat message | `chat` | BATCH | same |
| `news.create` | News posted | `planning` | **ELIGIBLE** | ~1–5/trip (see open question) |

## Open questions for Phase 3 (not blocking Phase 2)

1. **`news` category home.** Currently mapped to `planning`. A trip-wide
   announcement is arguably distinct from "dates locked." Recommendation: keep
   under `planning` for now (4 switches, not 5); split into its own key only if
   News proves noisy. Splitting later is free — adding a registry key needs no
   migration.
2. **`invites` vs. existing email.** Crew-invite + team-assignment already send
   email (`tripMembers.ts`). Wiring `invites` to push would double-notify.
   Decide per-event whether push **replaces** or **supplements** email.
3. **BATCH mechanics undESIGNED.** Every BATCH row needs a coalescing strategy
   (per-recipient debounce window) before it's wired — out of scope until Phase 3
   picks up chat/itinerary.

## What the `scores` wiring actually does (Phase 3, shipped)

One call site — `games.finish` — because there is now one finalize for every
format. `src/server/lib/gameFinishNotify.ts` owns it, and all the copy lives
together at the top of that file so it reads as a set.

| Notification | Audience | Trigger | Exactly-once via |
|---|---|---|---|
| Game is final (engine: match/rack/stroke) | the game's **participants** | `games.finish` | the `status` TRANSITION guard — a re-finish after a correction notifies nobody |
| Game is final (manual / non-golf) | the competition's **team assignees** | `games.finish` manual arm | same transition guard |
| **Cup clinched** | the competition's **team assignees** | derived after every finalize | conditional claim on `competitions.clinch_notified_team_id` (migration 099) |

**Golf and non-golf share one copy shape.** Both title as `Final: {game}` —
they are the same event to the person holding the phone. Only the AUDIENCE
differs. In particular there is no "Result posted" notification: that is the
exact phrasing for `scores.upsertEntry`, a NEVER-marked site, so on a lock
screen it would read as "someone entered a score" — the one notification this
category promises never to send.

**The body carries the RESULT, never a tap instruction.** `games.finish` has the
outcome in hand at send time, so spending the most valuable line on the lock
screen to say "tap to see" wastes it — everyone knows notifications are
tappable. No emoji, for the same reason: those characters carry the score.

```
Final: Saturday Singles              Final: Euchre night
Manhattans 2½ – Centurions 1½        1st Centurions · 2nd Manhattans

Final: Saturday Rack                 Manhattans clinched
Manhattans 24 – Centurions 18        Buddy Banks Memorial · 25½ – 20½
```

Three result shapes that must read as siblings (`formatResultSummary`): a
head-to-head **score line** for two sides with points (match play, rack), and a
**placement list** otherwise (non-golf, stroke, and any 3+ team format — points
ride along when the format has them, so a 3-team rack still reports the margin).
The clinch line drops team names deliberately: the title already says who.

Three rules that hold the volume down, and why each is what it is:

- **Engine games notify who PLAYED, not the whole cup.** ~4–8 people, so a person
  gets ~1–2 a day rather than one per game on the board. Cup-wide news is the
  clinch push's job, and the board is already live via the score-event broadcast.
- **The manual arm notifies the competition** because non-golf side events are
  team-scoped and have NO individual roster — `game_participants` isn't populated
  for them, so "the participants" isn't a resolvable audience. They're also rare
  (~1–5 per trip), so the wider audience stays cheap.
- **The actor is always excluded.** Nobody is notified about their own action, and
  it's a parameter of the fan-out helper rather than each call site's job to
  remember.

Cup clinch is DERIVED, never stored — `pointsToClinch <= 0`, the same predicate
the board pill and `GamePageHeader` use. Only the *announcement* is recorded, so
an un-clinch needs no migration: the same team re-clinching sends nothing, a
different team clinching does.

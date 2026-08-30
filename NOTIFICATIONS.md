# Push Notifications — trigger-site inventory & taxonomy

Companion to the registry (`src/lib/notificationTypes.ts`). The registry is the
code source of truth for the four **categories**; this doc is the source of truth
for which **write sites** may fan out to them, and how.

**Status: `game_results` and `chat` are WIRED.** `games.finish` (all four
formats) produces "a game is final" and, when it becomes true, "the cup is
clinched". `messages.send` produces a chat notification on
**every message**, suppressed only for the sender and for anyone whose chat
panel is open — see the chat section, and note that this REVERSES the
coalescing design this doc originally prescribed.
`planning` and `invites` remain untouched (issue #854), the remaining BATCH rows
remain untouched, and every **NEVER** row is untouched and must stay that way.

**Only categories with a SENDER are EXPOSED in settings** — `game_results` and
`chat` today.
Settings live in a single place — profile → Preferences → **Notifications**, a
ROW THAT OPENS A MODAL, like name / email / password. Inside it a parent
activation control sits above the category checkboxes; the category list renders
only when the device is subscribed, because muting a category without a
subscription changes nothing. The chat header bell was removed — one stored value
with two entry points meant a user who muted from the bell had no way to know
settings governed the same thing.

**The modal replaced a row with two tap targets, and the shape was the bug.**
Tapping the row toggled the device; a small chevron beside it revealed the
categories. Nobody taps a chevron, so nobody found the categories — and the
discoverable target was the destructive one. That defeated the reason the
category row was required to ship alongside the chat sender at all: someone
opens preferences to turn chat off, finds no such control, concludes it does not
exist, and mutes the app at the OS level. **The outcome this subsystem exists to
prevent was reachable through the shape of the control, with every underlying
piece working correctly.**

**Activation is NOT derived from the categories**, and must not be. Push needs an
OS permission prompt, the prompt needs a user gesture, and it can be refused
permanently — so "check a box and it turns on" ends at a checked box with no
notifications behind it. The parent control is also the only place the two
non-control states can live: `blocked` and `unsupported` are EXPLANATIONS, not
switches, and `blocked` is the one most needed (a person who dismissed the
prompt months ago has no other way to learn why nothing arrives, and nothing in
the app can fix it). The server-side half of the same rule: muting every category
leaves the device SUBSCRIBED — dropping the subscription would make re-enabling
depend on a prompt the browser may never show again.

That last one is enforced MECHANICALLY, not remembered:
`src/server/lib/pushCallSites.guard.test.ts` fails the build if any file outside
a short allowlist imports a send helper, and names the NEVER-marked routers
explicitly so the failure says which prohibition was breached. Adding a call site
means adding a line to that allowlist AND a row here — deliberately, not by an
import that slips through.

## Categories (registry — confirmed)

| Key | Label | Default | Exposed? | Covers | Excludes (load-bearing) |
|-----|-------|:-------:|:--------:|--------|--------|
| `game_results` | Competition & game alerts | **ON** | **yes** | game/round finalized (any format) · **cup clinched** | per-hole entry, pairing setup, any per-write mechanical event |
| `planning` | Trip planning | **ON** | no | dates locked · destination locked · itinerary changed | one push per field-edit (itinerary is BATCH) |
| `invites` | Invites & admin | **ON** | no | invited to a trip · added to a team · RSVP nudge | duplicating the existing invite email |
| `chat` | Chat messages | **ON** | **yes** | new messages, any trip channel (1:1, not coalesced) | per-channel prefs — one global switch; team chat (no viewing state, no UI) |

### `game_results` was called `scores`, and the rename was a bug fix

"Scores" read as *every score entered* — precisely what this category must never
send. `scores.upsertEntry` / `deleteEntry` are NEVER-marked (~540/day), and the
category name was the most likely thing to talk someone into wiring one. What it
actually sends is a game finishing and the cup clinching. No stored row ever held
the old key (0 of 88 production users), so no migration was needed.

### EVERY category defaults ON — and that is deliberate

The **device toggle is the consent gate**. Enabling notifications is the
deliberate act, and the category list shown at that moment is a menu of what you
can *mute*, not a set of switches to hunt for and turn on. A category defaulting
OFF means someone enables notifications and then receives nothing, which reads as
broken rather than as respectful. `chat` was flipped from OFF to match.

### `planning` and `invites` are UNEXPOSED ON PURPOSE, not abandoned

**Do not delete these registry entries when tidying.** They render no row in
settings because neither has a wired sender, and a control that mutes nothing is
worse than an absent one. But both have real triggers already built and waiting:
`datePoll.lockDateWindow`, `trips.lockDestination`, `trips.changeDestination`,
and the invite mutations — all live procedures with live UI.

This is written down because the next person tidying the registry finds two
entries nobody renders and reasonably concludes they are dead. They are not. An
audit in Aug 2026 corrected exactly that wrong premise once already; the finding
should not have to be re-derived. Wiring them is tracked as its own issue.

### News must NOT inherit `chat`'s category

News has its **own category** — `news`, wired. Not `chat`, and not
`planning` — which is where this doc filed `news.create` until Aug 2026, and
which the shipped UI contradicts: News is a segment of the *chat* surface
(Crew · Organizers · News).

The reason is the default, not the taxonomy. Chat is hundreds/day. News is ~1–5
per trip, organizer-authored, and high-signal. Folding News into `chat` means it
is muted by anyone who mutes the firehose — so the highest-signal non-scoring
notification in the app would reach nobody who had not opted into the noisiest
thing in it. That outcome would be produced entirely by a categorisation choice.

## Eligibility markings

Every candidate write site is one of:

- **ELIGIBLE** — a real milestone; safe to wire in Phase 3.
- **BATCH** — genuine but bursty; must be debounced/coalesced, never 1:1 per write.
  **A marking is a hypothesis, not a verdict.** `chat` carried BATCH from this
  doc's first draft and it was wrong; the cost of finding out was three shipped
  designs. Before building coalescing for a new row, check whether the volume it
  predicts is real, and whether the OS and a category switch already solve it.
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
| `scores.upsertEntry` | A hole score entered | `game_results` | **NEVER** | ~540/day (30×18). Mechanical. Never wire. |
| `scores.deleteEntry` | A hole score cleared | `game_results` | **NEVER** | churny corrections; mechanical |
| `games.finish` | Game/round finalized (EVERY format, incl. a non-golf result posted to the cup) | `game_results` | **ELIGIBLE** | ~5–15/day golf + ~1–5/**trip** non-golf. **The natural Phase 3 first wire.** |
| `games.openCorrection` | Correction window opened | `game_results` | BATCH | rare; only notify affected players |
| competition leaderboard → cup decided | **Cup clinched** | `game_results` | **ELIGIBLE** | ~1–3/trip. **Highest-value push in the app** — "Manhattans clinched." |
| `matches.setPairings` / `assignPlayer` / `reorder` | Pairings/roster setup | `game_results` | **NEVER** | setup-time mechanical churn |
| `matches.setHandicap` / `setPointValue` | Config tweak | `game_results` | **NEVER** | mechanical |
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
| `messages.send` (trip channel: Crew + Organizers) | New chat message | `chat` | **~~BATCH~~ 1:1 — WIRED** | **NOT coalesced.** One push per message per recipient, minus the sender and anyone viewing that channel. The BATCH marking was wrong and is struck rather than deleted — see "The reversal" below for what it cost. |
| `messages.send` (team channel) | New team-chat message | `chat` | **1:1 — WIRED** | Same gate as the trip channel: not your own, not while you are looking. The AUDIENCE differs and is the only part that does — it comes from `team_assignments`, not from trip role, so an Owner not on the team is not in it. Volume is a fraction of Crew's (a team is half a trip, and only its own members). |
| `news.create` | News posted | **its own category** (NOT `chat`, NOT `planning`) | **1:1 — WIRED** | ~1–5/trip. See the News note above — folding it into `chat` mutes it for anyone who mutes the firehose. Every trip member except the author; no read-state/BATCH gate (see `newsNotify.ts` — News has no `viewing_at`, and the volume that made chat's gate worth building doesn't exist here). |
| `news.resend` | Owner/Organizer manually re-fires a post's `news` push | same `news` category | **1:1 — WIRED** | The retroactive half: `create`'s notify only fires on the create transition, so a post from before this category existed (or one someone missed) has nothing to re-send it. "Notify everyone" in the post's ⋯ menu. Excludes the post's ORIGINAL author, not the caller. |

## Open questions for Phase 3 (not blocking Phase 2)

1. ~~**`news` category home.**~~ **RESOLVED — News gets its OWN key**, not
   `planning`. This item said the opposite ("keep under `planning` for now") and
   was left standing after the **"News must NOT inherit `chat`'s category"**
   section above corrected it in Aug 2026, so this doc contradicted itself and
   the contradiction sat in the list a reader is most likely to ACT on. Struck
   rather than deleted: an open-questions list is read as live work, and the
   next person to reach it should see that the question was answered, not find
   it silently missing. **The lesson is the placement, not the answer** — when a
   question gets resolved in prose elsewhere in the same document, strike it
   here in the same edit, or the stale version is the one that gets built.
2. **`invites` vs. existing email.** Crew-invite + team-assignment already send
   email (`tripMembers.ts`). Wiring `invites` to push would double-notify.
   Decide per-event whether push **replaces** or **supplements** email.
3. **BATCH mechanics — designed for CHAT ONLY.** Chat's gate is built and
   documented below. It does **not** generalise, deliberately: it is free because
   `chat_reads` already exists, and the remaining BATCH rows
   (`games.openCorrection`, the itinerary/logistics batch,
   `teamAssignments.assign`, the invite blast) have no equivalent read-state. Each
   still needs its own strategy, and lifting chat's into a shared coalescer would
   mean inventing per-recipient state and a scheduler for them anyway. The next
   BATCH trigger pays for its own mechanism.

## What the `game_results` wiring actually does (Phase 3, shipped)

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
ride along when the format has them). Ties never repeat an ordinal — tied
competitors share one slot (`2nd A & B`), and a tie covering the whole field
drops ordinals entirely (`Tied: A & B`, or `3-way tie: A, B & C`, which leads
with the count so a truncated line still says what happened). Stroke is capped
at the top two plus `+N`, and deliberately does not express ties below first.
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

## What the `chat` wiring actually does (and why it is NOT a BATCH row)

One call site — `messages.send`, trip channel only.
`src/server/lib/chatNotify.ts` owns it.

| | |
|---|---|
| **Audience** | the CHANNEL's membership, not the trip's — Crew is every member, Organizers is Owner + Organizer (mirroring `is_trip_planner()`), minus the sender |
| **Coalescing** | **none** — one push per message per recipient |
| **Suppressed** | the sender; anyone whose panel for that channel is open (`viewing_at` within 40s) |
| **Payload** | trip title, channel, sender name. **Never the message text** |
| **Link** | `/trips/{id}` — the trip, not a chat deep link |

### The gate

**Notify every recipient, except: they sent it, or their chat panel is open.**

That is the whole rule. Two suppressions, each statable in one sentence. If a
third ever seems necessary, it needs the same test.

- **Actor exclusion** — `sendPushToUsers` takes `excludeUserId` as a first-class
  parameter rather than leaving each call site to filter, because eventually one
  wouldn't.
- **Viewing suppression** — a recipient whose `chat_reads.viewing_at` moved
  within `CHAT_ACTIVE_VIEWING_WINDOW_MS` (40s) is skipped. An open, visible panel
  re-stamps it every `CHAT_VIEW_HEARTBEAT_MS` (15s). The two constants are a pair
  and live in one file (`src/lib/chatViewHeartbeat.ts`); the window must stay
  comfortably wider than the beat so a dropped beat doesn't buzz someone who is
  looking at the screen.

**Chat-in-focus, not app-in-focus.** Someone on the leaderboard with chat closed
gets notified. Only the panel being open suppresses.

### The reversal — what was here before, and what it measured

This section used to describe a **read-state gate** (notify only someone who was
caught up before the message landed) plus a **30-minute time-based re-arm**. It
was built because this doc marked `chat` as BATCH — *"hundreds/day; coalesce
hard"* — and the fear was notification fatigue.

**The fear was the wrong problem, and the measurement is what settles it.**

With the full design shipped, one real day on the BBMI trip produced:

| measured, 2026-08-25 | |
|---|---|
| crew messages sent | **26** |
| notification events, four hours | **2** |
| what 1:1 would have produced | 26 × ~14 recipients ≈ **360 pushes** |

An app that tells you twice in an afternoon that a conversation is happening has
not been restrained; it has failed at the one thing a message notification is
for. **The 360 number is recorded here precisely so nobody re-derives "coalesce
hard" from first principles later** — that trade was seen and rejected
deliberately.

The asymmetry is what decides it: a person who finds chat noisy has a control —
the OS mutes any app, and the `chat` switch in the notifications modal is one
tap. **A person who gets two notifications a day has nothing to fix.**

### What went, and why it went rather than being tuned

- **The 30-minute re-arm** (`CHAT_REARM_AFTER_MS`) — deleted. Not made smaller: a
  re-arm at any value is a rule that a message may go unannounced, and the rule
  itself was the defect.
- **The caught-up / behind read-state gate** — deleted, along with the
  predecessor-message lookup and the `resolveLastSeen` fallback chain that
  existed only to answer it.
- **`chat_reads.last_notified_at`** (migration 144) — no longer written. Dropped
  in a follow-up migration; code stops writing before schema drops, per
  CLAUDE.md's removal ordering.

### The column split, which is the durable part

The surviving clause still needs a recency-of-looking signal, and it now has its
own column: **`chat_reads.viewing_at`** (migration 145), written only by the
client heartbeat.

`last_read_at` goes back to meaning exactly one thing — the read position behind
the unread badge and the new-messages divider.

**This is not tidiness. It makes two of this subsystem's three historical bugs
unrepresentable rather than merely prevented:**

| bug | why it can no longer happen |
|---|---|
| the heartbeat marked messages READ that the device never received | the heartbeat does not write that column |
| the notify stamp cleared the badge for the message it was announcing | the push path writes nothing to `chat_reads` at all |

The third — a glance-and-close buying minutes of silence — is now bounded by the
40s window instead of 150s, and is the only one still governed by a value rather
than by the schema.

### Realtime Presence was evaluated and rejected

The obvious way to know whether a panel is open is to ask Realtime who is
subscribed. Three reasons it is not used, in increasing order of weight:

1. **Not queryable server-side.** Presence reaches clients only as
   `presence_state`/`presence_diff` on a *joined* channel; there is no REST read.
   `messages.send` would open a websocket, join, await sync and leave — per
   message, inside a mutation the caller awaits. (#1013 is corroboration: CI
   skips the broadcast contract tests because Realtime never answers the join.)
2. **Subscription is not viewing.** `useRealtimeChat` is mounted in `AppShell`
   for the whole trip page, so raw subscription means *app*-in-focus — the thing
   §4 of this design explicitly rejects. It would need explicit `track()`/
   `untrack()`, which swaps a heartbeat for presence plumbing rather than
   removing machinery.
3. **It tracks socket liveness, not attention.** A pocketed phone stays
   "present" until Phoenix's reaper notices — a false present is a *silently
   dropped notification*, on a schedule we do not control. That is the failure
   being eliminated, reintroduced with a less predictable duration than the
   window it would replace.

### No message content, structurally

`buildChatPayload` has no text parameter and `ChatNotifyInput` has no text
field, so `messages.send` cannot pass the message even though it has it in hand.
A test asserting "the payload does not contain the text" proves it for the one
string the test chose; a notifier that never RECEIVES the text cannot leak any of
them. `pushCallSites.guard.test.ts` pins both halves — the notifier must not
SELECT the column and the input type must not carry it — and both halves were
control-tested to confirm they go red when breached. Same rule one layer down:
`push_send_log` is ids and counts (migration 105), never content.

### The category row shipped in the same commit as the sender

Every category defaults ON, because the device toggle is the consent gate and
the list shown at that moment is a menu of what to MUTE. So a sender wired while
its category is unexposed does not mean "on by default and easy to find" — it
means every subscribed user receives it with **no way to stop** short of
revoking notifications at the OS level. That is reachable by shipping two
correct commits in the wrong order, which is why `EXPOSED_CATEGORIES` gained
`chat` in the same change as the wire point.

## Quiet hours are the OS's job — do not build them here

Filed as an issue during the chat build (#1053) and closed as wontfix the same
day. Written down because "there is no quiet-hours mechanism" is true, sounds
like a gap, and will be re-derived by the next person who looks.

**Both platforms already enforce it for web push, and we cannot override them.**
An installed iOS PWA appears as its own app in Settings, so Focus / Sleep Focus /
Do Not Disturb / Scheduled Summary apply to it; Android's Chrome web push goes
through the system notification manager, so DND and Bedtime mode apply. Web push
has no critical-alert equivalent (that needs native entitlements), and the send
helpers pass no urgency, TTL, priority or `requireInteraction` — only the
subscription and a JSON body. There is no version of this we could bypass.

**The decisive asymmetry: server-side suppression DESTROYS a notification, OS
DND DEFERS it.** Suppress at 2am and the message is never surfaced at all;
silence it at the OS and it is sitting in the tray at 7am. So a server-side
implementation would not merely duplicate a control the user already has — it
would be a strictly worse one, and it would need a timezone column to guess at
what the device knows natively.

**And chat's read-state gate already did the job this was really about.** A
night of chat is ONE push per caught-up recipient, not a barrage — the same
exposure as a text message.

**The general rule, which is the part worth keeping:** an absent mechanism is
only a gap if the layer below is not already providing it. For anything that
ends up in a phone's notification tray, the OS is that layer, and it is better
positioned than we are — it knows the timezone, it follows travel, and the user
has usually already configured it.

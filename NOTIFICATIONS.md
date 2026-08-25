# Push Notifications — trigger-site inventory & taxonomy

Companion to the registry (`src/lib/notificationTypes.ts`). The registry is the
code source of truth for the four **categories**; this doc is the source of truth
for which **write sites** may fan out to them, and how.

**Status: `game_results` and `chat` are WIRED.** `games.finish` (all four
formats) produces "a game is final" and, when it becomes true, "the cup is
clinched". `messages.send` produces a **read-state-gated** chat notification —
the first BATCH row to be wired, and the only one whose coalescing is designed.
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
| `chat` | Chat messages | **ON** | **yes** | new messages, any trip channel (read-state-gated) | per-channel prefs — one global switch; team chat (no read state, no UI) |

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

When News gets a sender it gets **its own category**. Not `chat`, and not
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
| `messages.send` (trip channel: Crew + Organizers) | New chat message | `chat` | **BATCH — WIRED** | hundreds/day live, coalesced to **one per recipient per read-session**. See the chat section below. |
| `messages.send` (team channel) | New team-chat message | `chat` | BATCH — **not wired, structurally** | `chat_reads` has no team dimension, so there is no read state to gate on; team chat also has no UI. Needs read tracking first. |
| `news.create` | News posted | **its own category** (NOT `chat`, NOT `planning`) | **ELIGIBLE** | ~1–5/trip. See the News note above — folding it into `chat` mutes it for anyone who mutes the firehose. |

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

## What the `chat` wiring actually does (the first BATCH row)

One call site — `messages.send`, trip channel only.
`src/server/lib/chatNotify.ts` owns it.

| | |
|---|---|
| **Audience** | the CHANNEL's membership, not the trip's — Crew is every member, Organizers is Owner + Organizer (mirroring `is_trip_planner()`), minus the sender |
| **Coalescing** | read-state-gated; ceiling is **one push per recipient per read-session** |
| **Payload** | trip title, channel, sender name. **Never the message text** |
| **Link** | `/trips/{id}` — the trip, not a chat deep link |

### The gate

A recipient is notified only when they were **caught up before this message
arrived**:

```
R is caught up  ->  a message lands   ->  ONE push
more messages, R still hasn't looked  ->  R is now behind -> SILENCE
R opens chat    ->  markRead advances ->  RE-ARMED for the next lull
R never opens it, 30 min pass         ->  RE-ARMED anyway -> ONE push
```

A burst of ten messages to sixteen people is sixteen pushes, not a hundred and
sixty.

### Reading alone was too strict, and production said so within a morning

The gate originally had ONE re-arm: reading. That assumes people open the chat
between bursts, and most will not — on a four-day trip it means one push on day
one and silence for the rest of the week.

Measured, not feared. From `push_send_log`, the first morning it was live: **of
14 chat sends, 3 delivered and 11 were gate-suppressed**, and the three that got
through all landed in the first 35 minutes, before everyone had fallen behind.
Zero delivery failures, zero dead endpoints, zero preference skips — the push
machinery was fine and the gate was turning everyone away.

So **being behind now EXPIRES**: if nothing has been SENT to a recipient for
`CHAT_REARM_AFTER_MS` (30 min), the next message reaches them even though they
never caught up. Someone who never opens chat still hears about the dinner plan.

The ceiling is still low, and the honest way to state it is the worst case: a
person who never opens chat, in a trip where conversation never stops, gets at
most one push per window — about 32 across a 16-hour day, against the ~500 an
ungated wiring would send. The realistic case is far lower, because a push that
gets read re-arms via the READ rule and the next message is a single push.

This needed the one piece of state the app was not already keeping —
`chat_reads.last_notified_at` (migration 144). Same row, same grain, written by
the send path and never by `markRead`: **being notified is not having read**, and
folding them together would mark messages read that nobody has seen.

**Per-RECIPIENT, not per-conversation, and that is the whole choice.** A
conversation-level silence gate ("first message after N minutes of quiet") fires
at the START of a conversation and goes quiet through the middle — which is when
you would actually want to know. Per-recipient fires when *you* fell behind.

**No migration, no scheduler, no new state.** `chat_reads` (migration 010)
already stores `last_read_at` per (trip, user, visibility) for the unread badge
and the new-messages divider. The gate is a comparison between two timestamps
the app was already keeping. There is still no scheduler anywhere in this
codebase, and this did not add the first one.

### Two clauses that are not optional

**The viewing window** (`CHAT_ACTIVE_VIEWING_WINDOW_MS`, 2.5 min) is what
implements "don't notify someone with the chat open" — the caught-up test alone
would push them, because the send runs server-side before their client has even
received the realtime insert, so at decision time a viewer looks exactly like
someone up to date and away. It is paired with a **client heartbeat**
(`CHAT_VIEW_HEARTBEAT_MS`, 1 min, in `FloatingChatPanel`, gated on tab
visibility): `markRead` normally only advances when a message arrives, so
without the heartbeat an open panel left through a lull would buzz at a message
appearing on screen in front of the person. Both constants live together in
`src/lib/chatViewHeartbeat.ts` and their relationship is pinned by a test.

The window was **5 minutes and that was too wide**. It only has to be wide
enough that an open panel is always inside it; every second beyond that is a
second in which someone who CLOSED the app is mistaken for someone staring at
the screen. Production showed the cost directly — a message 17 seconds after a
recipient closed the chat was suppressed as "watching", so reading bought five
minutes of silence afterwards. Now sized off the heartbeat: two beats plus
grace.

**The read-position fallback** (`resolveLastSeen`) is
`chat_reads.last_read_at` -> the member's channel visibility floor
(`chat_visible_from` / `planning_visible_from`) -> `joined_at`.

> This one was a real bug, caught by the burst test rather than by review.
> The first version treated a missing `chat_reads` row as "caught up", which
> reads as harmless — give them one, then let the normal rule take over. **There
> is no normal rule to take over.** With no read position, nothing ever moves
> them into `behind`, so they are caught up on message 1 and on message 400
> alike: a member who never opens chat would be notified for **every message in
> the trip**. The burst test read 10 of 10 notified. Each fallback is a real
> answer to "how far have you seen" rather than a stand-in, which is why the
> chain converges on the intended behaviour instead of approximating it. The
> gate's own null branch is now a fail-closed backstop, because the two defaults
> are not symmetric: silence costs one missed notification, "caught up" costs a
> push per message forever.

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

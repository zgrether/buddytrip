# Notification category audit

**Date:** 2026-08-08 · **Status:** Phase 0 — findings only, no build
**Question:** do the four notification categories describe the app that exists?

Written because `NOTIFICATIONS.md` predates several workflow changes and reads as
authoritative. This is the same shape as `PERMISSIONS.md` describing a captain
role the code never had, and `CLAUDE.md` #21 recording an unfinished slug removal
as intentional design: a document that is believed because it is confident.

The four lists below are gathered independently. **Where they disagree is the
finding.**

---

## List 1 — what production actually stores

Queried against prod (`nezhuwyfirrbmyojpiyx`), `public.users.notification_prefs`.

| | count |
|---|---|
| users total | 88 (77 guests, 11 real) |
| `notification_prefs IS NULL` | 0 |
| `notification_prefs = '{}'` | 86 |
| non-empty | **2** |

Every key ever stored, across the whole table:

| key | value | users |
|---|---|---|
| `chat` | `true` | 2 |

**`scores`, `planning` and `invites` have never been written by anyone.**

Two readings, and the distinction matters: a key nobody has set is not a key
everyone has turned off. Sparse storage is by design — `isTypeEnabled` falls back
to the registry default, so `{}` means "hasn't chosen", not "off". The `scores`
control only shipped in #853, so its zero is expected and carries no signal.

The `chat: true` rows are the interesting ones. They were set through the chat
header bell — the only category control that existed before #853.

---

## List 2 — what the registry defines

`src/lib/notificationTypes.ts`, the declared single source of truth for the send
filter, the UI, and the call sites.

| key | label | default | notes |
|---|---|---|---|
| `scores` | Scores & results | **ON** | `excludes` names the ~540/day `upsertEntry` firehose |
| `planning` | Trip planning | **ON** | itinerary changes marked BATCH |
| `invites` | Invites & admin | **ON** | "does not duplicate the existing crew-invite EMAIL" |
| `chat` | Chat messages | **OFF** | one global switch; OFF because of volume |

---

## List 3 — what `NOTIFICATIONS.md` claims

Four categories, and an inventory of ~20 write sites marked ELIGIBLE / BATCH /
NEVER. Its ELIGIBLE rows, by category:

- **`scores`** — `games.finish`; cup clinched
- **`planning`** — `datePoll.lockDateWindow`; `trips.lockDestination`;
  `trips.changeDestination`; **`news.create`**
- **`invites`** — `tripMembers.add`; `tripMembers.updateRole`
- **`chat`** — `messages.send` (trip + team), both BATCH

---

## List 4 — what actually has a live sender

The allowlist is machine-enforced (`pushCallSites.guard.test.ts` fails the build
if anything else imports a send helper):

| file | what it sends | category |
|---|---|---|
| `sendPush.ts` | the helper itself | — |
| `sendPushToUsers.ts` | the helper itself | — |
| `gameFinishNotify.ts` | `games.finish` (all four formats) + cup clinched | **`scores`** |
| `notifications.ts` | `testSend` — self-only diagnostic, bypasses the preference | `scores` |

**`scores` is the only category with a sender. `planning`, `invites` and `chat`
have zero.**

---

## The disagreements

**1 · Three of four preferences govern nothing.** The registry defines four
categories and the UI is being built to expose them, but only one can produce a
notification. Under the project's own rule — a control that does nothing is worse
than an absent one — three of these are controls over nothing.

**2 · The only preference anyone has ever set is for the category that cannot
fire.** Two users turned `chat` ON. `chat` has no sender. They opted in to
something that has never sent and cannot currently send. This is the sharpest
disagreement in the audit: the one measured piece of user intent points at the one
category with no implementation.

**3 · `NOTIFICATIONS.md` files `news.create` under `planning`.** In the shipped
UI, News is a segment of the **chat** surface — `ChatView` renders
Crew · Organizers · News, and `NewsPanel` lives inside it. The doc's assignment
predates that restructure. Whatever else is decided, this row is wrong today.

**4 · The premise "planning has no identified trigger" is incorrect.** Every
specced planning trigger is a live procedure with live UI:

- `datePoll.lockDateWindow` — `DatePollCard`, rendered by `FreshTripGuide` and
  `ItineraryPanel`
- `trips.lockDestination` / `changeDestination` — live mutations in trip components

What `planning` lacks is a wired **sender**, not a trigger. That is the same thing
`invites` and `chat` lack, and it is a different problem from "the workflow moved".
Worth stating plainly because the two lead to different decisions: an absent
workflow argues for retiring a category; an unwired one argues for either wiring it
or hiding the control until it is wired.

**5 · The invites-moved-to-email claim is confirmed.** `tripMembers` sends real
email — `sendInviteExistingUser`, `sendInviteNewUser`, `sendInvitationBlast`.
`NOTIFICATIONS.md` already anticipated this ("Already sends email — decide
push-vs-email, don't double") and the decision has since been made *de facto* by
the email path shipping and the push path never being wired.

---

## Per-category findings

### `scores` — **KEEP**

- **Trigger today?** Yes, two, both wired and both delivering in production
  (`push_send_log` shows `outcome: sent` for a cup clinch and for game-finish).
- **Workflow changed?** No.
- **If removed?** The entire working notification feature.
- **Stored prefs?** None yet; the control shipped in #853.

The only category that currently earns a row in a settings page.

### `chat` — **KEEP, but it is not currently a control**

- **Trigger today?** No sender. `messages.send` is marked BATCH and the coalescing
  strategy is explicitly undesigned.
- **Workflow changed?** Yes — chat is now three segments (Crew · Organizers · News)
  with organizer separation, none of which existed when the category was written.
  A single global chat switch may no longer be the right shape: muting Crew and
  muting Organizers are plausibly different decisions.
- **If removed?** Two users' explicit opt-in is discarded, and
  `sendPushToUsers.test.ts` breaks — it uses `chat` as its default-OFF fixture, so
  retiring it needs a different key or a rewritten test.
- **Recommendation:** keep the registry entry; **do not ship a toggle until a
  sender exists**. This directly contradicts the build mock in the spec, which
  lists Chat as a row — flagging it rather than resolving it.

### `planning` — **RETIRE the control, keep the question open**

- **Trigger today?** No sender. Three live, plausible, low-volume candidates
  (~1–2/trip each) that would be genuinely useful if wired.
- **Workflow changed?** Partly. The workflows exist; organizer chat now covers some
  coordination, which weakens the case but does not remove it.
- **If removed?** Nothing. Zero stored prefs, no sender, no test depends on it.
- **Recommendation:** remove from the settings surface. Re-adding is cheap and
  needs no migration — unset keys resolve through the registry default, which is
  why the column stores `{}` and is never backfilled.

### `invites` — **RETIRE**

- **Trigger today?** No sender.
- **Workflow changed?** Yes — the invite path is email, and the doc itself says not
  to double up.
- **If removed?** Nothing. Zero stored prefs, no sender, no test dependency.
- **Recommendation:** retire. The only arguable survivor is
  `tripMembers.updateRole`, which is rare and arguably belongs in-app rather than
  as a push.

### News — **should be its OWN category when wired, not folded into chat**

The spec asks whether News splits out. It should, and the reason is the default:

- News is ~1–5/trip, organizer-authored, high signal.
- Chat is hundreds/day, and defaults **OFF specifically because of that volume**.

Folding News into `chat` makes News inherit OFF-by-default, so the highest-signal
non-scoring notification in the app would reach nobody unless they had already
opted into the firehose. That is a bad outcome produced entirely by a
categorisation choice.

It is also not `planning`, which is what `NOTIFICATIONS.md` currently says.

**Recommendation:** correct the doc's mapping now; create the category when a
sender is wired, not before.

---

## What this implies for the settings page

Applying the project's own rule — no control without a sender — the surviving set
is **`scores` alone**, today.

That is a one-row settings page, which is a real outcome and worth naming rather
than designing around. The alternatives, for the decision:

| option | consequence |
|---|---|
| **A · ship `scores` only** | Honest. Every control does something. The page grows as senders are wired. |
| **B · ship `scores` + `chat`** | Matches the spec's mock. `chat` mutes nothing until a sender exists, and two users already believe they've opted in. |
| **C · ship all four** | Three controls over nothing; contradicts the constraint in the same spec. |

**Recommendation: A**, with `chat` added in the same PR as its sender.

## Open decisions for Zach

1. **A, B or C above.**
2. **Does `chat` stay one switch, or split by segment** (Crew / Organizers) now
   that the surface has three?
3. **Retire `planning` and `invites` from the registry**, or leave them defined but
   unexposed? Leaving them defined keeps `NOTIFICATIONS.md`'s inventory meaningful;
   removing them makes the registry describe only what exists.
4. **News category** — create now (dormant) or at wire time?

No code changes accompany this document. `NOTIFICATIONS.md` is deliberately left
uncorrected until the surviving set is chosen, per the spec.

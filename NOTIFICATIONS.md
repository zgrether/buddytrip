# Push Notifications — trigger-site inventory & taxonomy

Companion to the registry (`src/lib/notificationTypes.ts`). The registry is the
code source of truth for the four **categories**; this doc is the source of truth
for which **write sites** may fan out to them, and how. Phase 3 wires from this
list — nothing here is wired yet (Phase 2 built only the mechanism + a dev test
send).

## Categories (registry — confirmed)

| Key | Label | Default | Covers | Excludes (load-bearing) |
|-----|-------|:-------:|--------|--------|
| `scores` | Scores & results | **ON** | game/round finalized · result posted · **cup clinched** | per-hole entry, pairing setup, any per-write mechanical event |
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

| Write site (tRPC) | What happened | Category | Eligibility | Est. volume |
|---|---|---|---|---|
| `scores.upsertEntry` | A hole score entered | `scores` | **NEVER** | ~540/day (30×18). Mechanical. Never wire. |
| `scores.deleteEntry` | A hole score cleared | `scores` | **NEVER** | churny corrections; mechanical |
| `games.finish` | Game/round finalized | `scores` | **ELIGIBLE** | ~5–15/day. **The natural Phase 3 first wire.** |
| `games.post` | Result posted to the cup | `scores` | **ELIGIBLE** | ~5–15/day |
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

## Phase 3 recommended first wire

`games.finish` (ELIGIBLE, ~5–15/day, easy to reason about) to prove the
end-to-end path, then **cup clinched** — the single highest-value notification
in the app.

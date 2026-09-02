# Phase 0 — where 101,558 Supabase requests a day come from

**Read-only. No code written, no branch, no writes to prod.**
Code claims verified against `origin/main` @ `a69c83a`. Traffic claims measured
against prod `nezhuwyfirrbmyojpiyx` via `edge_logs` (100,383 rows, the same
24-hour window). Payload sizes measured by running the same SELECTs and taking
`octet_length` of the JSON — read-only queries.

---

## The answer in one paragraph

It is not per-action fan-out. **It is one browser tab left open on one game
page.** A `MatchGameView` sitting idle on the "Singles" game in BBMI 2023 costs
**16 Supabase requests and ~15 KB every 20 seconds** — 2,880 requests and
2.7 MB per hour, touching nothing. That single tab was open for ~13 hours of the
measured day and accounts for **~38% of all requests and ~36% of all egress.**
The multiplier is that each 20-second tick fires two HTTP requests which expand
into fourteen database reads plus two auth round-trips, and every one of those
reads re-sends its **entire** payload rather than a delta.

**On the upgrade question: modelled egress is ~99 MB/day ≈ 3.0 GB/month against
a 5 GB cap.** Details and error bars in §6. That is not comfortable, and the
trip-week multiplier lands squarely on the number that matters.

---

## 1 · Round trips for one page load

`readGameConfigHash` (`src/server/routers/games.ts:113-196`) is the engine of
this. One call = **8 parallel Supabase queries**, unconditional, every format:

```
games · game_participants · play_groups · game_matches · game_delegates
bracket_entrants(+bracket_entrant_members embed) · bracket_matches · pickem_games
```

Plus the `requireTripMember` gate (`middleware.ts:25` → `resolveTripRole:348`,
one `trip_members` SELECT per tRPC **context**), plus one `getUser()` from the
Next.js middleware. **9 Supabase requests + 1 auth call per configHash call.**

And `games.configHash` is deliberately on its **own un-batched link**
(`src/lib/providers.tsx:117-122`), so every poll is its own HTTP request — its
own context, its own gate SELECT, its own middleware `getUser()`.

### Cold open of a match game view

| Procedure | Supabase reads | Tables |
|---|---|---|
| `tripMembers.list` | 2 | trip_members, users |
| `games.getById` | 2 | games, game_participants |
| `matches.listByGame` | 4 | games, game_matches, game_participants, play_groups |
| `scores.listByGame` | 2 | games, score_entries |
| `matchOutcomes.listByGame` | 2 | games, match_hole_outcomes |
| `games.listOrganizers` | 1 | game_delegates |
| `competitions.getByTrip` | 1 | competitions |
| `teams.list` | 1 | teams |
| `teamAssignments.list` | 1 | team_assignments |
| `competitions.myTeamColor` | 1 | team_assignments |
| `games.configHash` | 8 | the bundle above |
| `courses.getById` ×2 | 2 | courses |
| gate SELECTs (1 per HTTP context, ~3) | 3 | trip_members |
| middleware `getUser()` (~3) | 3 | auth |
| **Total** | **≈ 33** | |

### Cold open of the trip/cup page

`competitions.faceBootstrap` alone is **13 Supabase reads in one procedure** —
teams, team_assignments, games, game_delegates, plus `computeCompetitionLeaderboard`'s
9 (`src/server/lib/competitionLeaderboard.ts`). With `competitions.getByTrip`,
`tripMembers.list`, the gate and the auth call, a cold Cup load is **≈ 20**, and
the trip layout resolves faceBootstrap **server-side too**, so a cold entry pays
much of it twice.

### And then the tab just sits there

Per 20-second tick, for the game that dominated the day (16 participants,
7 matches, 86 hole outcomes) — every byte measured, not estimated:

| HTTP request | Query | Bytes |
|---|---|---|
| **configHash** (un-batched) | `getUser()` | 664 |
| | trip_members gate (`select=role`) | 19 |
| | games (18 cols) | 1,577 |
| | game_participants | 2,036 |
| | play_groups | 216 |
| | game_matches | 1,937 |
| | game_delegates | 2 |
| | bracket_entrants | **2** |
| | bracket_matches | **2** |
| | pickem_games | **4** |
| **batch** (scores + outcomes) | `getUser()` | 664 |
| | trip_members gate | 19 |
| | games guard ×2 | 132 |
| | score_entries | **2** |
| | match_hole_outcomes | **7,682** |
| **16 requests** | | **14,958 B** |

**Per hour: 2,880 requests, 2.69 MB. Per 24h of one open tab: 69,120 requests,
64.6 MB.**

Measured: 2,374 outcome polls on that game in the window ⇒ ~13.2 tab-hours ⇒
**~38,000 requests (38% of all traffic) and ~35 MB (~36% of egress) from one
tab.**

---

## 2 · The three suspects — answered

**All four are unconditional, and the code says so on purpose.**

`readGameConfigHash` reads `bracket_entrants`, `bracket_matches` and
`pickem_games` for **every game of every format**. There is no `enabled:`
condition to quote because there is no condition — the reads sit in a flat
`Promise.all`. The comment defending it (`games.ts:161-168`):

> *"Runs for every game, not just brackets — same as `game_delegates`, which is
> read for games that have none. It's an indexed point lookup returning zero
> rows, and it shares the parallel batch, so it costs a connection rather than a
> round-trip. A conditional read would need the game's format first, which means
> making this sequential to save nothing."*

**That reasoning is correct about latency and wrong about this bill.** "Costs a
connection rather than a round-trip" is true from the function's point of view
and false from Supabase's: each is a separate billed edge request. But — and
this is the part that decides it — **they are also the cheapest things in the
system.** Measured response bodies: `bracket_entrants` **2 bytes**,
`bracket_matches` **2 bytes**, `pickem_games` **4 bytes**, `game_delegates`
**2 bytes**. Removing all four saves ~13,000 requests/day and **~29 KB of
egress**. By the spec's own rule — bytes, not counts — this is the least
valuable fix available.

### Bracket games in prod

**Three.** Not zero, but close, and none of them is being played:

| Game | Format | Status | Trip |
|---|---|---|---|
| Skipbo | `competition_format='bracket'` | complete | (test trip) |
| Uno | bracket | complete | (test trip) |
| Double Elim Test | bracket | complete | (test trip) |

All three are `status='complete'`, all in one trip alongside rows named "test"
and "Corn". Note bracket is a **`competition_format` on a non-golf game**, not a
`game_type_id` — worth knowing before anyone writes the conditional.

The contrast worth drawing: `competitionLeaderboard.ts:253` reads
`bracket_entrants` **conditionally** — `bracketGameIds.length ? … : null`. Same
question, two answers, and the one that got it right is the older code. That is
CLAUDE.md #27's shape exactly.

### The related note in the spec, confirmed

`MatchGameView.tsx:299-301` polls `scores.listByGame` every 20s on a game whose
`entry_mode='outcome'` — which by construction has **zero** `score_entries`
rows (CLAUDE.md #27). Measured: **2,408 requests in 24h, every one returning
`[]`, 2 bytes each.** Real waste, ~5 KB of egress. Same verdict as above.

---

## 3 · `trip_members` at 17,112 — #1214 is not the story

**96% of it is the membership gate, not `tripMembers.list`.**

| Shape | Requests | Bytes each |
|---|---|---|
| `select=role&trip_id=eq.X&user_id=eq.Y` — the gate | ~16,290 | **19** |
| `select=<19 cols>&trip_id=eq.X` — `tripMembers.list` | 618 | **8,091** |

`resolveTripRole` (`middleware.ts:348`) issues one `trip_members` SELECT per
tRPC **context**, memoised in `ctx.membershipCache` — which dies with the
request. So it is **one per HTTP request**, and `games.configHash` being on its
own un-batched link means every 20-second poll buys its own.

**Answer to the spec's question: it is neither a call-site problem nor a cache
configuration problem.** It is server-side, per-request, and invisible to React
Query — no query key, no client cache, nothing #1214 can reach. #1214 is about
the other 618, and it is worth ~3.7% of the requests on that path (though those
618 carry 5.0 MB, so by bytes it is worth more than by count).

Posted to #1214 as a comment rather than filed as a sibling.

---

## 3a · Does the poll pause when nobody is looking? Yes — and that kills the cheapest hypothesis

Raised by Zach after the first draft: React Query's `refetchIntervalInBackground`
defaults to `false`, so either that tab was focused for thirteen hours or
something overrode the default. If overridden, one config line removes the
largest line item in the system.

**It is not overridden. There is no config-line fix.** All six polls set it
explicitly, and the seventh relies on the library default, which is also `false`:

| Poll | Setting |
|---|---|
| `useConfigSync` (configHash) | `refetchIntervalInBackground: false` (`useConfigSync.ts:73`) |
| `useConfigDraft` (configHash) | `false` (`useConfigDraft.ts:85`) |
| `StrokeGameView` scores | `false` (`StrokeGameView.tsx:112`) |
| `RackGameView` scores | `false` (`RackGameView.tsx:171`) |
| `MatchGameView` scores | `false` (`MatchGameView.tsx:301`) |
| `MatchGameView` outcomes | `false` (`MatchGameView.tsx:310`) |
| `PickemGameView` | `false` (`PickemGameView.tsx:153`) |
| `LEADERBOARD_QUERY` (5 min) | unset → library default `false` (`queryConfig.ts:97`) |

### And it demonstrably works

Hourly poll count for that one game, `match_hole_outcomes` on `25279c42`:

```
23:00  86     <- tab opened mid-hour (Sep 1)
00:00   8
01:00   1
02:00 – 08:00  ABSENT  <- seven hours, zero polls
09:00  24     <- resumes
10:00 161     ┐
11:00 175     │
…             │  ~172-185/hour = 3/min = the 20s cadence, unbroken
21:00 236     │
22:00 167     ┘
23:00  19
```

The overnight stop is the mechanism working. Nothing polled for seven hours.

### But "background" means HIDDEN, not UNFOCUSED — and that is the part worth knowing

Read from the pinned source (`@tanstack/query-core@5.90.20`, the version in
`package-lock.json`):

```js
// focusManager.js — the ONLY event listener it registers
window.addEventListener("visibilitychange", listener, false);

isFocused() {
  return globalThis.document?.visibilityState !== "hidden";
}

// queryObserver.js:214
this.#refetchIntervalId = timeoutManager.setInterval(() => {
  if (this.options.refetchIntervalInBackground || focusManager.isFocused()) {
    this.#executeFetch();
  }
}, nextInterval);
```

There is **no `focus`/`blur` listener** — those were dropped in v4. So a tab
sitting visible in a window that does not have OS focus (second monitor, browser
behind an editor, a maximised window nobody switched away from) is "focused" as
far as React Query is concerned, and **keeps polling at full rate.** Only an
actual hide stops it: another tab, minimise, screen lock, phone backgrounded.

So thirteen hours of polling required nobody to be looking at anything. It
required only that the tab stayed visible.

*(Minor, recorded so nobody re-derives it: the interval TIMER is not cleared on
hide — the callback still fires every 20s and simply skips the fetch. Costs
nothing in requests or egress.)*

### Was it a desktop browser?

**Not provable from these logs, and the behavioural evidence is better than the
device string would be.** Every Supabase request originates from a Vercel
function, so `request.headers.user_agent` on all 2,455 of those polls reads
`node` — the browser never talks to Supabase directly. Vercel runtime logs carry
console output rather than the client UA, and the window is outside Hobby
retention.

What the shape says instead, and it is close to conclusive:

- **98.6% of inter-poll gaps are ≤25 s** (2,413 of 2,447) — 13.46 hours of
  unbroken 20-second cadence.
- **Twelve consecutive hours at a flat 172–185 polls/hour.** A phone cannot
  produce that: every screen-lock and app-switch fires `visibilitychange` and
  would notch the hourly count.
- **A clean seven-hour overnight stop**, resuming at 09:00 — the signature of a
  machine sleeping and waking, not of someone opening an app.

Read together: a laptop or desktop tab left visible through a working day. I am
stating that as an inference from cadence, not as a measured device.

### What this does to the trip-week extrapolation — Zach is right, and it cuts the number

The 50-tab-hours/day figure in §6 is **desktop-shaped**, and trip week is
phone-shaped. A phone in a pocket between shots is `hidden` and polls nothing; a
phone on the tee with the score page open polls at full rate. So the real trip
figure is close to **actual minutes of screen-on, app-foreground use**, not to
hours of tabs being open — which is a much smaller number and a much better
behaved one.

Two things follow, and they point opposite ways:

- **Down:** the ~135 MB/day from idle tabs in §6 is an over-estimate for a
  phone-dominated week. Sixteen people at, say, 90 focused minutes each per day
  is ~24 tab-hours, not 50 — roughly **65 MB/day**, half of what §6 assumed.
- **Up, and this is the one nobody would guess:** the polls are *concentrated
  where the payloads are biggest*. A phone open on the match-play score page
  during a round is polling the **full 86-row `match_hole_outcomes` payload**
  every 20 seconds, and that set only grows as the round is played. The idle
  desktop tab measured here was polling a **completed** game whose outcome set
  had stopped growing.

I have not re-run §6's model on the phone-shaped assumption — doing so honestly
needs a screen-time estimate I do not have. **The correction is real and the
direction is down; the magnitude is unmeasured.** Section 6's headline stands
with a wider error bar rather than a smaller number, and the upgrade argument was
never resting on the tab-hours line anyway — it rests on 3.0 GB/month of measured
current use against a 5 GB cap.

---

## 4 · Polling versus navigation

**Derived, with the arithmetic shown** — I could not separate them by timing
alone, so this is attribution by known caller, not a timing analysis.

| Poll | Ticks/24h (measured) | Supabase reqs each | Total |
|---|---|---|---|
| `games.configHash` (20s) | **3,229** (the `select=name,status,game_type_id…` shape on `/rest/v1/games`, corroborated by `pickem_games` 3,312 and `bracket_matches` 3,297) | 9 + 1 auth | **32,290** |
| scores + outcomes batch (20s) | ~2,400 | 5 + 1 auth | **~14,400** |
| `competitions.leaderboard` (5 min) | ~1,400 (from `game_started` 1,396, whose only caller it is) | 10 + 1 auth | **~15,400** |
| **Polling subtotal** | | | **~62,000 (62%)** |

So **roughly 60% of the 101,558 is polling**, and it is concentrated: the
configHash figure alone is 32% of all traffic.

Per the spec, no proposal to lengthen the interval. The interval is not the
problem — **what each tick sends is.**

---

## 5 · The auth tax — and the spec's premise is wrong here

**`/auth/v1/user`: 9,559 requests, all HTTP 200, 664 bytes each = 6.35 MB/day.**
Only **69** `/auth/v1/token` refreshes in the whole window.

The spec says this is "roughly one call per ten requests, not one per request".
That is true of *Supabase* requests and misleading as a conclusion: **it is one
per HTTP request**, and each HTTP request expands into ~9 Supabase reads. There
is no path that skips it.

Source: `src/middleware.ts:67` — `supabase.auth.getUser()`, on a matcher that
includes `/api/trpc/*`. This is exactly what **#1097** describes.
`createTRPCContext`'s `getClaims()` fast path (`src/server/trpc.ts:88`) is
working; the middleware is the one paying.

**So the spec's "its fix does not reach the launch path" is a claim about
latency, and it does not carry over to this bill.** By egress, #1097 is the
**second-largest single line item in the system** — 6.35 MB/day, ~6.4% of
modelled total, and unlike everything above it, it is one call site.

I have not proposed shipping it: the spec puts #1097 out of scope by prior
decision, and I am not overriding that. But the decision was made against a
latency argument and there is now a byte argument, which is Zach's to weigh.
Measurement posted to #1097.

---

## 6 · Payload size — the number that decides the upgrade

**Measured directly** where `content_length` was present (57,749 of 100,383
requests, 10.27 MB); **modelled** for the 40,540 chunked responses by running
the identical SELECT and taking `octet_length` of the JSON.

| Path | Reqs | MB/day | Basis |
|---|---|---|---|
| `match_hole_outcomes` | 3,417 | **~20.0** | 2,374 × 7,682 B measured, + batch reads |
| `team_assignments` | 3,872 | **~17.6** | `select("*")`, 4,772 B for the 16-row comp |
| `game_participants` | 7,510 | ~12.9 | 6,324 chunked × 2,036 B |
| `game_matches` | 6,709 | ~10.9 | 5,608 chunked × 1,937 B |
| `score_entries` | 3,855 | ~9.4 | 344 chunked × 26,894 B (288-row rack game) |
| `games` | 13,954 | ~9.0 | measured per query shape |
| `/auth/v1/user` | 9,559 | **6.35** | measured exactly |
| `trip_members` | 16,905 | ~5.3 | 618 × 8,091 + 16,290 × 19 |
| `game_results` | 1,500 | ~2.3 | estimated |
| `users` | 608 | ~1.4 | 603 × 2,242 B |
| `competitions` | 3,004 | ~1.2 | `select("*")`, 401 B |
| everything else | ~29,000 | ~2.5 | |
| **Total** | **100,383** | **~99 MB/day** | |

**≈ 3.0 GB/month at current, conservative usage. Cap is 5 GB.**

**Error bars, honestly:** ±30%. The chunked half is modelled, not measured;
Supabase's own egress meter may count headers, TLS and Realtime that I cannot
see; and one day is one sample. Treat 3.0 GB as "the right order of magnitude
and probably a slight under-count", not a reading.

**Trip week.** The per-tab-hour figure is the one to extrapolate with, and it is
already measured on a **16-player** game, so it is the right shape: **2.69 MB
and 2,880 requests per open game tab per hour.** Sixteen people with the game
page open for six hours a day is ~50 tab-hours ⇒ **~135 MB/day from idle tabs
alone**, before anyone navigates.

> **Read §3a before using that number.** It is desktop-shaped — 50 tab-hours
> assumes tabs left open, and a phone polls only while the screen is on and the
> app is foreground. The honest correction is *downward, magnitude unmeasured*.
> The upgrade argument below does not rest on this line. Five trip days at 200–300 MB/day is
**1.0–1.5 GB**, on top of a normal month's ~1.5–2.5 GB.

**Verdict: it probably fits under 5 GB, with no margin.** If the trip runs hot —
more tabs, more hours, someone leaving a scoreboard up overnight — it does not.
Given that the cost of being wrong is the app degrading mid-trip, and the cost of
being right is a month of Pro, **the asymmetry favours upgrading.** That is the
input; the call is Zach's.

### `select("*")` on a top path — yes, one

`team_assignments` is read with `select("*")` in **two** places:

- `src/server/routers/teamAssignments.ts:27` (`listTeamAssignments`)
- `src/server/routers/competitions.ts:202` (`faceBootstrap`'s own copy)

Seven columns. Two are dead weight on this query:

| Column | Read from this payload? |
|---|---|
| `assigned_at` | **No reader anywhere** — grep finds only two comments, one of which says the write payload "deliberately still omits" it |
| `team_visible_from` | **No** — its only reader, `src/server/lib/viewerTeam.ts:65`, runs its own `select("team_id, team_visible_from")` |

Measured on the 16-row competition: **4,772 B → 3,162 B**, a 34% cut.
Across the day's actual per-competition request counts: **5.6 MB/day saved
(~5.7% of total egress)** — bigger than every request-count fix in this report
combined, and second only to #1097 among things that are nearly one line.

---

## Fix candidates — reported, not shipped

Per the spec I have stopped here. Each with blast radius, one PR each if any go.

### A · Narrow `team_assignments` `select("*")` — **recommended**

- **Saves:** 5.6 MB/day measured (~5.7% of egress). Zero request-count change.
- **Change:** `select("*")` → `select("competition_id, user_id, team_id, is_captain, sort_order")` in two files.
- **Blast radius, and it is why this is not strictly "one line":**
  - Two call sites that must stay identical — `competitions.ts:202` carries a
    comment saying its ordering is **load-bearing** and must match
    `listTeamAssignments`, because it **seeds that procedure's cache**
    (`LiveFaceClient.tsx:176`). Change one, change both.
  - `facebootstrap.ordering.test.ts` pins the pair. It pins ordering, not
    columns, so it should stay green — unverified, I did not run it.
  - `TeamsPanel.tsx` does optimistic `setData` on this cache in four places; the
    optimistic row shape should be checked against the narrowed one.
  - Consumers verified by grep (`news.ts` uses `user_id` + `team_id` only; no
    client reads `assigned_at` or `team_visible_from` off these rows).
- **Honest risk:** low, but it is a shared cache read by the leaderboard, the
  rosters overlay, rack's group builder and the news feed, three days out.

### B · Drop the bracket/pick'em reads from `readGameConfigHash` — **not worth it**

- **Saves:** ~9,700 requests/day (9.7% of count), **~29 KB/day (0.03% of egress)**.
- **Blast radius: much larger than it looks.** `readGameConfigHash` serves both
  `games.configHash` **and** `saveConfig`'s optimistic-concurrency check, which
  must produce byte-identical hashes. Making a read conditional changes the hash
  input, so on deploy every client's held `baseHash` goes stale — a spurious
  refetch is harmless, but **`saveConfig` comparing a pre-deploy baseHash would
  refuse the save** with "Reload and try again". Three days out, on the settings
  path, for 29 KB.
- **Recommendation: no.** Filed, not shipped.

### C · Skip the `scores.listByGame` poll on outcome-mode games — **not worth it**

- **Saves:** 2,408 requests/day, **~5 KB egress**.
- Same verdict as B, for the same reason: it is a request-count fix and requests
  are not the constraint.

### The big three are all ineligible

`match_hole_outcomes` (20 MB), the configHash bundle (15.8 MB) and the
5-minute leaderboard poll are all **poll cadence, cache configuration, or
consolidating fetches** — every one of them explicitly out of bounds before
September 13, and rightly so.

---

## Code versus documentation — disagreements found, not resolved

1. **CLAUDE.md #20 says "Standalone games (~40% of prod)".** Prod has **40 games
   and zero with `competition_id IS NULL`.** Quoted: `CLAUDE.md`, Enforced
   Pattern #20 — *"Standalone games (~40% of prod) simply early-return — the
   null-competition path is the COMMON case, not an edge case."* Against:
   `SELECT count(*) FROM games WHERE competition_id IS NULL` → **0**.
   The early-return is still correct code; the number describing it is not.
   *(I quoted this figure myself in the standalone-games scoping report on
   2026-09-02 — it is wrong there too, and that report flagged it as
   unconfirmed.)*

2. **`games.ts:161-168` says the extra configHash reads cost "a connection
   rather than a round-trip".** Each is a separate billed Supabase edge request.
   The comment is right about latency and wrong about billing; it was written
   before anyone was counting requests. Not touched.

3. **The spec's own §5 framing** — "roughly one call per ten requests, not one
   per request" and "#1097's fix does not reach the launch path". Both are true
   of latency and false of egress. Covered in §5.

---

## When a rule blocked me

- **The assigned branch is `claude/standalone-games-scope-1kx9qf`**, which
  belongs to the scoping task you shelved this morning. This report is not code
  and committing it there would bury it under a shelved feature, so **I have not
  pushed anything.** The durable record is the two issues below plus this file.
  Say the word and it goes on a fresh branch in one command.
- **Phase 0 is read-only**, so the `getClaims`/`getUser` question in §5 was
  settled by reading `middleware.ts` and auth-js 2.99.1's compiled source rather
  than by instrumenting a request. That is sufficient for the claim I made; a
  runtime probe would be needed to claim anything more.
- **No local Supabase and no `node_modules` in this session** — I installed
  `@supabase/auth-js@2.99.1` into the scratchpad to read `getClaims`'s real
  branching (CLAUDE.md #23's prescribed move). Nothing was installed into the
  repo.

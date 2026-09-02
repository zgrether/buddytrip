# Standalone shareable stroke & match play — scoping report

**Investigation only. No code was written; no branch carries an implementation.**
Every claim below is verified against `src/` and `supabase/migrations/` on
`origin/main` @ `c197900`. Where I could not verify something from this repo it
says **unconfirmed**.

---

## TL;DR

The reusable half is bigger than expected and the coupling is narrower than
expected, but it is concentrated in exactly the two files that would have to be
duplicated.

- **131 files / 28,557 lines** make up the transitive import closure of
  `StrokeGameView` + `MatchGameView`. **96 files / 17,210 lines (60%) contain
  no reference to `tripId` at all** — the whole entry/scorecard/scoring layer is
  already container-free.
- **35 files / 11,347 lines (40%)** reference `tripId`. Of those, **two files
  hold 167 of the ~300 references** (`MatchGameView` 106, `StrokeGameView` 61).
- **Option A's walking skeleton is one new client page and nothing else** — no
  migration, no modified file, no new server procedure. Verified against
  `trips.create`, `ghostCrew.create` and the existing `/trips/[tripId]/games/new`
  route, all of which already do what is needed.
- **Option B's floor is 2 migrations, 16 RLS policies, 3 middleware factories, a
  952-line `SECURITY DEFINER` RPC, ~49 tRPC procedures and 35 client files** —
  and every one of those is existing, working, trip-critical code. The server
  half is the part duplication cannot isolate, which is where the risk sits.
- **The premise "Quick Play shares little with what is being asked for" is
  wrong.** It shares 20+ modules with the real surfaces, including both entry
  views, both scorecards and both pure scoring engines, and it *already* does
  stroke, match **and** rack. Only the persistence and the identity model differ.
  See §6 — this does not change the recommendation, but the spec asked to be told.

**Recommendation: Option A**, for reasons in §9 — including one that argues
against it and should be weighed.

---

## 1 · The container

### 1.1 `trip_id` is still `NOT NULL` on both tables

| Table | Declaration | File |
|---|---|---|
| `games` | `trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE` | `supabase/migrations/20260608140000_033_competition_engine_slice_a_spine.sql:20` |
| `competitions` | `trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE` | `supabase/migrations/20260517160000_001_initial_schema.sql:267` |

No migration in the 181-file history alters either column's nullability
(`grep -E "alter|drop not null|set not null"` over every `trip_id` line in
`supabase/migrations/*.sql` returns nothing).

> **Spec nit, not a finding:** the spec cites `competitions.trip_id` at
> `001:471`. Line 471 of that file is
> `CREATE INDEX ... competitions_trip_id_idx`. The column is at line 267. The
> `games` citation (`033:20`) is exact.

### 1.2 The minimum viable trip row is `{ id, title }`

`trips` (001:64–98, plus every later `ALTER`) has **no `NOT NULL` column without
a default except `id` and `title`**. `start_date`, `end_date`, `location`,
`accommodation`, `notes`, `circle_id` are all nullable; `description`,
`activities`, `golf_courses`, `comparison_mode`, `poll_mode`, `planning_tier`,
`itinerary_enabled`, `getting_there_enabled`, `quick_info_dismissed`,
`date_lock_override` all carry defaults.

`trips.create` (`src/server/routers/trips.ts:111`) is an `authedProcedure` with
**no trip guard** (there is nothing to guard — it is the creation door). Its
required input is `{ id, title }`; everything else is `.optional()`. It inserts
the trip, then a single `trip_members` row with `role: 'Owner'` for the caller.

So the shim is: one `trips` INSERT, one `trip_members` INSERT — both through an
existing, unmodified procedure.

### 1.3 What breaks if a trip has no dates: nothing

The date lock is `isReadOnly` (`src/lib/tripStatus.ts:128`), and its first line
is `if (!trip.end_date) return false;` (line 116 in `nextSunday`-threshold
helper). **A dateless trip never locks.** The spec's concern here is unfounded.

The only two non-null assertions on trip dates in the codebase —
`SetDatesFlipCard.tsx:97-98` and `ScheduleTab.tsx:697` — are both inside an
explicit `trip.start_date && trip.end_date` guard. Neither can throw.

Destination is nullable and drives only display (`locked_destination_at IS NULL`
keeps the trip in the "idea" display state — cosmetic).

Solo is supported: `games.soloStroke.test.ts` pins a one-player stroke game end
to end through the real `games.finish` dispatch. (Match play needs two sides by
definition, not by a floor.)

### 1.4 RLS policies gating game/competition access through trip membership

Computed by replaying every `CREATE POLICY` / `DROP POLICY` in migration-filename
order and keeping the surviving definition per `(table, policy)` — **155 live
policies across 54 tables**, of which **110 across 39 tables** reference
`is_trip_member` / `has_trip_role` / `is_trip_planner`.

Narrowed to what stroke and match play actually touch:

| Layer | Tables | Live policies | Trip-gated |
|---|---|---|---|
| **Stroke + match core** | `games`, `game_participants`, `game_results`, `game_matches`, `game_delegates`, `play_groups`, `score_entries`, `match_hole_outcomes` | 21 | **16** |
| Competition layer | `competitions`, `teams`, `team_assignments`, `events`, `event_point_distributions` | 20 | 20 |
| Other formats (bracket / pick'em) | 6 tables | 12 | 12 |

**16 is Option B's RLS number** for the two formats asked for. The competition
layer's 20 are **not** required: `games.competition_id` is nullable
(`033:21`) and both views already create competition-free games (§2.4), so a
standalone stroke or match game needs no competition row at all. Costing
`competitions.trip_id` nullable into Option B would be costing work this ask
does not need.

Two analysis caveats, stated so the number can be trusted:

- The five remaining core policies are the `*_delegate` arms
  (`is_game_delegate(game_id)`) — **game-scoped, no trip reference**. So is
  `can_score_unit` (`090`) and `can_score_match` (`076`). The entire
  "who may enter this score" layer is *already* container-independent; only the
  outer `AND is_trip_member(g.trip_id)` couples it.
- Migration `029` rewrote every policy body containing `'Planner'` →
  `'Organizer'` **programmatically from `pg_policies`**. So the literal text in
  `001` reads `'Planner'` while the live policy reads `'Organizer'`. My replay
  reads the file text; the runtime bodies differ in that one string. Not a
  finding — just a reason not to quote `001` verbatim as live policy text.

---

## 2 · The game surfaces

### 2.1 `StrokeGameView` and `MatchGameView` take **zero props**

```
export function StrokeGameView() {          // StrokeGameView.tsx:74
  const { tripId, rawParam: param } = useTripId();
export function MatchGameView() {           // MatchGameView.tsx:145
  const { tripId } = useTripId();
```

There is no prop interface to enumerate. Both read `tripId` from
`useTripId()` and `gameId` from `useSearchParams().get("game")`. Everything else
is fetched.

| | Lines | `tripId` occurrences | tRPC procedures called |
|---|---|---|---|
| `StrokeGameView` | 1,338 | 61 | 9 |
| `MatchGameView` | 2,785 | 106 | 12 |

**Every one of those 21 procedure calls passes `tripId` and runs
`requireTripMember`** (or a stricter game guard). Verified individually — e.g.
`games.getById` is `.input(z.object({ tripId, gameId })).use(requireTripMember)`
and then `.eq("trip_id", ctx.tripId)` on the row read
(`src/server/routers/games.ts:474-482`). `tripId` is not decorative anywhere in
this path: it is the gate **and** a query filter.

### 2.2 What resolves from trip context vs. what doesn't

The import closure, measured transitively from each view:

| | Files | Lines | Files with `tripId` | Lines in those |
|---|---|---|---|---|
| `StrokeGameView` closure | 105 | 19,830 | 30 | 7,640 |
| `MatchGameView` closure | 120 | 25,421 | 34 | 10,009 |
| **Union** | **131** | **28,557** | **35** | **11,347** |
| **Union, trip-free** | **96** | **17,210** | — | — |

The persistence-agnostic layer (CLAUDE.md Enforced Pattern #7) holds up under
measurement — these are the files that would be reused **byte-for-byte** under
either option:

| Component | Lines | `tripId` refs |
|---|---|---|
| `ScoreEntryView` | 542 | **0** |
| `MatchEntryView` | 710 | **0** |
| `MatchOutcomeEntryView` | 511 | **0** |
| `StandardGrid` | 877 | **0** |
| `FinalStandings` | 153 | **0** |
| `ScorecardSheet` | 55 | **0** |
| `GameLifecycleActions` | 253 | **0** |
| `GameStandaloneHeader` | 93 | **0** |

The 35 trip-coupled files, in full, are listed in §7.1.

### 2.3 The game shell is already reusable outside trip chrome

Two findings that matter more than they look:

- **`GameStandaloneHeader.tsx` (93 lines) is entirely trip-free** — props are
  `{ title, subtitle?, onBack, chrome }`. It exists precisely for "the deep-link
  / refresh path, where there is no `TopNav`". It is already the standalone
  header.
- **`GamePageHeader.tsx` "Renders nothing for a standalone (non-competition)
  game"** (its own doc comment, line 27, verified against the body). It takes
  `tripId` only to forward to `useRealtimeScoreEvents`. It is a no-op for this
  use case.

The route wrapper is four lines:

```tsx
// src/app/trips/[tripId]/games/new/page.tsx
export default function NewGamePage() { return <StrokeGameView />; }
```

**What a standalone route would need**, concretely: a `TripIdProvider` in scope.
`useTripId()` **throws** outside the provider, by design
(`TripIdProvider.tsx:100`). `TripIdProvider` reads `useParams().tripId`, and a
source guard in `TripIdProvider.test.ts` fails the build if anything else calls
`useParams().tripId` in trip-scoped code. Under Option A this is free — the URL
*is* `/trips/{shimId}/games/new`. Under Option B it is a contract change to a
provider that 5 game views + `LiveFaceClient` consume.

### 2.4 Both formats already create competition-free games

- `StrokeGameView.tsx:708` — `createGame.mutateAsync({ tripId, gameTypeId: STROKE_PLAY })`, **no `competitionId`**.
- `MatchGameView.tsx:1122` — same, and line 1831 comments "a STANDALONE match game has no points at all".

So the format layer is already built for the competition-free case. The only
thing missing is a container that isn't a trip.

### 2.5 The scoring path is game-scoped already

| Module | Lines | Reads trip state? |
|---|---|---|
| `src/lib/strokePlay.ts` | 276 | No — every "trip" hit is the word *strip* |
| `src/lib/matchPlay.ts` | 275 | No |
| `src/server/lib/strokePlay.ts` | 168 | No |
| `src/server/lib/matchPlay.ts` | 336 | No |
| `useScoreSaver` | 350 | **No** — takes `tripId` as a parameter, only to forward into `scores.upsertEntry` |
| `useOutcomeSaver` | 183 | **No** — same shape |

`computeMatchPlayResults` and `computeStrokeLeaderboard` never see a trip. The
two savers are pure pass-through: under Option A they work unchanged; under
Option B their `tripId: string | undefined` parameter and the two mutation
inputs behind it would change.

---

## 3 · Membership and the email lookup

**It already exists, and it is less trip-coupled than the rest of the stack.**

### 3.1 Email → account

`lookup_user_by_email(p_email)` — a `SECURITY DEFINER` RPC added in migration
133. It takes **no container argument** and deliberately "crosses trip
boundaries by design" (`tripMembers.ts:130-133`). It is the resolver behind both
`tripMembers.checkEmail` and `ghostCrew.create`.

The *wrapper* procedures are trip-gated (`requireTripMember` /
`requireTripRole("Organizer")`), and their `tripId` input exists **only** for
that gate — `checkEmail` never uses `ctx.tripId` in its body. So the lookup runs
outside trip-invite UI today; only its doorway is trip-shaped.

### 3.2 The placeholder path

| Function | Signature | Trip-coupled? |
|---|---|---|
| `merge_guest_to_real_user` | `(p_ghost_id text, p_real_id text)` | **No** — no container parameter. Reassigns `trip_members` (and every other person reference) generically. |
| `handle_new_user` | trigger on `auth.users` | **No** — matches on email, calls the merge |
| `link_guest_to_account` | `(p_trip_id text, p_ghost_id, p_real_id)` | **Yes** — body raises unless `has_trip_role(p_trip_id, ARRAY['Owner'])` |

The signup conversion — the path that matters, the one that runs when a
placeholder decides to get an account — is **container-independent** and works
unchanged under either option. Only the owner-initiated "paste an email onto an
existing placeholder" wrapper is trip-gated.

This is verified from the function signatures and bodies (migrations 146 and
132), not inferred.

### 3.3 Who can score in a standalone game

`score_entries_write` (migration 136) admits a write when:

```
is_trip_member(g.trip_id) AND (
     has_trip_role(g.trip_id, ARRAY['Owner','Organizer'])
  OR is_game_delegate(g.id)
  OR (g.scoring_enabled = true AND can_score_unit(...))
)
```

**Under Option A this comes free.** The shim's creator is `Owner`; everyone
added is `Member`; once the creator flips scoring on, each member may write
their own unit via `can_score_unit` / `can_score_match` — both of which are
already game-scoped, so nothing about a small container confuses them.

`scores.upsertEntry` carries only `requireTripMember` at the tRPC layer
(`scores.ts:37`) — the real authority is the policy above. That is the correct
shape and it survives Option A untouched.

**Under Option B**, the replacement is a second arm on all 16 policies. The
natural one is a game-scoped participant check — `EXISTS (SELECT 1 FROM
game_participants WHERE game_id = g.id AND user_id = auth.uid())` — plus a
game-level owner column. **`games` has no owner column** — confirmed by
enumerating every `ADD COLUMN` against `public.games` across all 181 migrations
(13 added since `033`; none is `created_by`, `owner_id` or equivalent). So
Option B needs a **second migration** to give a trip-less game a writable owner,
or must derive ownership from `game_delegates` — a grant table, not an ownership
one.

---

## 4 · Adding people without the trip-invite UI

**Yes. `ghostCrew.create` is a single mutation that does exactly what is asked**
(`src/server/routers/ghostCrew.ts:25`):

```
input: { tripId, name, email?, role }
guard: requireTripRole("Organizer")
```

Its branches, read in full:

1. `email` matches a **real account** → inserts a `trip_members` row for that
   user directly (the "auto-link" branch, lines 87-96). Member is Active
   immediately.
2. `email` matches an **existing guest** → reuses that guest row, adds a
   `trip_members` row.
3. **No email or no match** → creates a guest `users` row + `trip_members` row.

It sends **no email and no push** — the only side effect beyond the two inserts
is a best-effort system line into Crew chat. It is not the invite flow; the
invite flow is `tripMembers.inviteByEmail` (`tripMembers.ts:518`), which is a
separate procedure that *does* send.

That is the whole of §4, per the spec's instruction to skip the rest.

---

## 5 · Navigation and chrome

**The standalone game route already renders no trip chrome, and this needs no
design work under either option.**

Traced through the render tree rather than assumed:

- `src/app/layout.tsx` renders `<Providers>{children}<SiteFooter/></Providers>` —
  **no `AppShell`, no `TopNav`, no bottom nav**.
- `src/app/trips/[tripId]/layout.tsx` renders `HydrateQueryState` →
  `TripIdProvider` → `TripBootSeed` → children. **No shell either.**
- `AppShell` is rendered by exactly two hosts: `src/app/trips/[tripId]/page.tsx`
  and `src/app/dashboard/DashboardClient.tsx`.
- Therefore `/trips/{id}/games/new` renders `StrokeGameView` with
  `useInGamePanel() === false` → it draws `GameStandaloneHeader` and nothing else.

So the answer to "what would a standalone game route render instead of
Home/Trip/Cup/Chat" is: **the same thing the deep-link game route renders
today — a 52px back/title/actions bar and the game.**

Two supporting facts: `AppShell` already accepts `tripId: string | null` ("the
context-free host (`/dashboard`)"), and `AppTabBar` takes `tripId?: string |
null`. The shell is *partly* decoupled already, but neither option needs to
touch it.

---

## 6 · What Quick Play actually contributes

**Half the premise is confirmed and half is refuted.**

**Confirmed — it is localStorage-only.** State is one `QuickGameState` blob per
format under `bt.quickGame.*`, read/written by `readQuickGameState` /
`writeQuickGameState` (`src/lib/quickGame.ts:381-426`). No DB row, no
`score_entries`. The only tRPC in the whole subtree is the course picker inside
`QuickGameSetupSheet.tsx:11`.

**Refuted — it does not share little.** `/quick-game` and its two components
import **20+ modules from the real game surfaces**, including:

`ScoreEntryView` · `MatchEntryView` · `MatchOutcomeEntryView` · `StandardGrid` ·
`OutcomeScorecard` · `ScorecardSheet` · `FinalStandings` · `@/lib/matchPlay` ·
`@/lib/handicap` · `@/lib/gloriousHoles` · `@/lib/strokePlayConfig` ·
`@/lib/rackNStack` · `@/lib/courseSnapshot` · `@/lib/courseIndex` ·
`@/lib/sideBets` · the whole `games/bets/*` and `games/course/*` trees.

**Also refuted: it is not stroke-only.** `QuickGameFormat = "stroke" | "match" |
"rack"` (`quickGame.ts:63`), with `QuickMatchSurface.tsx`, `isMatchGame`,
`quickMatchGlorious` and a `QUICK_GAME_TYPE_ID` map onto the real
`gtt_stroke_play` / `gtt_match_play` / `gtt_rack_n_stack` type ids.
`quickGame.ts` (946 lines) and `quickGame.test.ts` (964 lines) already cover the
two formats Zach is asking for.

> **A doc/code disagreement, reported not resolved** (per the spec's rule).
> `src/app/quick-game/page.tsx:53-56` says: *"Renamed from 'Quick Game' (#879
> item 1a): the old name promised a format picker that doesn't exist — it only
> ever does stroke play."*
> `src/lib/quickGame.ts:63` says: `export type QuickGameFormat = "stroke" |
> "match" | "rack";`
> These cannot both be current. I have not changed either. My reading is that
> the comment is stale and match/rack were added after it, but **which one is
> the bug and which is the cleanup is Zach's call** — if match and rack were
> added to Quick Play without the naming decision being revisited, that is a
> different conversation from a stale comment.

### 6.1 What fixing Quick Play would cost (required by the spec)

Quick Play's limitation is not that it is quick — it is that **its players are
not people**. A quick-game roster row is `{ id, name, strokes }`
(`DraftPlayerRow`, `quickGame.ts:205`) — an ad-hoc string, not a `users` row.

So "make Quick Play shared" decomposes into:

1. A server home for `QuickGameState` — a new table + router + RLS, or a
   mapping onto `games`/`score_entries` (which requires a container, i.e. back
   to Option A or B).
2. **An identity model** — replacing `DraftPlayerRow.id` with real `users` ids,
   which means the email lookup, the placeholder path, and per-person
   permissions. That is precisely the layer trips already supply.
3. Roughly 1,772 lines of Quick Play's own surface (`page.tsx` 826 +
   `quickGame.ts` 946) rewritten around a server round-trip that currently
   doesn't exist anywhere in it.

**Item 2 is the whole cost of the feature**, and Quick Play contributes nothing
to it. Investing there buys the format work — which is already done and already
shared — and leaves the actual problem untouched. That is why it is not the
recommendation, and the reason is the identity model, not that Option A looks
cheap.

---

## 7 · The two options, costed

### Option A — the trip shim

**Migration required: none.**

#### Walking skeleton — one shareable stroke game, end to end

| # | Step | Mechanism | New code |
|---|---|---|---|
| 1 | Create the container | `trips.create({ id, title })` — existing, unmodified | none |
| 2 | Add players | `ghostCrew.create({ tripId, name, email? })` per person — existing, unmodified; handles account-match and placeholder in one call | none |
| 3 | Open the game | redirect to `/trips/{shimId}/games/new` — existing route, existing `StrokeGameView`, existing `GameStandaloneHeader` | none |
| 4 | Score it | existing RLS: creator is Owner, members score their own units once scoring is on | none |

**Walking skeleton = 1 new client file** (a form that calls three existing
procedures and navigates). **0 modified files. 0 migrations. 0 new server code.**

I want to be honest about how surprising that number is, so: the reason it is 1
and not 20 is that steps 1–4 are all *existing entry points that were never
composed in this order*. I have verified each procedure's input schema and guard
individually (§1.2, §4, §2.4), but **I have not run this sequence** — the spec
forbids a prototype. Treat "1 file" as a floor with high confidence in each part
and unverified end-to-end composition.

#### Full Option A (the thing you would actually ship)

| Kind | Files | Notes |
|---|---|---|
| **New** | ~4–6 | Create flow (format pick + roster + email entry), a "my games" list surface (§8.1 — this is the real one), a route for it |
| **Duplicated** | **0** | |
| **Modified** | **1–2** | `trips.list` / `DashboardClient` if shim trips must be hidden from the trip list (§8.2) |
| **Migration** | 0, **or 1** if hiding shims needs a `trips.kind` flag rather than a heuristic | |

The `1–2 modified` is the number to watch. Everything else is additive.

#### Genuinely reused vs. only looks reused

**Genuinely reused, unchanged:** all 131 files of the two closures; all 21 tRPC
procedures; all 16 RLS policies; `save_game_config`; the outbox; `configHash`;
the guest merge; the email lookup; the standalone header; both scoring engines.

**Only looks reused:** nothing, under Option A. That is the point of the shim —
it reuses by *satisfying* the existing contract rather than by generalising it.

#### The conceptual debt, stated plainly

A `trips` row that is not a trip is a lie told to every reader of that table
forever. Concretely, today, it means:

- The shim appears in `trips.list` for **every participant** (§8.2) — it returns
  every trip you are a member of, unfiltered (`trips.ts:list`).
- `/trips/{shimId}` is a real, navigable page with a setup guide, an itinerary,
  expenses, a date poll and a chat.
- Anyone querying "how many trips do we have" gets the wrong answer, and every
  future feature keyed on `trips` inherits the exception.
- `tripMembers.inviteByEmail`'s email body reads the trip `title`
  (`tripMembers.ts:558`) — an invite would name the shim.

None of that is a bug. All of it is debt, and it compounds with every feature
added to trips.

---

### Option B — nullable `trip_id`

**Migration required: yes — 2.** One to drop the constraint (`ALTER TABLE
public.games ALTER COLUMN trip_id DROP NOT NULL`), and one to give a trip-less
game an owner, because **`games` has no owner column today** (see the RLS row
below). **Not** `competitions.trip_id`: stroke and match need no competition row
(§1.4), so costing that in would be costing work this ask does not need.

#### What has to change

| Layer | Count | Detail |
|---|---|---|
| **RLS policies** | **16** | The 8 core tables × select/write (§1.4). Each needs a second arm; each is a security-critical rewrite that `tsc` cannot check. |
| **Middleware** | **3 factories + 1 fn** | `requireTripMember` (`middleware.ts:25`), `requireTripRole` (:57), `requireGameEdit` (:287), `requireGameRunAction` (:318), plus `canEditGame` (:253, which calls `resolveCompetitionRole(ctx, tripId)`). All parse `z.object({ tripId: z.string() })` from raw input and **hard-fail without it**. |
| **tRPC procedures** | **~49** | `games` 30/31, `matches` 10/10, `matchOutcomes` 3/3, `scores` 3/3, `playGroups` 3/3 — every one takes `tripId` and most also `.eq("trip_id", ctx.tripId)` (40 such filters in these five routers). |
| **RPC** | **1, 952 lines** | `save_game_config(p_trip_id, p_game_id, p_payload)` matches `WHERE id = p_game_id AND trip_id = p_trip_id` in 4 places and derives its authority from `has_trip_role(v_trip_id, …)` (`172_matches_decided_message.sql:96-106`). |
| **Client files** | **35 / 11,347 lines** | Listed in §7.1. Either modified in place (touches the trip app) or duplicated (the permitted answer). |
| **Routing** | **2 helpers + a guard** | `gameHref` builds `/trips/${tripId}/…` for every format (`gameRoutes.ts`); `TripIdProvider`'s `useTripId()` **throws** outside the provider; `TripIdProvider.test.ts` holds two source guards that fail the build on `useParams().tripId` and on trip URLs built from anything but `.id`. |

#### Walking skeleton for Option B

Materially larger, because there is no partial version — a game whose
`trip_id` is null is invisible to `games_select` until that policy has its second
arm, and unreadable by `games.getById` until the middleware has its second path.

Minimum: 1 migration + 2 policies (`games_select`, `games_write`) + 1 middleware
path + `games.getById`/`games.create` + a new route + a `TripIdProvider`
replacement. That gets you a game row you can open — **and nothing you can score
yet**, because scoring adds `score_entries` ×2, `game_participants` ×2,
`play_groups` ×2 and `save_game_config`. Realistically the skeleton is
**~10 policies, ~10 procedures, the migration, and the provider change** before
one hole can be entered.

#### Duplication does not shrink Option B

Zach's "duplication is acceptable" makes the *client* half cheap — fork the 35
files and never touch the originals. It does **not** help the server half: an
RLS policy is a single named object per table, and a second `games_select` is not
a fork, it is a rewrite of the live one. Same for the middleware and
`save_game_config`. **So the risk in Option B is concentrated in exactly the part
duplication cannot isolate.**

#### Is it reusable for the Circle pivot?

**Mostly yes, and this is Option B's real argument.** The 16 policies, the
middleware second path and the `save_game_config` change are all "a game can
belong to a container that is not a trip" — which is the Circle pivot's central
premise. If Circles ship, that work is spent once, not twice.

The parts that would **not** carry over: the standalone route/shell (Circles
would have their own), and whatever ad-hoc ownership model gets bolted onto games
in the absence of Circle's real one — that is throwaway by construction, and it
is the piece most likely to be rushed.

**Unconfirmed:** whether the Circle pivot is still intended, on what horizon, and
whether its container model would want `games.trip_id` nullable or a polymorphic
`container_id`/`container_type`. I found `trips.circle_id` (migration 024) and
the thin `circle_events`/`circle_courses` stubs, but no design document in the
repo that settles the shape. If Circles are near, that changes this comparison
materially and I cannot see far enough to say.

### 7.1 The 35 trip-coupled files (Option B's duplicate-or-modify set)

```
src/components/TripIdProvider.tsx
src/components/competition/CompetitionGamesPanel.tsx
src/components/competition/GamePageHeader.tsx
src/components/competition/GameRow.tsx
src/components/games/DelegatePicker.tsx
src/components/games/GameChrome.tsx
src/components/games/GameChromeActions.tsx
src/components/games/GameDangerZone.tsx
src/components/games/GameIdentityHeader.tsx
src/components/games/GameRulesSheet.tsx
src/components/games/GameSettingsPage.tsx
src/components/games/GameSetupRows.tsx
src/components/games/MatchGameView.tsx
src/components/games/MemberNotReady.tsx
src/components/games/ScorecardPreviewSheet.tsx
src/components/games/SetupPlaceholder.tsx
src/components/games/StrokeGameView.tsx
src/components/games/course/CourseRowContent.tsx
src/components/games/matchSetup/MatchSetup.tsx
src/hooks/useConfigDraft.ts
src/hooks/useConfigSync.ts
src/hooks/useExitToBoard.ts
src/hooks/useGameCorrection.ts
src/hooks/useGameEditAccess.ts
src/hooks/useGameFinalize.ts
src/hooks/useOutcomeSaver.ts
src/hooks/useRealtimeGame.ts
src/hooks/useRealtimeMembers.ts
src/hooks/useRealtimeScoreEvents.ts
src/hooks/useScoreSaver.ts
src/hooks/useScorecardTeeRows.ts
src/lib/gameConfigHash.ts
src/lib/gameRoutes.ts
src/lib/gameRulesInvalidation.ts
src/lib/invalidationCoalescer.ts
```

---

## 8 · What breaks that isn't obvious

These apply to **both** options unless stated. The first is the important one.

### 8.1 Nothing in the app lists a competition-free game

Every surface that shows games filters on a competition:

- `competitionLeaderboard.ts:128` reads `from("games")` `.eq("competition_id", competitionId)`.
- `CompetitionSettingsModal.tsx:221` — `allGames.filter(g => g.competition_id === competition.id)`.
- `ScheduleTab.tsx:537` — `g.competition_id === competition?.id`.
- `games.listByTrip` returns everything, but its three consumers all filter as above.

I searched for a query selecting `competition_id IS NULL` games and for a UI
consuming `listByTrip` unfiltered. **There is none.**

So a competition-free game is reachable **only by URL** today. CLAUDE.md #20
states standalone games are "~40% of prod" — if that is right, ~40% of
production games have no surface listing them, which is itself worth a look.
(That percentage is **unconfirmed**: it is a doc claim and I have no prod access
from this session.)

**Consequence for the ask: "shared with the people playing" requires a new list
surface under either option.** It is the single largest piece of genuinely new
work in Option A, and it is invisible from the option's framing.

### 8.2 The shim trip appears in every participant's trip list

`trips.list` (`trips.ts`) returns every trip you hold a `trip_members` row for,
with no filter. A shim would sit on the dashboard next to real trips — as an
"idea"-stage trip with no dates and no destination — for everyone added to it.

Hiding it needs either a `trips.kind`/`is_container` column (a migration, and
then a filter in `trips.list` + `DashboardClient` + anything else reading that
list) or a heuristic (fragile — "a trip with no dates" is also a real trip
someone hasn't filled in yet).

Leaving it visible is a legitimate choice. It just needs to be a choice.

### 8.3 Nobody is told they were added

`ghostCrew.create` sends no email and no push (§4) — only a best-effort Crew-chat
system line. `tripMembers.add` likewise. The only notifying path is
`inviteByEmail`, which sends an invite email naming the trip title.

So "created by a person, shared with the people playing" currently means *the
other players find out when they next open the app*. `NOTIFICATION_TYPES`
advertises an `invites` category described as *"You're invited to a trip, added
to a team, or an RSVP nudge goes out"* (`notificationTypes.ts:84`) — but I found
no `sendPush` call on the member-add path. **That is a doc/code disagreement,
reported not resolved.**

### 8.4 No live score broadcast on a competition-free game

`broadcast_score_event` early-returns when the game has no competition:

```
SELECT g.competition_id INTO v_competition_id ...
IF v_competition_id IS NULL THEN RETURN NULL;
```
(`096_broadcast_score_events.sql`, and CLAUDE.md #20 says so too.)

`useRealtimeScoreEvents` likewise returns early on a null `competitionId`
(`useRealtimeScoreEvents.ts:337`).

**But this is a latency issue, not a correctness one**, and I want to be precise
because the scary version is wrong: `scores.listByGame` carries its own
`refetchInterval: GAME_SYNC_INTERVAL_MS` (20s) in each view
(`StrokeGameView.tsx:111`), and `useRealtimeGame` covers config changes on a
`game:{gameId}` channel that has nothing to do with competitions. So scores
converge across devices within ~20s. What is lost is the sub-second push and the
competition board — neither of which a standalone game has anyway.

### 8.5 Smaller ones

- A shim trip carries a full trip **chat** (crew + planning channels). Possibly a
  feature for this use case; note that `planning` visibility exists and would be
  meaningless.
- `MatchGameView` calls `competitions.getByTrip` on mount; with no competition it
  returns `[]` and the teams/assignments queries stay `enabled: false`. Verified
  as handled, not a break — but it is a wasted round trip on every open.
- Trip **roles** are the only permission axis. A standalone game's "everyone can
  score their own card" works because members get `can_score_unit`; but the
  creator is Owner of a *trip*, which means they can also invite, rename, and
  delete things that have nothing to do with the game.

---

## 9 · Recommendation

**Option A, with the "my games" list (§8.1) treated as part of the work rather
than as a follow-up.**

The reasoning, so it can be argued with rather than just accepted:

1. **The measurement says the container is the only thing missing.** 60% of the
   surface is already trip-free; both formats already create competition-free
   games; the scoring engines, the outbox, the config hash, the standalone
   header, the guest merge and the email lookup all work as-is. The gap between
   "what exists" and "what Zach asked for" is a container and a list — not a
   feature.

2. **Option A's cost is additive; Option B's is subtractive.** Option A adds
   files. Option B rewrites 16 security policies, 3 auth middlewares and a
   952-line definer RPC that every existing game depends on. Zach's "duplication
   is acceptable" was offered to keep this away from the existing codebase — and
   Option B is the option that cannot honour it, because the server half is not
   forkable.

3. **The debt is real and it is bounded.** A `trips` row that isn't a trip is
   genuinely bad, and §7's list of what it means today is not short. But it is
   *legible* debt — one column away from being labelled, and reversible by the
   same migration Option B needs anyway. If Circles ship, an Option A shim is a
   data migration; if Option B ships and Circles don't, it is 16 rewritten
   policies maintained forever for one feature.

4. **It is the version that can be looked at soonest.** Per CLAUDE.md's
   Verification Cadence, the thing that has found the most in this codebase is
   Zach looking at a running surface. Option A puts a real, shareable game in
   front of him in a fraction of the time, and the answer to "is this the right
   shape" is worth more than either option's architecture.

**The argument against, and it is not weak:** if the Circle pivot is actually
happening, Option B is that work done early and Option A is a shim you will pay
to remove. My honest position is that I cannot see enough from this repo to
weigh that — the Circle model is three thin stubs and a nullable
`trips.circle_id`, with no design record. **If Circles are on a real horizon,
this recommendation should be re-taken with that information**, because it is the
one input that would flip it.

**Second-order suggestion, offered not costed:** whatever is decided, §8.1 (no
surface lists a competition-free game) is a live gap in the shipped app, not
just a blocker for this feature.

---

## 10 · Rules that constrained this work

Per CLAUDE.md's "when a rule blocks you" — flagged before complying, not after.

1. **The spec says "Do not file issues"; CLAUDE.md's Issue Tracking §2 says
   "Capture-at-the-source — when you scope something out of the current task,
   file it as a labelled issue *in the same session*; a report is ephemeral and
   the finding is lost when the session ends."** I followed the spec and filed
   nothing. Three findings would otherwise have been issues: §8.1 (no surface
   lists a competition-free game — `bug`), §8.3 (the `invites` notification
   category advertises a member-add push that does not exist — `bug`), and §6's
   Quick Play doc/code disagreement (`chore`). If this report is not acted on,
   those three go with it.

2. **The spec forbids a prototype, so the Option A walking skeleton is verified
   part-by-part but not end-to-end** (§7). Running the four-step sequence once
   against a local stack would have converted "1 new file, high confidence in
   each part" into a measured fact. I did not, and the number should be read
   accordingly.

3. **No local Supabase in this session**, so every schema and policy claim comes
   from replaying `supabase/migrations/` rather than from `pg_policies` on a live
   DB. The one place this matters is noted in §1.4 (migration 029's programmatic
   `'Planner'` → `'Organizer'` rewrite is invisible to a file replay). Nothing
   else in this report depends on a policy's exact body text.

4. **Prod figures are unconfirmed.** CLAUDE.md's "~40% of prod games are
   standalone" (#20) and "18 of 23 prod games" (#25) are quoted as doc claims,
   not verified.

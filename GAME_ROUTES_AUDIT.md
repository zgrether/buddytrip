# Standalone Game Routes — Dependency Audit

**Date:** 2026-07-25 · **Base:** `main` @ `5e19a873` (clean tree, up to date with `origin/main`)

**Method:** Code is ground truth. Every claim below cites `file:line` and was read
directly, not taken from a doc. Where a `.md` claim disagreed with code, the code
won and the disagreement is recorded in §7. No file was modified; no route was
deleted; issue #695 was not built. Read-only throughout.

**Scope:** the five route files under `src/app/trips/[tripId]/games/` plus
`/quick-game` (inventory only — different class, see §1).

---

## 0 · STOP flags

### 🔴 FLAG 1 — Both merge-blocking E2E specs navigate to these routes directly, with NO `?game=`

This is a hard blocker on deletion, and it is worse than "they link there": both specs use
these routes as the **only** way they create a game.

```ts
// e2e/critical-path.spec.ts:90 — inside the merge-blocking spine test
await page.goto(`/trips/${tripId}/games/new`);
// then: click "E2E Owner", click "E2E Member", click "Start game"   (:92-94)
```

```ts
// e2e/match-play.spec.ts:123 — inside driveToSetupWithHandicap(), used by 2 of the 3 tests
await page.goto(`/trips/${tripId}/games/match/new`);
const createBtn = page.getByRole("button", { name: "Create game" });   // :124
```

Neither passes `?game=`. Both then drive a **creation** flow (§2). `critical-path.spec.ts` is
the spec `CLAUDE.md` names as the guard on "the assembled spine is reachable" — deleting
`/games/new` breaks it, and there is no other UI path that reaches the flow it tests (§3).

### 🟡 FLAG 2 — A third purpose exists beyond creation-or-view, and it is load-bearing for one route

The spec anticipated two categories. Code shows a third for `/games/scorecard`: an
explicitly-designed **cold deep-link fallback for an overlay**.

> `GameRow.tsx:33` — *"(Mirrors `openGamePanel`; the standalone `/games/scorecard` route stays as the cold deep-link fallback.)"*

`/games/scorecard` is also coupled to the game routes in a non-obvious way that would break
silently on deletion — see §3 (the `!!href` gate) and §10.

### 🟢 CLEARED — No notification or email deep-links to any of these routes

Checked exhaustively (§5). No live-BBMI dead-link risk. There is exactly **one** push send
call site in the codebase and it points at `/dashboard`. No game-related notification exists
today at all.

### 🟢 CLEARED — No security issue surfaced

These routes carry no special middleware handling (`src/middleware.ts` has no `games`
reference); they are normal authenticated trip routes gated by the standard matcher, and
`isPublicRoute` (`middleware.ts:42-49`) does not include `/trips`.

---

## 1 · Route inventory

| Path | File | Renders | `tripId` from | game id from |
|---|---|---|---|---|
| `/trips/[tripId]/games/new` | `games/new/page.tsx:11-13` | `StrokeGameView` | `useParams` inside the view (`StrokeGameView.tsx:71`) | `?game=` (`:72`), **optional** |
| `/trips/[tripId]/games/match/new` | `games/match/new/page.tsx:11-13` | `MatchGameView` | `useParams` inside the view | `?game=`, **optional** |
| `/trips/[tripId]/games/rack/new` | `games/rack/new/page.tsx:11-13` | `RackGameView` | `useParams` inside the view | `?game=`, **optional** |
| `/trips/[tripId]/games/manual` | `games/manual/page.tsx:11-13` | `NonGolfGameView` | `useParams` inside the view (`NonGolfGameView.tsx:60`) | `?game=` (`:63`), **required in practice** |
| `/trips/[tripId]/games/scorecard` | `games/scorecard/page.tsx:29-…` | *(self-contained page, not a game view)* | `useParams` + `trips.resolveSlug` (`:30,:39-43`) | `?game=` (`:33`), **required** |
| `/trips/[tripId]/games/loading.tsx` | — | Suspense fallback spinner | n/a | n/a |

All four game-view routes are **three-line thin wrappers** — no props, no data, no layout.
`games/new/page.tsx` in full:

```tsx
export default function NewGamePage() {
  return <StrokeGameView />;
}
```

**Shared layout:** `src/app/trips/[tripId]/layout.tsx` exists but is a Server Component that
does exactly one thing — prefetch `competitions.getByTrip` into a `HydrationBoundary`
(`:26-42`). It mounts **no client providers, no realtime, no chrome**. This is the only thing
these routes inherit from the trip tree (§9).

**⚠️ OUT OF SCOPE — `/quick-game`** (`src/app/quick-game/page.tsx`): verified a genuinely
different class. `grep -c "trpc"` → **0**; localStorage-backed via `STORAGE_KEY = "bt-quick-game"`
(`:13`), documented at `:16-23` as *"no DB row, no tRPC, no auth."* Not a trip route, not
affected by any decision here. **Inventory only — do not touch.**

---

## 2 · Creation vs view

The `/new` naming is misleading. What each route actually supports:

| Route | Creates? | Views? | Verdict |
|---|---|---|---|
| `games/new` (stroke) | ✅ `StrokeGameView.tsx:645-646` | ✅ `?game=` | **DUAL-MODE** |
| `games/match/new` | ✅ `MatchGameView.tsx:1035-1041` | ✅ `?game=` | **DUAL-MODE** |
| `games/rack/new` | ✅ `RackGameView.tsx:461` | ✅ `?game=` | **DUAL-MODE** |
| `games/manual` | ❌ **no `games.create` call anywhere in the file** | ✅ `?game=` | **VIEW-ONLY** |
| `games/scorecard` | ❌ | ✅ (preview only) | **VIEW-ONLY** (3rd purpose — §0 FLAG 2) |

### The finding that reframes the whole question

**Competition-game creation does not use these routes at all.** The in-app "Add a game" flow
creates the row in a **modal over the board** and never navigates:

- `CompetitionFace.tsx:262` → `onAddGame={() => setAddingGame(true)}`; `:48` — *"'Add a game' no longer routes to a panel — it opens the GameSheet modal"*
- `CompetitionGamesPanel.tsx:180-184` → `create.mutateAsync({ tripId, gameTypeId, name, competitionId, … })`
- `CompetitionGamesPanel.tsx:199-201` → `handleSave()` → `persist()` → `onClose()` — closes the modal; **no `router.push`**
- `CompetitionGamesPanel.tsx:107-110` — *"GameSheet is Add-only … this component only ever CREATES a game."*

So for the normal product flow: create in a modal → row appears on the board → tap it → opens
as a **panel** (`opensAsPanel` covers all four formats, `gameRoutes.ts:84-91`). The routes are
never entered.

### What the creation paths on these routes actually are

They are the **standalone / non-competition** creation flows, plus the E2E harness surface:

- `StrokeGameView.tsx:201` — *"kept ONLY for the standalone /games/new flow (no urlGameId, no competition/teams to build…)"*
- `src/server/routers/games.ts:795` — *"a STANDALONE stroke game (created via /games/new — no competition)"*
- `MatchGameView.tsx:1035-1041` — `handleCreate()` passes **no `competitionId`**
- `RackGameView.tsx:456-461` — `startRack()` early-returns unless `competitionId` is present (`if (!tripId || !competitionId) return;`), so rack's route-creation path requires a competition and is *not* a standalone flow

**`games/manual` is the cleanest case:** `NonGolfGameView` contains no `games.create` call at
all (verified by grep across the file). It is purely a view surface, and the panel already
does that job.

---

## 3 · Inbound references

### The live in-app path never reaches these routes

`gameHref()` (`gameRoutes.ts:23-51`) is the only URL builder, and it **requires** `gameId: string`
(`:26`) — it cannot express a not-yet-created game. Its callers:

| Site | What it does | Live? |
|---|---|---|
| `GameRow.tsx:170` | builds `href` for the row | **DEAD for all known formats** — see below |
| `GameRow.tsx:599` | builds `href` for `CompletedRow` | **DEAD for all known formats** |
| `GameRow.tsx:186` | builds `scorecardHref` | **used only as a truthiness gate** |
| `CourseRowContent.tsx:64` | builds `scorecardHref` | **used only as a truthiness gate** (`:151`, `:184`) |

**The `href` `<Link>` branches are unreachable.** In both row components the panel branch
returns first:

```tsx
// GameRow.tsx:387-401   (and identically :627-640 for CompletedRow)
if (panelFormat) { return ( <button onClick={openPanel} …> {inner} </button> ); }
if (href) { return ( <Link href={href} …> {inner} </Link> ); }   // :402-415 — unreachable
```

`panelFormat = opensAsPanel(game.gameTypeId)` (`:181`, `:603`), and `opensAsPanel` returns true
for match ∪ rack ∪ stroke ∪ manual (`gameRoutes.ts:84-91`) — i.e. **every known format**. The
`<Link href={href}>` fallback fires only for an unknown/future `gameTypeId`.

**The panel's URL is not a games route.** `openGamePanel` pushes onto the *current* pathname:

```ts
// GameRow.tsx:23-26
function openGamePanel(pathname: string, gameId: string, settings: boolean) {
  const q = `?game=${gameId}${settings ? "&settings=1" : ""}`;
  window.history.pushState(null, "", `${pathname}${q}`);
}
```

From the leaderboard that yields `/trips/{id}/leaderboard?game={gid}`. A refresh there re-lands
on the leaderboard, which re-derives the open panel — **it never lands on a games route.**

**The scorecard icon also does not navigate.** `GameRow.tsx:342` → `openScorecardOverlay(pathname, game.id)`
(defined `:35-38`, pushes `?scorecard=<id>`). `CourseRowContent.tsx:151,:184` open
`ScorecardPreviewSheet` via `setPreviewOpen(true)`.

### ⚠️ A hidden coupling that would break silently

`GameRow.tsx:201`:

```ts
const scorecardOpens = showScorecard && game.hasCourse === true && !!href;
```

The scorecard affordance is gated on `!!href` — the *game* href. Removing a format's entry from
`GAME_ROUTES` (`gameRoutes.ts:12-16`) makes `gameHref` return `null` (`:45-50`), which silently
disables the scorecard icon on the board even though the scorecard has its own overlay path.
Any deletion touching that map must address this line.

### Everything else

Only self-references remain — `StrokeGameView.tsx:656` (`router.replace(…/games/new?game=${gameId})`)
and `:815` (`router.replace(…/games/new)`), both internal to the view itself. No `<Link>`,
no redirect, no middleware rewrite, no server-side redirect, and no email/notification (§5)
targets any of these paths.

**Conclusion:** apart from the two `StrokeGameView` self-replaces, there is **no inbound
reference from application UI** to `/games/{new,match/new,rack/new,manual}`. They are reachable
by manually typed URL, by a bookmark of a URL `StrokeGameView:656` produced, or by E2E.

---

## 4 · E2E dependency

**Merge-blocking (`playwright.config.ts:32-33` — `testMatch: /(critical-path|match-play)\.spec\.ts/`):**

| Spec | Line | Navigation | Uses `?game=`? |
|---|---|---|---|
| `critical-path.spec.ts` | **:90** | `await page.goto(`/trips/${tripId}/games/new`)` | ❌ no — creation flow |
| `match-play.spec.ts` | **:123** | `await page.goto(`/trips/${tripId}/games/match/new`)` | ❌ no — creation flow |

`critical-path.spec.ts:90` sits inside the test named *"scoring spine — stroke game: create →
enter scores → scorecard reflects them"* (`:83`) and proceeds to click crew then `"Start game"`
(`:92-94`). `match-play.spec.ts:123` sits in the shared helper `driveToSetupWithHandicap()`
(`:122`), used by the two spine tests at `:275` and (transitively) `:222`.

**Both are blocked on §0 FLAG 1.** Deleting either route breaks the merge gate. Because the
in-app creation flow is the GameSheet modal (§2), these specs are currently the *only*
consumer of the route-based creation flow they exercise — so they cannot simply be repointed
at an equivalent UI path; there isn't one.

**Deferred set (13 specs, non-blocking — `playwright.config.ts:30-31` comment confirms they
"match no project, so they don't run"):** exactly one reference —

- `e2e/games-stroke-play.spec.ts:99` → `await page.goto(`/trips/${TRIP_ID}/games/new`)` (mock-based, `setupMocks(page)` at `:98`)

The other 12 deferred specs contain no reference to any of these routes.

---

## 5 · Notification / email deep links

**Push — how URLs are constructed.** `PushPayload` carries an optional `url`
(`src/server/lib/sendPush.ts:30`). The service worker stores it and opens it on click:

```js
// public/sw.js:61   data: { url: data.url || "/" },
// public/sw.js:68   const target = (event.notification.data && event.notification.data.url) || "/";
// public/sw.js:80   return self.clients.openWindow(target);
```

**Every push call site in the codebase — there is exactly one:**

- `src/server/routers/notifications.ts:138-148` — `testSend`, the self-only diagnostic, with `url: "/dashboard"` (`:144`)

No other file calls `sendPush` (grepped across `src`, excluding tests). **No game-related
notification exists today.** `notificationTypes.ts:1-21` describes the registry as feeding
"Phase 3's call sites at domain write points" — Phase 3 is not wired, and `notificationTypes.ts`
contains no URLs at all (it is labels/descriptions/preferences only).

**Email.** `src/lib/email.ts` builds exactly three URLs off `BASE_URL` (`:10`):

- `:58` and `:104` → `${BASE_URL}/trips/${tripId}`
- `:239` → `${BASE_URL}/invite?token=${token}`

`grep "games/" src/lib/email.ts` → **no match**.

**Verdict: no notification or email deep-links to any route in scope.** No dead-link risk
during BBMI from deleting them.

---

## 6 · Standalone-only support code

This is the complexity the routes cost. `GameChrome` uses **provider presence** as the
panel/standalone discriminator:

> `GameChrome.tsx:17-21` — *"Provider presence ALSO tells a game view it's hosted as a PANEL (under TopNav) vs. on its own standalone route (no TopNav): `useInGamePanel()`. In a panel the view suppresses its own header and publishes here; on a standalone route (no provider) it keeps rendering its header as before, so deep-links don't lose their chrome."*

`useInGamePanel()` is defined at `GameChrome.tsx:62`. The standalone case is what every
`!inPanel` / `inPanel ? … : …` branch below exists to serve — **~35 branch points across the
four views**, all of which collapse to a constant if the routes go away:

| File | `inPanel` sites | Notable standalone-only branches |
|---|---|---|
| `MatchGameView.tsx` | `:1319, 1333, 1452, 1462, 1489, 1526, 1529` | `:1529 {!inPanel && (…own header…)}`; `:1452` `fixed inset-0 z-50` vs `absolute inset-0`; `:1526` `100vh` vs `100%` |
| `RackGameView.tsx` | `:693, 697, 723, 785, 792, 793, 795, 964, 970, 1004, 1047` | 6 × `<Shell hideHeader={inPanel}>`; `:793` height switch |
| `StrokeGameView.tsx` | `:745, 747, 830, 832, 1094, 1113, 1119, 1157` | `:832 {!inPanel && (…own header…)}`; 3 × positioning switch |
| `NonGolfGameView.tsx` | `:276, 278, 291, 370, 399` | `:291` — `const header = (title) => inPanel ? null : (…)`, an entire header factory that exists only for standalone |

Plus:

- the `hideHeader` prop threaded through `Shell` and the entry components purely to carry this distinction
- `src/app/trips/[tripId]/games/loading.tsx` — a route-level Suspense fallback whose docstring (`:4-12`) describes a problem specific to route navigation ("tapping a game from the leaderboard used to leave the PREVIOUS screen frozen"), which the panel idiom does not have
- the 4 thin wrapper `page.tsx` files themselves

**Also relevant:** the 4 documented-exception `tripMembers.list` call sites from F8
(`useTripRole.ts:11-24`, `GameIdentityHeader.tsx:76-82`, `TeamsPanel.tsx:324-329` and `:1320-1327`)
carry comments that exist **only** because these routes exist. They would be deletable too —
which is exactly why issue #695 should not be built before this decision (§10).

---

## 7 · Doc drift found

| # | Doc / comment claim | Code | Verdict |
|---|---|---|---|
| 1 | `NAV_AUDIT.md:32-33` (2026-06-13) — the affected routes are **creation** routes | `games/manual` has **no** `games.create` call at all (§2); the other three are dual-mode, not creation-only; and competition-game creation happens in `GameSheet` (`CompetitionGamesPanel.tsx:180-184`), never on a route | **STALE / MISLEADING.** The framing "these are creation routes" is wrong in both directions. |
| 2 | `CLAUDE.md` #12 + all four route docstrings (e.g. `games/new/page.tsx:7-9`) — *"Deep-links / direct URLs / refresh land here"* | Panel URLs are `${pathname}?game=` off the **leaderboard** (`GameRow.tsx:23-26`), so a refresh lands on `/trips/{id}/leaderboard`, not a games route. Only `StrokeGameView.tsx:656`'s `router.replace` ever puts a games-route URL in the address bar. | **MOSTLY FALSE.** True only for the narrow stroke-standalone case. |
| 3 | `GameRow.tsx:180-181` — *"STROKE still navigates via `href` below (its full-screen-overlay re-host is a separate phase)"* | `opensAsPanel` includes `isStrokeFormat` (`gameRoutes.ts:88`); stroke panels like everything else | **STALE COMMENT** — Phase 3 landed and the comment wasn't updated. |
| 4 | `GameRow.tsx:385-386` — *"Stroke keeps the route `<Link>` below"* | Same as #3 — unreachable for stroke | **STALE COMMENT** |
| 5 | `GameRow.tsx:602-603` — *"Stroke keeps the route `<Link>`."* | Same as #3 | **STALE COMMENT** |
| 6 | `gameRoutes.ts:78-83` — describes the panel set as *"match play + rack + non-golf + stroke. As of Phase 3 that's every known format"* | Accurate | **TRUE** (recorded because it directly contradicts #3–#5 in the same codebase) |
| 7 | `CLAUDE.md` Reuse targets — *"Scorecard = a `Sheet` overlay …, not a full-page route"* | Both exist: the overlay (`GameRow.tsx:342`, `CourseRowContent.tsx:151`) **and** the full-page route (`games/scorecard/page.tsx`), the latter deliberately retained as the "cold deep-link fallback" (`GameRow.tsx:33`) | **INCOMPLETE, not wrong.** The rule states the in-app default but omits the deliberate route fallback. |
| 8 | `CLAUDE.md` #7 — Quick Game is localStorage-backed, no tRPC | `grep -c trpc src/app/quick-game/page.tsx` → 0; `STORAGE_KEY` at `:13` | **TRUE** |

Per the spec, none of these were fixed — recorded only.

---

## 8 · What creation requires

**Is a row inserted up front or only at the end?** **Only at the end**, in every case — the
user configures first, then one `games.create` fires:

- `StrokeGameView.tsx:645-646` — `const gameId = urlGameId ?? (await createGame.mutateAsync({ tripId, gameTypeId: STROKE_PLAY })).id;` — fires from the "Start game" handler after roster selection
- `MatchGameView.tsx:1035-1041` — `handleCreate()` fires from the "Create game" button
- `RackGameView.tsx:456-461` — `startRack()` creates then applies the course

There is **no draft/pending row**. Before that call there is no id and no DB state — only React
state (roster selection, chosen course, tee time).

**Once a row exists, does it have an id that `?game=` could open?** Yes — but the three views
handle it *inconsistently*, which matters:

| View | Post-create | Id in URL? | Refresh-survivable? |
|---|---|---|---|
| `StrokeGameView` | `router.replace(`/trips/${param}/games/new?game=${gameId}`)` (`:656`) | ✅ yes | ✅ yes |
| `MatchGameView` | `setGameId(g.id)` (`:1042`) | ❌ React state only | ❌ **no** |
| `RackGameView` | `setGameId(gameId)` (`:472`) | ❌ React state only | ❌ **no** |

So stroke already demonstrates the pattern a panel migration would need (create → put the id
in the URL → the surface is now id-addressable). Match and rack would each need that step added.

**What creation needs that the panel idiom currently can't express:**

1. **An id-less entry point.** `gameHref` mandates `gameId: string` (`gameRoutes.ts:26`) and
   `openGamePanel` interpolates `?game=${gameId}` (`GameRow.tsx:24`). Neither can address a
   game that doesn't exist. A panel host keyed on `?game=<id>` has nothing to key on.
2. **A host that renders with no board row to open from.** The panel is opened *by* a
   `GameRow` for an existing game (`GameRow.tsx:182`). Creation has no row yet.
3. **A full-screen surface with no trip page underneath** — currently expressed by the
   `!inPanel` branches (§6): `fixed inset-0 z-50` and `minHeight: 100vh` instead of
   `absolute inset-0` / `100%`.
4. **Its own header and back-target.** On a standalone route there is no `TopNav` to publish
   chrome to, so each view renders its own header (`MatchGameView.tsx:1529`,
   `StrokeGameView.tsx:832`, `NonGolfGameView.tsx:291`) with `router.back()`.
5. **Deep-linkability of the in-progress state** — only stroke has this today (`:656`), and
   only after the row exists.

**Does `opensAsPanel` have any concept of a not-yet-created game?** **No.** It is a pure
`gameTypeId → boolean` predicate (`gameRoutes.ts:84-91`) with no id parameter and no "new"
state. Nothing in `gameRoutes.ts` models a pre-creation game.

*Requirements only — no design proposed, per the spec.*

---

## 9 · What the trip page mounts that these routes lack

> **Dual purpose.** This section was originally specced as a bug inventory ("what does
> the trip page mount that these routes lack"). It is also a **migration checklist**: if
> games become standalone entities that a trip points at, every row in the table below has
> to be classified **trip-scoped** (stays with the trip) or **entity-scoped** (moves to the
> game/competition). The `Scope` column records that classification; §14 consolidates the
> ones that block a trip-less game.

**Both premises confirmed:**

**(a) No `CompetitionLeaderboard` mounts on these routes.** Its single mount site is
`CompetitionFace.tsx:250`. What the game views *do* mount is `GamePageHeader`
(`MatchGameView.tsx:1550`, `RackGameView.tsx:1065`, `NonGolfGameView.tsx:410` — stroke does
**not** mount it), which reads `competitions.leaderboard`. That is precisely the F4 bug: on a
standalone route `GamePageHeader` was the *only* observer on that key, so its
`staleTime: Infinity` froze standings with no 30 s poll to mask it.

**(b) `useRealtimeMembers` mounts in exactly two places** — `page.tsx:149` and
`LiveFaceClient.tsx:62`. Confirmed by grep across all `.ts`/`.tsx`.

### The real finding — the full absent set

The shared `layout.tsx` provides only a `competitions.getByTrip` prefetch (§1). Everything
below is mounted in the trip-page tree and/or the competition-face tree, and is **absent** on
the four standalone game routes:

| # | Mounted on trip page / face | Absent on game routes | Scope (migration classification) | Consequence |
|---|---|---|---|---|
| 1 | `useRealtimeCompetition(tripId)` — `page.tsx:144`, `LiveFaceClient.tsx:61` | ❌ | **Trip-scoped** — keyed `trip_id=eq.` (`useRealtimeCompetition.ts:44,51`); would need re-keying on `competition_id` | Competition row changes (existence, name, tagline, scoreboard style) stay stale up to `staleTime`. Docstring `page.tsx:140-143` says "without this they'd see stale data for up to staleTime (60s)". |
| 2 | `useRealtimeMembers(tripId)` — `page.tsx:149`, `LiveFaceClient.tsx:62` | ❌ | **Trip-scoped** — `trip_members` is the roster relation itself (§12 IDENTITY) | **This is F8 / #695.** Role promote/demote/add/remove never invalidates `tripMembers.list`. Hits `useTripRole` → Owner/Organizer permission resolution. |
| 3 | `useRealtimeTripData(tripId)` — `page.tsx:154` | ❌ **and absent from `LiveFaceClient` too** | **Trip-scoped** — quick-info / lodging / schedule are trip-identity tables (§12) | quick-info / lodging / schedule edits don't propagate. Note this one is missing from the competition face as well — a pre-existing gap this audit surfaced incidentally. |
| 4 | `CompetitionLeaderboard` + its 30 s poll — `CompetitionFace.tsx:250`, `CompetitionLeaderboard.tsx:115` | ❌ | **Entity-scoped** — the payload is competition-derived; its tRPC input takes `tripId` only as a membership gate | **This was F4.** No other observer to keep `competitions.leaderboard` fresh. |
| 5 | `GameChromeProvider` — `LiveFaceClient.tsx:214` | ❌ (by design) | **Entity-scoped** — pure UI context, no trip dependency | `useInGamePanel()` → false, driving the ~35 standalone branches in §6. |
| 6 | `TopNav` — `page.tsx:394`, `LiveFaceClient.tsx:223` | ❌ | **Trip-scoped today** — takes `tripId` and renders trip chrome; a trip-less game needs a different bar | No app bar; each view renders its own header. Also means no chat/news/avatar affordances. |
| 7 | `TripBottomNav` — `page.tsx:554`, `LiveFaceClient.tsx:297` | ❌ | **Trip-scoped** — trip navigation by definition | No trip bottom nav. |
| 8 | `FloatingChatPanel` — `page.tsx:588`, `LiveFaceClient.tsx:248` | ❌ | **Trip-scoped today, arguably CONVENIENCE** — see `messages` in §12; a game-scoped thread would be the same object | **Chat is unreachable from a standalone game route** — and since `useRealtimeChat` mounts only inside `FloatingChatPanel` (`useChatUnreadCount`), there is no chat subscription either. |
| 9 | `NewsPanel` — `page.tsx:602`, `LiveFaceClient.tsx:262` | ❌ | **Trip-scoped** — `news_posts.trip_id` is IDENTITY (§12) | News unreachable. |
| 10 | Always-mounted trip queries: `trips.getById` (`page.tsx:82`), `ideas.list` (`:90`), `tripMembers.list` (`:91`), `datePoll.get` (`:98`), `quickInfoTiles.list` (`:101`), `schedule.list` (`:118`), `logistics.list` (`:120`), `expenses.list` (`:124`), `teams.list` (`:127`), `teamAssignments.list` (`:131`) | ❌ | **Mixed** — 8 trip-scoped; `teams.list` + `teamAssignments.list` are **entity-scoped** (competition-keyed, §12) despite taking `tripId` in their tRPC input | Any game-view code reading these keys gets a cold fetch or an empty cache instead of a warm one. |

**F4 and F8 are rows 4 and 2 of a ten-row table.** Rows 1 and 3 are the same class of latent
bug and, as far as this audit found, unreported: a competition rename or a lodging/schedule
edit made on another device will not reach anyone sitting on a standalone game route. I did not
attempt to reproduce either — flagged as unconfirmed in §11.

---

## 10 · Assessment

No deletions performed. Per route:

### `games/manual` (non-golf) — **SAFE TO DELETE**, lowest risk of the five

- No creation path: `NonGolfGameView` contains **no** `games.create` call (§2)
- No inbound UI reference: the only `href` that targets it is the dead fallback (§3)
- No E2E reference: absent from all 15 specs (§4)
- No notification/email reference (§5)
- The panel already renders `NonGolfGameView` for every real user path

Caveat: verify nothing bookmarked it; there is no in-app producer of such a URL.

### `games/rack/new` — **LOAD-BEARING (weakly)**

- Has a creation path (`RackGameView.tsx:461`) but it **requires a competition**
  (`:457` early-returns without `competitionId`), so it duplicates what `GameSheet` already does
- No E2E reference; no inbound UI reference
- Deleting it needs confirmation that `startRack`'s create branch is genuinely dead in the
  competition flow (a game created via `GameSheet` arrives with `gid` set, taking the
  `if (gid)` branch at `:459`) — **unconfirmed**, see §11

### `games/match/new` — **LOAD-BEARING**

- Merge-blocking E2E depends on it: `match-play.spec.ts:123` (§0 FLAG 1)
- Real creation path with no `competitionId` (`MatchGameView.tsx:1035-1041`) — a standalone
  match game, which `GameSheet` cannot produce
- Post-create id lives in React state only (`:1042`), so it is not yet panel-addressable

### `games/new` (stroke) — **LOAD-BEARING, hardest to remove**

- Merge-blocking E2E depends on it: `critical-path.spec.ts:90` — the spine guard (§0 FLAG 1)
- Also referenced by deferred `games-stroke-play.spec.ts:99`
- The only route with an explicitly documented standalone purpose
  (`StrokeGameView.tsx:201`, `games.ts:795`) and the only one that puts its id in the URL (`:656`)
- Carries the `resumeRoster` flow that exists solely for it

### `games/scorecard` — **BLOCKED ON DESIGN** (and a third category, §0 FLAG 2)

- Deliberately retained as the "cold deep-link fallback" (`GameRow.tsx:33`)
- Not a game view; its own self-contained page
- Coupled to the game routes through `scorecardOpens = … && !!href` (`GameRow.tsx:201`) — see
  the §3 warning

### Cross-cutting

**Deleting any route does not by itself fix rows 1–10 of §9** — a game opened *as a panel* from
the leaderboard inherits `LiveFaceClient`'s mounts, so panel-only would close rows 1, 2, 4, 5,
6, 7, 8, 9. But row 3 (`useRealtimeTripData`) is missing from the competition face too, so it
would survive.

**On issue #695:** its fix (mount `useRealtimeMembers` on the game routes) becomes unnecessary
for `games/manual` immediately, and for the others only if they are migrated. Building it now
means writing code that a migration deletes. Holding it, per the spec, is correct.

---


## 11 · Open questions for Zach

**Product decisions — yours, not mine:**

1. **Should game creation feel like a full-page flow or an overlay?** Today it is *both*
   inconsistently: competition games are created in a modal (`GameSheet`) with no full-page
   step, while the route flows are full-page steppers. This is the question that determines
   whether §8's requirements are a small change or a large one.
2. **Do standalone (non-competition) games remain a supported product concept?**
   `games.ts:795` and `StrokeGameView.tsx:201` support one today for stroke, and
   `MatchGameView.handleCreate` creates a match game with no `competitionId`. If the answer is
   no, `games/new` and `games/match/new` lose their only non-E2E justification and this becomes
   a much simpler deletion.
3. **Should chat be reachable from a game surface?** `CLAUDE.md` #13 says "chat/news/avatar
   persist (chat is reachable inside games)" — true in a panel, **false on a standalone route**
   (§9 row 8). If that rule is a real requirement, the standalone routes violate it today.
4. **Is `/games/scorecard`'s cold-deep-link fallback still wanted?** Nothing in-app navigates
   to it (§3). It costs a full page to serve URLs only an external bookmark would produce.

**Unconfirmed — could not settle from code:**

5. **Is `RackGameView.startRack`'s create branch (`:461`) reachable at all?** Every competition
   path arrives with `gid` already set. I could not construct a reachable case for the
   `else` branch and did not want to assert it is dead.
6. **Are §9 rows 1 and 3 (`useRealtimeCompetition`, `useRealtimeTripData`) live bugs?** They
   are structurally absent on these routes by the same mechanism as F4/F8, but I did not
   reproduce either. Row 3 is additionally absent from the competition face, which may be its
   own finding independent of these routes.
7. **Does any external artifact deep-link to a games route?** A user who created a standalone
   stroke game got `/trips/{id}/games/new?game={gid}` in their address bar
   (`StrokeGameView.tsx:656`) and may have bookmarked or shared it. Not determinable from code.
8. **Would repointing the two merge-blocking specs at the `GameSheet` flow preserve their
   coverage?** They currently test route-based creation end to end. Whether a modal-based
   equivalent tests the same spine is a judgement call about what those specs are *for*.

### Added by the entity-boundary addendum (§12–§14)

**Product decisions — yours:**

9. **Should a competition also be able to exist without a trip?** §14 Tier 2 #4 shows
   competitions inherit the same blocker (`resolveCompetitionRole` derives from the trip role,
   `middleware.ts:124-128`), so "standalone game" and "standalone competition" are the same
   permissions problem. Whether both are in scope changes the size of the work substantially.
10. **For a trip-less game, what replaces `trip_members` as the authorization root?** This is
    the design question §14 Tier 1 #2 hands you, and I deliberately did not answer it (the
    addendum forbids designing the model). The candidates visible in code are: promote
    `game_participants` to carry a role, promote `game_delegates` to a full role table, or
    introduce a new per-entity membership relation. Each has different consequences for
    `merge_guest_to_real_user` (§13.4).
11. **Does chat follow the game, the competition, or stay with the trip?** §12 classifies
    `messages.trip_id` as CONVENIENCE on the evidence of the existing `channel`/`team_id`
    generalisation — but the Organizers-chat visibility rules and the `chat_visible_from` /
    `planning_visible_from` floors live on `trip_members`, so the column and its rules would
    not move together.

**Unconfirmed — could not settle from code:**

12. **Is it deliberate that `merge_guest_to_real_user` does not reassign
    `game_delegates.user_id`?** It reassigns 15 other user-bearing columns including
    `game_participants.user_id` (`078:58`) and `score_entries.submitted_by` (`:63`), but
    `game_delegates` is absent. Either a guest is never intended to hold a delegate grant, or
    this is a gap. To decide I'd need to know whether the invite flow can grant a delegate to a
    not-yet-real user. **Recording as unconfirmed rather than calling it a bug.**
13. **Would a trip-less game's RLS actually deny, or error?** §14 Tier 1 #2 states the expected
    outcome is "every row invisible" because `is_trip_member(NULL)` returns false. I reasoned
    this from the function bodies (`SELECT EXISTS (… WHERE trip_id = p_trip_id …)`) rather than
    testing it, because `games.trip_id` is NOT NULL so the state is not currently constructible.
    To confirm I'd need a scratch DB with the constraint relaxed — out of scope for a read-only
    audit.
14. ~~**Are there RLS policies on trip-scoped tables that also gate game data?**~~
    **RESOLVED — checked, and the answer widened §14.** `teams`, `team_assignments`,
    `competitions`, `messages` and `chat_reads` policies all reach through to
    `is_trip_member` / `has_trip_role` (bodies quoted in §13.1a). `teams` and
    `team_assignments` do it *via* `competitions.trip_id`, so the same
    entity-columns/trip-authorization asymmetry as `score_entries` holds one level up. Folded
    into §14 Tier 1 #2. Remaining scope limit: I did not enumerate policies on the 12 pure
    trip-feature tables (`ideas`, `expenses`, `date_polls`, …) — they are IDENTITY-classified
    (§12) so trip-rooted authorization is correct there by definition, not a finding.

---

## 12 · `trip_id` columns — identity vs convenience

**Method:** the column list is from the **live local schema**
(`information_schema.columns` over `public` BASE TABLEs), not from migration files — so it
reflects what actually exists after 94 migrations. Classification test applied per table:
*"does this row still make sense for a game that has no trip?"*

### The headline

**17 tables carry `trip_id`. Not one of them is in the game subtree.** Every game-child
table keys on `game_id` alone — no `trip_id` column anywhere among
`score_entries`, `game_participants`, `game_delegates`, `game_matches`, `game_results`,
`play_groups`, `match_hole_outcomes`. The data model is **already entity-scoped below `games`**.

The trip coupling is concentrated in exactly **three** structural columns —
`games.trip_id` (NOT NULL), `competitions.trip_id` (NOT NULL), and `messages.trip_id`
(NOT NULL) — plus the trip's own feature tables.

### Classification

| Table | Column | Class | Justification | Added by |
|---|---|---|---|---|
| `trip_members` | `trip_id` | **IDENTITY** | It *is* the trip↔person relation. Meaningless without a trip. | `001_initial_schema` |
| `ideas` | `trip_id` | **IDENTITY** | A destination idea is a proposal *for a trip*. | `001` |
| `idea_votes` | `trip_id` | **IDENTITY** | Vote on a trip's idea. (Also carries `user_id`; no game meaning.) | `001` |
| `idea_lodging_options` | `trip_id` | **IDENTITY** | Lodging option for a trip. | `001` |
| `date_polls` | `trip_id` | **IDENTITY** | "When shall we go" — a trip question. | `001` |
| `date_windows` | `trip_id` | **IDENTITY** | Candidate date range for a trip. | `001` |
| `schedule_items` | `trip_id` | **IDENTITY** | Itinerary entry for a trip. | `001` |
| `logistics_items` | `trip_id` | **IDENTITY** | Travel legs for a trip. | `001` |
| `expenses` | `trip_id` | **IDENTITY** | Settlement is scoped to the trip. | `001` |
| `quick_info_tiles` | `trip_id` | **IDENTITY** | Door codes / WiFi for the trip's lodging. | `001` |
| `invites` | `trip_id` | **IDENTITY** | An invite *to a trip*. (Would need a sibling to invite to a bare game — see §14.) | `001` |
| `news_posts` | `trip_id` | **IDENTITY** | Trip Board announcements. | `022_news_posts` |
| `news_reads` | `trip_id` | **IDENTITY** | Per-user read mark on the trip board. | `022_news_posts` |
| `competitions` | `trip_id` | **CONVENIENCE** | A cup is a container of games with teams and a scoring model. Nothing in its own columns needs a trip — `trip_id` is how it's *found* (`competitions.getByTrip`), not what it *is*. A trip-less cup is coherent. | `001` |
| `games` | `trip_id` | **CONVENIENCE** ⚠️ | The load-bearing one. `competition_id` is **nullable**, so a game already exists independently of a competition — but `trip_id` is **NOT NULL**, so it cannot exist independently of a trip. Nothing in a game's own columns (type, status, course, config, modifiers, scorecard schema, points) requires a trip. | `033_competition_engine_slice_a_spine` |
| `messages` | `trip_id` | **CONVENIENCE** | See the reasoned case below. | `001` |
| `chat_reads` | `trip_id` | **CONVENIENCE** | Follows `messages` — a per-user read mark on whatever the thread is attached to. | `010_chat_reads` |

Note the provenance signal the spec asked for: every IDENTITY column came from
`001_initial_schema` or a feature-specific migration for a trip feature. `games.trip_id`
arrived later, in `033`, when the competition engine was grafted onto the existing trip —
consistent with "a trip was the only container that existed."

### The four cases reasoned explicitly

**`score_entries` — the clean signal, and it confirms the boundary.**
Full shape: `id, game_id, participant_id, participant_type, unit_label, value, annotations,
submitted_by, submitted_at`. **No `trip_id`.** FKs go to `games(id)` and `users(id)` only.
The UNIQUE constraint is `(game_id, participant_id, unit_label)` — the identity of a score is
*game × person × hole*, exactly as `CLAUDE.md` states ("scores anchor to the person").
`participant_type` is `'user' | 'play_group'`, so even the "who" is game-local.
**Nothing about a score needs a trip.** Verdict: the entity boundary belongs at `games`.

**⚠️ But the RLS policy disagrees with the column.** `score_entries_select` and
`score_entries_write` both reach *through* the game to the trip:

```sql
EXISTS (SELECT 1 FROM games g
        WHERE g.id = score_entries.game_id
          AND is_trip_member(g.trip_id) AND (…has_trip_role(g.trip_id,…) OR is_game_delegate(g.id)…))
```

So the column layer is trip-free while the authorization layer is entirely trip-rooted. This
gap is the single biggest finding of the addendum and is §14's #1.

**`trip_members` vs `game_participants` vs `game_delegates` — three different objects, not one relation at three scopes.**

| | `trip_members` | `game_participants` | `game_delegates` |
|---|---|---|---|
| Key | `(trip_id, user_id)` | UNIQUE `(game_id, user_id)` | `(game_id, user_id)` |
| Carries | `role`, `status`, travel fields, `nickname`, `chat_visible_from`, `planning_visible_from`, `email_count`, … | `play_group_id`, `team_id`, `handicap_strokes` | grant only (`granted_by`, `created_at`) |
| Semantics | **membership + role + trip-local profile** | **who is playing, and their competitive position** | **a permission grant** |

They are genuinely different: `trip_members` is *membership and authorization*,
`game_participants` is *lineup and handicap*, `game_delegates` is *a capability grant*. The
overlap is only that all three are (container, person) pairs.

**Does `game_participants` require a `trip_members` row?** **Not by FK.** The FK is
`game_participants_user_id_fkey → users(id)` — it points at the global user table, not at
`trip_members`. So at the schema level you can already add a participant who is not a trip
member. It is enforced **only by RLS, and only transitively**: `game_participants_select`
requires `is_trip_member(g.trip_id)` *of the reader*, and `game_participants_write` requires
`has_trip_role(g.trip_id, ['Owner','Organizer'])` *of the writer* — neither constrains the
*subject* `user_id`. So: **no FK, no direct RLS constraint on the participant themselves —
convention plus the roster-picker UI only.** That is favourable for an invite-built roster on a
trip-less game.

**`team_assignments` — keyed on competition, not trip.** Columns: `competition_id`, `user_id`,
`team_id`, `is_captain`, `sort_order`. **No `trip_id`.** `teams` likewise carries
`competition_id` only. So teams and their rosters are **already competition-scoped in the
data model**. The app layer disagrees cosmetically: `teamAssignments.list` takes
`{ tripId, competitionId }` in its tRPC input (used at `useCanEditTeam.ts:66-69` and
`TeamsPanel.tsx:1324`) — the `tripId` is a membership gate, not a lookup key. Verdict:
**entity-scoped already**; the `tripId` in the procedure input is convenience.

⚠️ **But — same asymmetry as `score_entries`, one level up.** Their RLS reaches through
`competitions.trip_id`:

```sql
-- team_assignments_select
EXISTS (SELECT 1 FROM competitions c
        WHERE c.id = team_assignments.competition_id AND is_trip_member(c.trip_id))
-- teams_delete / team_assignments_update
… has_trip_role(c.trip_id, ARRAY['Owner','Organizer'])
```

So teams are competition-keyed in *columns* and trip-rooted in *authorization*. The
entity-clean data model and the trip-rooted permission model diverge at every level, not just
below `games`.

**`messages` — CONVENIENCE, and the clearest "same object at a different scope" case.**
`messages` carries `trip_id` (NOT NULL) **and** `channel ('trip'|'team')` **and** `team_id`
(nullable) **and** `visibility ('crew'|'planning')`. The presence of `channel` + `team_id`
proves the design *already* generalises the thread's owner beyond the trip — a team channel is
keyed on `team_id` and its realtime subscription filters on `team_id` alone
(`useRealtimeChat.ts:76` — *"team_id is globally unique, so it fully scopes the subscription
… without also needing trip_id"*). A game-scoped or competition-scoped thread would be the
same object with another discriminator value. `trip_id` is the container that existed, not the
identity of a message. `chat_reads` follows it.

*One caveat recorded honestly:* `messages.visibility = 'planning'` (Organizers chat) resolves
through **trip** roles, and the per-member floors `chat_visible_from` /
`planning_visible_from` live on `trip_members` (`messages.ts:85-98`). So chat's *content* is
container-agnostic while chat's *visibility rules* are trip-rooted. Reclassifying `messages`
does not by itself carry those rules across.

---

## 13 · Permission scope map

### 1 · Every resolver, and what it reads

**SQL layer (4 predicates, all `STABLE SECURITY DEFINER`):**

| Function | Reads | Scope | Trip-free? |
|---|---|---|---|
| `is_trip_member(p_trip_id)` | `trip_members` WHERE `trip_id` + `auth.uid()` | **TRIP** | ❌ |
| `has_trip_role(p_trip_id, p_roles[])` | `trip_members` WHERE `trip_id` + `auth.uid()` + `role = ANY` | **TRIP** | ❌ |
| `is_game_delegate(p_game_id)` | `game_delegates` WHERE `game_id` + `auth.uid()` | **ENTITY** | ✅ |
| `can_score_unit(p_game_id, participant_id, participant_type)` | `game_matches` ⋈ `game_participants` by `game_id` | **ENTITY** | ✅ |

**RLS policies on the game subtree — 14 policies across 7 tables, and every non-delegate one
funnels through `games.trip_id`:**

| Table | Policies | Trip-rooted? |
|---|---|---|
| `games` | `games_select` (`is_trip_member(trip_id)`), `games_write` (`has_trip_role(trip_id,…)`), `games_update_delegate` (`is_game_delegate(id)`) | 2 of 3 |
| `score_entries` | `_select`, `_write` | **both** (via `EXISTS … games g … is_trip_member(g.trip_id)`) |
| `game_participants` | `_select`, `_write`, `_delegate` | 2 of 3 |
| `game_matches` | `_select`, `_write`, `_delegate` | 2 of 3 |
| `game_results` | `_select`, `_write`, `_delegate` | 2 of 3 |
| `play_groups` | `_select`, `_write`, `_delegate` | 2 of 3 |
| `game_delegates` | `_select` (`is_trip_member(g.trip_id)`), `_write` (`has_trip_role(g.trip_id,…)`) | **both** |

The last row is worth stating plainly: **granting a game delegate is itself gated on trip
roles.** `PERMISSIONS.md` describes delegates as game-isolated — true for what a delegate *can
do*, but the grant path is trip-rooted, so the delegate scope is not self-sufficient today.

### 1a · The competition/team/chat tables reach through too

Checked in response to §11 Q14. None of these tables carries `trip_id` except `competitions`,
`messages` and `chat_reads` — yet every policy resolves to a trip predicate:

| Table | Policy | Reaches the trip via |
|---|---|---|
| `competitions` | `_select` / `_update` / `_delete` | `is_trip_member(trip_id)` · `has_trip_role(trip_id, …)` — direct |
| `teams` | `_select` / `_update` / `_delete` | `EXISTS (… competitions c … c.trip_id)` — **indirect** |
| `team_assignments` | `_select` / `_update` / `_delete` | `EXISTS (… competitions c … c.trip_id)` — **indirect** |
| `messages` | `_select` | `is_trip_member(trip_id)` **and** `is_trip_planner(trip_id)` for `visibility='planning'`; the team-channel branch joins `team_assignments ⋈ competitions` and still checks `c.trip_id = messages.trip_id` |
| `chat_reads` | `_select` / `_update` | `user_id = auth.uid()` **AND** `is_trip_member(trip_id)` |

Note `messages_select` surfaces a **fifth** trip predicate not in the four-function table above:
`is_trip_planner(trip_id)`. So the trip-rooted predicate set is five, not four.

**App layer (tRPC middleware, `src/server/middleware.ts`):**

| Guard | Line | Reads | Scope |
|---|---|---|---|
| `requireTripMember` | `:25` | `resolveTripRole` → `trip_members` | **TRIP** |
| `requireTripRole(minRole)` | `:57` | same | **TRIP** |
| `requireCompetitionRole(minRole)` | `:134` | `resolveCompetitionRole` → **maps from the trip role** (`:124-128`) | **TRIP (derived)** |
| `requireTeamIdentityEdit()` | `:184` | trip Owner **OR** `team_assignments.is_captain` | **MIXED** |
| `canEditGame(ctx, tripId, gameId)` | `:243` | competition role (→ trip) **OR** `game_delegates` | **MIXED** — takes `tripId` as a required arg |
| `requireGameEdit()` | `:277` | wraps `canEditGame` | **MIXED** |
| `requireGameRunAction()` | `:308` | wraps `canEditGame` | **MIXED** |

**Client layer (hooks):**

| Hook | Reads | Scope |
|---|---|---|
| `useTripRole(tripId)` | `tripMembers.list` → finds own row → `role` (`useTripRole.ts:11-24, 27-32`) | **TRIP** |
| `useGameEditAccess(tripId, gameId)` | `useTripRole(tripId)` **OR** `games.listOrganizers` delegate grant (`:36-52`) | **MIXED** |
| `useCanEditTeam(tripId, competitionId, teamId)` | `useTripRole(tripId).isOwner` **OR** `isTeamCaptain(...)` (`:60-79`) | **MIXED** |
| `isTeamCaptain(assignments, userId, teamId)` | pure predicate over `team_assignments` (`:16-31`) | **ENTITY** ✅ |

### 2 · Which resolvers assume a trip exists — the key output

**Cannot answer without a `tripId` (hard blockers):**

1. `is_trip_member(trip_id)` — SQL
2. `has_trip_role(trip_id, roles)` — SQL
3. `resolveTripRole` — `middleware.ts:337`
4. `requireTripMember` — `:25`
5. `requireTripRole` — `:57`
6. `resolveCompetitionRole` — `:124-128`, *derives* the competition role from the trip role, so competition permissions are trip-derived, not independent
7. `requireCompetitionRole` — `:134`
8. `useTripRole(tripId)` — the client root; **confirmed** as the spec predicted
9. **12 of the 14 game-subtree RLS policies** (every `_select` and `_write`; only the three `_delegate` policies are trip-free)

**Partially trip-free (an entity half exists, but the trip half is required to construct them):**

- `canEditGame(ctx, tripId, gameId)` — signature *mandates* `tripId` (`:243-251`), even though its delegate branch only needs `gameId`
- `useGameEditAccess(tripId, gameId)` — same shape client-side
- `useCanEditTeam(tripId, competitionId, teamId)` — `isOwner` half needs the trip
- `requireTeamIdentityEdit()`, `requireGameEdit()`, `requireGameRunAction()`

**Already trip-free (work as-is for a trip-less game):**

- `is_game_delegate(game_id)`
- `can_score_unit(game_id, …)`
- the three `*_delegate` RLS policies
- `isTeamCaptain(...)` — pure predicate

### 3 · One resolver, or many?

**Many. There is nothing shaped like `canDo(person, action, entity)`.** Counting independent
implementations that a model change would have to touch:

- **4** SQL predicate functions
- **14** RLS policies on the game subtree (plus policies on trip tables not enumerated here)
- **7** tRPC middleware guards (`middleware.ts`)
- **4** client hooks / predicates
- **26** procedures in `games.ts` alone that take `tripId: z.string()` in their input, plus **3** in `scores.ts`

The closest thing to a single resolver is `canEditGame` (`middleware.ts:243`), which `CLAUDE.md`
already treats as the one home for "can this user edit this game" — but it is game-edit only,
takes `tripId` as a required argument, and has three separate wrappers. **The count of
independent implementations is the cost of changing the model, and it is high.**

### 4 · `merge_guest_to_real_user` — every table it reassigns

Current definition: `20260713120000_078_merge_guest_reassign_scoring_tables.sql`. Per
`CLAUDE.md`, this function must stay in lockstep with the schema — so every table below is a
standing constraint on any boundary change.

**Trip-scoped (10):** `trip_members.user_id` (`:45`), `idea_votes.user_id` (`:47`),
`date_poll_votes.user_id` (`:48`), `expense_splits.user_id` (`:49`), `messages.user_id` (`:50`),
`expenses.paid_by_user_id` (`:51`), `quick_info_tiles.created_by` (`:52`), `users.created_by`
(`:53`), `invites.created_by` (`:54`) — and `team_assignments.user_id` (`:46`), which is
competition-scoped despite sitting in this group.

**Entity-scoped / game subtree (5):** `game_participants.user_id` (`:58`),
`score_entries.participant_id` where `participant_type='user'` (`:62`),
`score_entries.submitted_by` (`:63`), `game_results.entity_id` where `entity_type='user'`
(`:65`), `match_hole_outcomes.submitted_by` (`:67`).

Then `DELETE FROM users WHERE id = ghost AND is_guest = true` (`:70`).

**Observation for §14:** the function already reassigns across both scopes, so guest→real
conversion is *not* itself trip-coupled — it is person-coupled. Notably it does **not**
reassign `game_delegates.user_id`, so a guest cannot currently hold a delegate grant that
survives conversion. Whether that is deliberate is **unconfirmed** (§11).

### 5 · Realtime scoping

| Hook | Channel | Filter | Scope | Works trip-less? |
|---|---|---|---|---|
| `useRealtimeGame` | `game:{gameId}` (`:61`) | `{column}=eq.{gameId}` over `games`(id), `game_matches`, `game_participants`, `play_groups`, `game_delegates` (`:38-42, 65`) | **ENTITY** | ✅ **yes** |
| `useRealtimeChat` (team) | `team-chat:{tripId}:{teamId}` (`:75`) | `team_id=eq.{teamId}` (`:76`) | **ENTITY** (filter); trip only in the channel *name* | ✅ effectively |
| `useRealtimeChat` (trip) | `trip-chat:{tripId}` (`:71`) | `trip_id=eq.{tripId}` (`:72`) | **TRIP** | ❌ |
| `useRealtimeMembers` | `members:{tripId}` (`:37`) | `trip_id=eq.{tripId}` (`:44`) | **TRIP** | ❌ |
| `useRealtimeCompetition` | `competition:{tripId}` (`:44`) | `trip_id=eq.{tripId}` (`:51`) | **TRIP** | ❌ |
| `useRealtimeTripData` | `tripdata:{table}:{tripId}` (`:50`) | `trip_id=eq.{tripId}` over `quick_info_tiles`, `logistics_items`, `schedule_items` (`:43-45, 53`) | **TRIP** | ❌ |

**Verdict:** the game subtree's realtime is **already entity-scoped and would work unchanged**
for a trip-less game — `useRealtimeGame` is the model. `useRealtimeCompetition` is the one
trip-scoped subscription whose *subject* is arguably entity-scoped (it watches the
`competitions` table but filters on `trip_id`); re-keying it on `competition_id` looks
mechanical. The other three are genuinely trip-scoped and should stay that way.

---

## 14 · Blockers for a trip-less game

*Everything from §12 and §13 that prevents a game existing without a trip today. Ranked by how
hard it looks to move. This is a list, not a plan — no migrations proposed, no model designed.*

**The one-paragraph version:** the **data model is already almost entity-clean** — every table
below `games` keys on `game_id` alone, teams key on `competition_id`, and scores carry no
`trip_id` at all. What blocks a trip-less game is not the schema; it is (1) two NOT NULL
columns, and (2) an **authorization model that is rooted in `trip_members` end to end** — 12 of
14 game RLS policies, all 7 tRPC guards, and the client's `useTripRole` all resolve identity by
asking "what is your role on this trip?". A game with no trip has no answer to that question.

### Tier 1 — Structural, and blocks everything else

1. **`games.trip_id` is NOT NULL** (`\d games`). A game literally cannot be inserted without a
   trip. FK `games_trip_id_fkey → trips(id) ON DELETE CASCADE` — so a game is also *destroyed*
   with its trip, which is the opposite of "a trip points at a game."
   *Contrast:* `games.competition_id` **is** nullable, so game-without-competition is already a
   supported state. Only the trip link is mandatory.

2. **Authorization is trip-rooted at the DB layer — at every level, not just below `games`.**
   12 of the 14 game-subtree RLS policies call `is_trip_member(g.trip_id)` or
   `has_trip_role(g.trip_id, …)` (§13.1). And the level above behaves identically (§13.1a):
   `teams` and `team_assignments` reach the trip *indirectly* through
   `competitions.trip_id`, and `messages` adds a fifth predicate, `is_trip_planner(trip_id)`.
   With no trip these predicates have nothing to evaluate, so the correct expectation is
   **every row invisible and unwritable**, not "permissive" — a trip-less game is not merely
   unsupported, it is actively locked out. Includes `score_entries` both directions, i.e.
   **scoring itself**.

3. **`useTripRole` is the client's only identity root** (`useTripRole.ts:11-24`), and both
   `useGameEditAccess` and `useCanEditTeam` are built on top of it. Every game surface reads
   `canEdit` from `useGameEditAccess` (its own docstring calls this "the cross-cutting fix"), so
   the entire client permission surface inherits the trip assumption through one hook.

### Tier 2 — Mechanical but broad (the cost is count, not difficulty)

4. **`resolveCompetitionRole` derives competition roles *from* trip roles**
   (`middleware.ts:124-128`: Owner→owner, Organizer→co_admin, else member). So competitions have
   no independent authorization either — a trip-less *competition* is blocked by the same root
   as a trip-less game.

5. **29+ tRPC procedure inputs mandate `tripId`** — 26 in `games.ts`, 3 in `scores.ts`, plus
   `canEditGame(ctx, tripId, gameId)` (`:243`) and its 3 wrappers. Each is individually trivial;
   the volume is the cost.

6. **`competitions.trip_id` is NOT NULL** — same shape as #1, one level up.

7. **Granting a delegate is trip-gated.** `game_delegates_write` requires
   `has_trip_role(g.trip_id, ['Owner','Organizer'])`, and `game_delegates_select` requires
   `is_trip_member`. So the *one* entity-scoped permission concept cannot be administered
   without a trip.

8. **`teamAssignments.list` / `teams.list` take `tripId` in their tRPC input** even though the
   tables key on `competition_id` only (§12). Cosmetic coupling — the input is a membership gate.

### Tier 3 — Feature gaps, not blockers

9. **Chat is trip-keyed.** `messages.trip_id` NOT NULL and `trip-chat:{tripId}` filters on
   `trip_id` (§13.5). A trip-less game would have no thread. Mitigating: the team-channel
   precedent (`team_id=eq.`) shows the design already supports a non-trip owner, so this looks
   like the *most* movable of the CONVENIENCE columns. But the Organizers-chat visibility rules
   and the `chat_visible_from` / `planning_visible_from` floors live on `trip_members`
   (§12) and do not travel with the column.

10. **Invites are trip-keyed.** `invites.trip_id` NOT NULL. The addendum's premise mentions "an
    invite-built roster" for an ad-hoc game — there is no game-scoped invite concept today.
    Favourable finding: `game_participants.user_id` FKs to `users`, **not** `trip_members`
    (§12), so once a person exists they can be a participant without trip membership.

11. **No trip-less chrome.** `TopNav` and `TripBottomNav` are trip-scoped (§9 rows 6-7), and the
    game views' standalone headers (~35 `inPanel` branches, §6) assume either a trip page
    underneath or nothing at all.

12. **`useRealtimeCompetition` filters on `trip_id`** though its subject is the `competitions`
    table (§13.5) — re-keying looks mechanical.

### Explicitly NOT blockers (already entity-scoped — the good news)

- **`score_entries` has no `trip_id`.** Score identity is `(game_id, participant_id, unit_label)`.
- **`game_participants`, `game_delegates`, `game_matches`, `game_results`, `play_groups`,
  `match_hole_outcomes`** — all `game_id`-keyed, no trip column.
- **`teams` / `team_assignments`** — `competition_id`-keyed, no trip column.
- **`useRealtimeGame`** — `game:{gameId}`, entity-filtered; works unchanged.
- **`is_game_delegate()`, `can_score_unit()`, `isTeamCaptain()`** — trip-free predicates already.
- **`merge_guest_to_real_user`** — person-coupled, not trip-coupled; already spans both scopes
  (§13.4). Guest→real conversion is not a boundary blocker.
- **`games.competition_id` is nullable** — game-without-competition is already legal, so the
  "entity that a container points at" shape is half-built.

### The asymmetry worth naming

Tier 1 #2 is the whole problem in one line: **`score_entries` has no `trip_id` column, but you
cannot read or write a score without a `trip_members` row.** The same holds for teams —
`team_assignments` has no `trip_id`, yet reading one requires `is_trip_member(c.trip_id)`
through `competitions`.

The data model already put the boundary at the game (and at the competition); the permission
model never followed. **Any move toward standalone games is mostly a permissions project, not a
schema project** — two NOT NULL columns plus one authorization root, against ~19 RLS policies,
5 SQL predicates, 7 tRPC guards, 4 client hooks and ~29 procedure signatures that all answer
"who are you?" by asking the trip.

---

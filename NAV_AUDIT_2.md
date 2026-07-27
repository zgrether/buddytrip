# Navigation Audit — re-verification

> **Date:** 2026-07-27 · **Base:** `main` @ `68138d37` (clean, up to date with `origin/main`)
>
> **Method.** Code is ground truth; every claim cites `file:line` against the tree
> at that commit. Where a doc and the code disagree, the code wins and the
> disagreement is reported. Three claim types are distinguished:
> **measured** (observed in a running browser against a seeded local fixture),
> **read** (verified by reading source), and **unconfirmed** (stated as such, and
> escalated to §9).
>
> Transition costs in §6 were **measured**, not derived: a `fetch` interceptor in
> the dev browser counted tRPC procedures and RSC payload requests per navigation,
> on a seeded trip (`live-trip`) with a competition (`live-comp`) and one match-play
> game (`live-game`). Numbers below are from that run.
>
> Verdicts on the 2026-06-13 `NAV_AUDIT.md` are one of **STILL TRUE**, **FIXED**,
> **CHANGED**, or **NEVER TRUE**. `NAV_AUDIT.md` is untouched.
>
> **Scope:** read-only. No code changed. This is input to the four-tab design, not
> the design.

---

## 0 · STOP flags and headline findings

**FLAG 1 — The refactor's stated root cause (IA-1) is real, and I reproduced it.**
Tab state is `useState` (`src/app/trips/[tripId]/page.tsx:47`), `?tab=` is read once
in the initializer and **never written back**. Measured: switching Home → Crew →
Agenda left the URL at `/trips/live-trip` and `history.length` at **11 → 11 → 11**.
Pressing back from the Agenda tab landed on **Home**, not on the previous tab. This
is the "back drops me at home" mechanism, confirmed behaviourally rather than
inferred.

**FLAG 2 — The persistence boundary the refactor wants already exists, and one
transition is completely free.** Game panel → back to board cost **0 network
requests of any kind** — no RSC, no tRPC. Trip tab → trip tab cost **0** (Home→Crew)
and **1** (Crew→Agenda, a tab-owned query). Everything that crosses a *route* pays:
trip → competition face = 1 RSC + 3 procedures; competition face → trip home = 1 RSC
+ **19 procedures across 6 batches**. The refactor's job is to move the second group
into the first.

**FLAG 3 — F2 is confirmed exactly, and the refactor SUBSUMES it. Sequencing
answer: do the refactor first, do not fix F2 standalone.** Measured cold trip open =
**18 procedures in 2 serialised batches** (9 then 9) — precisely
`DATA_FRESHNESS_AUDIT.md` F2's claim. But F2 *is* a remount problem: the gate
(`page.tsx:136-138`) blocks the shell subtree from mounting. In a persistent shell
the shell never unmounts, so there is nothing for the gate to block. Fixing F2
first means designing a gate that the refactor then deletes. Detail in §6.

**FLAG 4 — IA-7 (competition behind two doors) is substantially FIXED, and the
refactor's premise should be updated.** The competition tab is gone
(`TripTabBar.tsx:14-24`); `?tab=comp` now redirects to the route
(`page.tsx:207-211`). There is ONE competition surface. The remaining problem is
different and smaller — see §1.

**FLAG 5 — One finding was NEVER TRUE, and its cited evidence pointed at unrelated
code.** IA-8 ("bottom nav present on mobile, absent on desktop"). Verified by git
archaeology against the audit-date commit. Details under §1.4 — this matters because
the four-tab design would otherwise inherit a false constraint about viewport.

**FLAG 6 — Competition CREATION lives inside the competition surface**
(`LiveFaceClient.tsx:193` → `CompetitionSetupPanel`). The proposed model ("the other
three tabs are disabled until a context is selected") cannot be applied to the
Competition tab as stated without moving creation. This is a product decision → §9.

**FLAG 7 — Three pieces of dead or stale routing infrastructure**, all of which the
refactor will touch: `GlobalBottomNav` is defined and rendered nowhere; middleware
whitelists a `/scoreboard/` route that does not exist; and the `<Link href={href}>`
board fallback is unreachable for every known game type. §2 and §8.

---

## 1 · Verdicts on `NAV_AUDIT.md`

### 1.1 The four the refactor depends on

#### IA-1 — tab state in `useState`, `?tab=` read once, never written back
**STILL TRUE** (and measured).

- State: `const [activeTabRaw, setActiveTab] = useState<TabId>(...)` —
  `src/app/trips/[tripId]/page.tsx:47`.
- `?tab=` read **once**, in the lazy initializer only —
  `page.tsx:48` (`searchParams.get("tab")`), validated against a literal list at
  `:49-59`.
- **Never written back.** No `router.replace`/`pushState` anywhere writes `tab=`.
  Live `setActiveTab` call sites are bare state setters: `page.tsx:260` (inside
  `goToTab`), `:433`, `:482`, `:531`.
- **Measured back behaviour:** on `/trips/live-trip`, Home → Crew → Agenda left the
  URL unchanged and `history.length` unchanged at 11. `history.back()` from the
  Agenda tab re-rendered the **Home** tab at the same URL.

*Where the finding is now differently shaped:* `?tab=` is written in exactly one
direction — **away**. `activeTabRaw === "comp"` triggers
`router.replace('/trips/{tripId}/leaderboard')` (`page.tsx:207-211`), and `goToTab`
intercepts `"comp"` with a `router.push` to the same route (`:255-261`). So the tab
system has one member that is a route and five that are not.

*Consequence worth recording:* `FeedbackModal` reads `?tab=` to label where the user
was (`FeedbackModal.tsx:495`, `:509-517`). Because the page never writes it, a
feedback report from any trip tab is labelled just "Trip" — the per-tab labels at
`:510-516` are unreachable. A concrete, shipped cost of IA-1.

#### IA-2 — the `/` cookie redirect skips the dashboard
**STILL TRUE.**

- `src/app/page.tsx:43-48`: reads `bt-last-trip-id` and `redirect('/trips/${lastTripId}')`.
- Falls through to `redirect('/dashboard')` only when the cookie is absent (`:54`).
- Cookie written on every trip visit — `src/app/trips/[tripId]/page.tsx:163-171`
  (localStorage + `document.cookie`, 1-year Max-Age, `Path=/`, `SameSite=Lax`).
- **What `/` does today for an authenticated user:** server-side 307 to the last
  trip; `/dashboard` only on a new device / cleared cookie. Unauthenticated → the
  marketing page (`:39-41`).

*New since the audit:* stale-pointer recovery at `page.tsx:177-184` — if the trip
errors (deleted, membership revoked) the cookie is cleared and the user is
`router.replace`'d to `/dashboard`. This closes the dead-end the old redirect could
strand a user in, but does not change the bypass itself.

#### IA-3 — "up" to the dashboard is a hardcoded forward push
**STILL TRUE.** `src/components/TopNav.tsx:155` — `onClick={() => router.push("/dashboard")}`,
`aria-label="Go to dashboard"` (`:156`). Still a forward push, not history-aware, and
still the only trip → dashboard affordance. `TripBottomNav`'s "Trip Home" stays
inside the trip and deliberately uses `router.replace` (`BottomNav.tsx:175-177`).

#### IA-7 — competition reachable behind two doors at two altitudes
**CHANGED — the two-door problem is fixed; a different, smaller one replaced it.**

The comp *tab* is retired. `TripTabBar.tsx:14-17` states it explicitly ("The
Competition tab is gone (Stage 5 cord-cut) — the competition is a face, not a tab"),
and `ALL_TABS` (`:18-24`) now holds five entries with no `comp`. Every route into the
old tab is redirected to `/trips/{tripId}/leaderboard` (`page.tsx:207-211`, `:255-261`).
There is now **one** competition surface.

What remains is an **entry-point** asymmetry, not an altitude one:

| Viewer | Competition exists | No competition |
|---|---|---|
| Owner / Organizer | `TripBottomNav` "Live" (`BottomNav.tsx:129-135`) | trip Home enable card only (`page.tsx:444`) |
| Member | `TripBottomNav` "Live" | **no door at all** |

`TripBottomNav` renders only when a competition exists (`page.tsx:553-554`), and its
"Live" item is additionally gated on `showComp` (`BottomNav.tsx:134`). So for a
member on a trip with no competition, the competition surface is unreachable from the
UI — it is URL-only. That is the shape the four-tab design has to answer (§7, §9).

### 1.2 Remaining `[IA]` findings

| # | Verdict | Evidence now |
|---|---|---|
| **IA-4** — archived-ideas back is a hardcoded `/profile` Link | **STILL TRUE** | `src/app/profile/archived-ideas/page.tsx:18-23` — `<Link href="/profile">`. Still breaks when entered from any other origin. |
| **IA-5** — archived-ideas is a route on mobile, inline panel on desktop | **STILL TRUE** | Mobile: `router.push("/profile/archived-ideas")` — `src/app/profile/page.tsx:357`. Desktop: `<ArchivedIdeasPanel />` inline — `:340` (dynamic import at `:54-57`). |
| **IA-6** — Idea Zone setup is two separate modal implementations | **STILL TRUE** | `IdeaZonePanel.tsx:1287` (`fixed inset-0 z-50 flex items-end lg:hidden`) and `:1316` (`fixed inset-0 z-50 hidden … lg:flex`). Two containers, not a reflow. *Improved:* it now has `useModalBackButton(onClose)` at `:1281`. |
| **IA-8** — bottom nav on mobile, absent on desktop | **NEVER TRUE** — see §1.4 | |
| **IA-9** — all competition nav assumes `tripId`; no standalone competition | **STILL TRUE** | No `/competitions/*` segment exists in `src/app` (full route list in §2). The only competition surface is `/trips/[tripId]/leaderboard`. |

### 1.3 `[PLATFORM]` findings

| # | Verdict | Evidence now |
|---|---|---|
| **PF-1** — back has no knowledge of tab structure | **STILL TRUE** | Measured (§1.1 IA-1). The platform half of IA-1. |
| **PF-2** — no scroll-position restoration | **STILL TRUE** | No `scrollRestoration` in `next.config.ts` or anywhere in `src`. |
| **PF-3** — no swipe-between-tabs | **STILL TRUE** | `TripTabBar.tsx` is click-only. `@dnd-kit/*` is now a dependency, but it drives drag-reorder (roster/matches), not tab paging. |
| **PF-4** — back-to-dismiss inconsistent across sheets | **CHANGED** | Adoption grew from 3 to **17** files using `useModalBackButton`. Of the four laggards named in the audit, **two no longer exist** (`CompetitionHeader.tsx`, `ScoreboardStyleChooser.tsx` — absent from the tree) and **two still lack it**: `CompetitionGamesPanel.tsx`, `TeamsPanel.tsx`. |
| **PF-5** — no swipe-to-dismiss on bottom sheets | **CHANGED (narrowed)** | Touch handlers now exist in exactly two components — `FloatingChatPanel.tsx`, `NewsPanel.tsx` (drag-resize). No other sheet has one, so the grab handle still implies an unwired gesture on the rest. |
| **PF-6** — no ESC handler in the competition overlays | **STILL TRUE** (for the survivors) | No `Escape` handling in `CompetitionGamesPanel.tsx` or `TeamsPanel.tsx`. |
| **PF-7** — no pull-to-refresh | **STILL TRUE** | No implementation; the only `overscroll` use is `TimePicker.tsx:377`. |
| **PF-8** — forward/refresh loses tab + modal state | **STILL TRUE** | Direct consequence of IA-1; measured (a fresh load of `/trips/live-trip` always renders Home). |
| **PF-9** — sheet vs centered dialog changes the dismissal idiom | **NOT RE-VERIFIED** | Structural/inherent; not re-counted this pass. → §9. |
| **PF-10** — chat/news bottom-sheet vs side-rail | **STILL TRUE** | `FloatingChatPanel.tsx` / `NewsPanel.tsx` both carry the dual model (and are the two components with touch-drag handlers). |
| **PF-11** — dynamic viewport not specially handled | **CHANGED (partly addressed)** | `dvh` is now used — `privacy/page.tsx:22`, `terms/page.tsx:22`, `DatesSheet.tsx:270,312`, `IdeaZonePanel.tsx:2079`. `viewport-fit` is still absent, and `env(safe-area-inset-bottom)` remains the mechanism in `BottomNav.tsx:153`. |

### 1.4 Never true

**IA-8 — "Bottom nav present on mobile, absent on desktop", evidence `BottomNav.tsx:13-31`.**

This was not true when it was written, and the cited lines were unrelated code.

At the audit date the newest commit touching that file was `adf94eea`. In that
revision:

- `BottomNav.tsx:13-31` was `usePublishNavHeight` — a `ResizeObserver` that publishes
  the nav's height to a CSS variable. It contains no viewport logic at all.
- Both nav elements were `className="fixed bottom-0 left-0 right-0 z-40"` (lines 77
  and 144 of that revision) — **no `lg:hidden`, no `md:hidden`**, no viewport gate.
- The render gate at `src/app/trips/[tripId]/page.tsx:543` in the contemporaneous
  revision was `{competition?.status === "active" && (<TripBottomNav … />)}` — a
  **data** gate, never a viewport one.

So the mobile/desktop split IA-8 asserts did not exist, and the evidence line range
pointed at a resize helper. Today the same is true: `BottomNav.tsx:149` is
`fixed bottom-0 left-0 right-0 z-40` with no viewport class, and I **observed the nav
rendering at an 875px-wide viewport**. The real gate is still data —
`page.tsx:553-554` (`{competition && …}`).

*Why this matters for the refactor:* a four-tab bar designed around "the bottom nav
is mobile-only" would be designed around a constraint that has never existed. The
actual constraint is that the bottom nav appears **only when a competition exists**,
on every viewport.

*Adjacent, weaker note (not a never-true):* `NAV_AUDIT.md` §1a describes
`/trips/[tripId]/leaderboard` as "only if comp `active`". That was correct at the
time (the gate above), and has since been deliberately retired — `page.tsx:549-552`
records the change. Verdict: **CHANGED**, not never true.

*Checked and cleared:* IA-1's evidence was accurate. At `79bde0c7` (the
contemporaneous `page.tsx`) the initializer was at `:46-59` as cited, and there were
eight `setActiveTab` sites at 406/416/417/455/469/492/504/530 — the audit listed
seven of the eight. Close enough to stand.

---

## 2 · Route + surface inventory (current)

Every file under `src/app`. "Reachable" = there is an in-app affordance that
navigates there; "URL-only" = it renders but nothing in the UI links to it.

### 2.1 Page routes

| Route | Kind | Renders | Reachable from UI? |
|---|---|---|---|
| `/` | Server Component, redirect gate | Marketing (unauth) or 307 (auth) — `page.tsx:33-55` | Yes (entry) |
| `/dashboard` | Full page | `DashboardClient` — `dashboard/page.tsx:5-7`, `dynamic = "force-dynamic"` | Yes — TopNav flag (`TopNav.tsx:155`) |
| `/login` | Full page | `dynamic = "force-dynamic"` | Yes (redirects) |
| `/privacy`, `/terms` | Full page | `force-static` | Yes — `SiteFooter` |
| `/invite` | Full page | token → login → auto-join | Link-only (email) |
| `/auth/reset-password` | Full page | reset form | Email link |
| `/auth/callback` | Route handler | redirect logic — `callback/route.ts:77-99` | OAuth |
| `/profile` | Full page | sidebar tabs / stacked | Yes — user menu |
| `/profile/archived-ideas` | Full page (**mobile-only**) | `ArchivedIdeasPanel` | Yes on mobile — `profile/page.tsx:357` |
| `/quick-game` | Full page | localStorage standalone game | Yes — `DashboardClient.tsx:129` |
| `/courses/new` | Full page | heavy course-entry flow | Yes — `CourseSearchPanel.tsx:90` (**from inside a game panel**) |
| `/trips/new` | Full page | trip creation | Yes — dashboard |
| `/trips/[tripId]` | Full page, **5-tab host** | `TripDetailBody` (684 lines) | Yes |
| `/trips/[tripId]/leaderboard` | Server Component → `LiveFaceClient` | **the competition face + game panel host** | Yes — `BottomNav.tsx:133`, `page.tsx:444` |
| `/trips/[tripId]/games/new` | **Thin wrapper** (13 lines) | `<StrokeGameView />` | **URL-only** (see 2.3) |
| `/trips/[tripId]/games/match/new` | **Thin wrapper** (13 lines) | `<MatchGameView />` | **URL-only** (see 2.3) |
| `/trips/[tripId]/games/rack/new` | **Thin wrapper** (13 lines) | `<RackGameView />` | **URL-only** (see 2.3) |
| `/trips/[tripId]/games/manual` | **Thin wrapper** (14 lines) | `<NonGolfGameView />` | **URL-only** (see 2.3) |
| `/trips/[tripId]/games/scorecard` | Full page (116 lines) | empty scorecard preview | **URL-only** — the board uses the overlay instead (`GameRow.tsx:342`) |

Supporting files: `src/app/layout.tsx` (root), `src/app/trips/[tripId]/layout.tsx`
(per-trip, prefetches `competitions.getByTrip`), `not-found.tsx`,
`trips/[tripId]/loading.tsx`, `trips/[tripId]/games/loading.tsx`, and five
`/api/*` route handlers.

**No `generateMetadata` exists anywhere in `src/app`** — one fewer blast-radius item
for §8.

### 2.2 Routes that no longer exist but are still referenced

- `/trips/[tripId]/events/[eventId]` — referenced by `page.tsx:41` (comment) and
  handled by `FeedbackModal.tsx:507`. No such route.
- `/changelog` — handled by `FeedbackModal.tsx:501`. No such route.
- `/scoreboard/*` — whitelisted as a public route in `src/middleware.ts:47`. No such
  route.

### 2.3 Cross-reference: `GAME_ROUTES_AUDIT.md` after #699

The prior finding — the standalone game routes have no inbound UI references and
exist for creation plus the E2E harness — **STILL HOLDS, with one part changed.**

**No inbound UI navigation.** `gameHref` (`gameRoutes.ts:22-49`) has four callers
(`GameRow.tsx:170,186,599`; `CourseRowContent.tsx:64`). But `opensAsPanel`
(`gameRoutes.ts:84-91`) returns true for *every* type `gameHref` resolves — match,
rack, stroke, manual. So in both row components the panel branch always wins
(`GameRow.tsx:387-401`, `:627-639`) and the `<Link href={href}>` fallback at `:403`
and `:640` is **unreachable for every known game type**. `href` survives only as a
predicate (`:201`, `scorecardOpens`).

*Stale comments:* `GameRow.tsx:180-181`, `:386`, and `:602` all say stroke still
navigates via the route `<Link>`. It does not — stroke was added to `opensAsPanel`.
Code wins; the comments are wrong.

**Creation** still enters the routes: `StrokeGameView.tsx:662` does
`router.replace('/trips/${param}/games/new?game=${gameId}')` after creating a
standalone stroke game, and `:821` strips `?game` on "Play again". Both are guarded
on `!urlGameId`, so they cannot fire in panel mode — but they are hardcoded route
strings inside a component that also renders as a panel (§8).

**E2E — this is the part that changed.** #699 migrated the two *spine* tests onto the
panel path (`critical-path.spec.ts:123-125`, `match-play.spec.ts:334-340` both say
"Supersedes the old standalone-route version"). But the migration was partial and
says so (`match-play.spec.ts:343-347`): `driveToSetupWithHandicap` still does
`page.goto('/trips/${tripId}/games/match/new')` (`match-play.spec.ts:172`), and its two
callers — the draft-lifecycle tests — remain. Those tests are **merge-blocking**:
`playwright.config.ts:32-33` runs the `critical-path` project against
`/(critical-path|match-play)\.spec\.ts/`.

**Net:** `/games/match/new` is load-bearing for a merge-blocking gate. The other three
game routes are reachable only by URL, refresh, or deep link. `games-stroke-play.spec.ts:99`
also uses `/games/new`, but that spec is in the deferred set no project runs.

---

## 3 · What persists across transitions

Measured on `main` @ `68138d37` against the seeded fixture. "Torn down" = the React
subtree unmounts and remounts.

| # | Transition | Route change? | React tree | Network | Already round-trip-free? |
|---|---|---|---|---|---|
| **A** | Trip tab → trip tab (Home → Crew) | **No** | **Preserved** — only the tab body swaps | **0 requests** | ✅ **yes** |
| **A′** | Trip tab → trip tab (Crew → Agenda) | **No** | **Preserved** | 1 procedure (`games.listByTrip`, tab-owned) | ✅ **yes** (no RSC) |
| **B** | Trip → competition face | **Yes** | `TripDetailBody` **torn down**; `trips/[tripId]/layout.tsx` preserved | 1 RSC + 3 procedures | ❌ no |
| **C** | Competition face → open game panel (`?game=`) | **No** (`pushState`) | **Board preserved and mounted** | 0 RSC + 9 procedures (cold game data) | ⚠️ **partly** — no route round-trip, but 9 queries |
| **D** | Game panel → back to board | **No** (`popstate`) | **Board never unmounted**; panel unmounts | **0 requests of any kind** | ✅ **yes — completely free** |
| **E** | Competition face → trip home | **Yes** | `LiveFaceClient` **torn down**; `TripDetailBody` remounted | 1 RSC + **19 procedures in 6 batches** | ❌ no |
| **F** | Trip → chat | **No** (`useState`) | **Preserved** — panel mounts in place | 0 (`FloatingChatPanel` already mounted in `TopNav`) | ✅ **yes** |
| **G** | Anything → dashboard | **Yes** | Everything below the root layout **torn down** | 1 RSC + 0 procedures (warm `trips.list`) | ❌ no |

### The boundary, stated plainly

**Already free (no route teardown): A, A′, C, D, F.** All five are driven by either
React state or the History API against the *same* route.

- Tab switches and chat are `useState` in `TripDetailBody`
  (`page.tsx:47`, `:63`, `:66`).
- The panel is `window.history.pushState` (`GameRow.tsx:25`) — Next syncs it to
  `useSearchParams` with no server round-trip, and `CompetitionFace` derives
  `panelOpen` from the param (`CompetitionFace.tsx:113,127`). The board stays mounted
  underneath, at `fixed inset-x-0 bottom-0 top-14 z-30` (`CompetitionFace.tsx:333`).
- Panel close is `history.back()` → `popstate` → the param clears. Nothing refetches.

**Not free (route teardown): B, E, G.** These are `router.push`/`replace` across App
Router segments. The `trips/[tripId]/layout.tsx` shared layout survives B and E, but
the page subtree does not — so all client state in `TripDetailBody` or
`LiveFaceClient` (active tab, chat open, scroll) is destroyed.

**The RSC cost of B and E is already mitigated but the remount is not.**
`next.config.ts:75-77` sets `experimental.staleTimes.dynamic: 300`, so within 5
minutes a warm trip↔live navigation reuses the cached RSC payload rather than
re-running the server component. That removes the *server* re-resolve; it does not
remove the React unmount/remount, which is what costs the 19 procedures in E.

**What the refactor changes:** it moves B, E, and G from the second group to the
first. D is the existence proof that the first group is achievable in this codebase —
it is the target behaviour, already shipped, for one transition.

---

## 4 · Chrome and layout ownership

### 4.1 Who owns the top bar

**`TopNav` is not in the root layout.** `src/app/layout.tsx:47-60` renders only
`Providers`, `children`, and `SiteFooter`. Every page mounts its own `TopNav`:

| Site | Call |
|---|---|
| `dashboard/DashboardClient.tsx:96` | `<TopNav title="BuddyTrip" hideNews />` |
| `profile/page.tsx:167` | `<TopNav hideTripSwitcher hideNews />` |
| `profile/archived-ideas/page.tsx:15` | `<TopNav />` |
| `trips/new/page.tsx:104` | `<TopNav />` |
| `trips/[tripId]/page.tsx:394` | `<TopNav … />` |
| `competition/LiveFaceClient.tsx:223` | `<TopNav … />` |

Not mounted at all on `/quick-game`, `/login`, `/invite`, `/courses/new`, or any
`/trips/[tripId]/games/*` route. Consequence: **there is no persistent app frame
today** — the bar is re-created per page, so "persistent" is a new property the
refactor must introduce, not preserve.

`TopNav` is `sticky top-0 z-40`, `h-14` (56px) — `TopNav.tsx:121`.

### 4.2 Who owns the bottom nav

`BottomNav.tsx` exports two components:

- **`TripBottomNav`** — rendered in two places: `trips/[tripId]/page.tsx:554` (gated
  `{competition && …}`) and `LiveFaceClient.tsx:297` via `FaceBottomNav`. Two items:
  "Trip Home" and "Live" (`BottomNav.tsx:127-136`). `fixed bottom-0 … z-40`
  (`:149`), publishes its height to `--bt-bottomnav-height` (`:13-31`).
- **`GlobalBottomNav`** — **dead code.** Defined at `BottomNav.tsx:55`; the only
  references outside its own file are in `TripTabBar.test.tsx`. Nothing renders it,
  so the dashboard has no bottom nav.

The **trip tab bar** is a third, separate thing: `TripTabBar` renders inline inside
`TripDetailBody` (`page.tsx:494-500`), not as fixed chrome, and it does **not** render
on the competition face (zero references in `LiveFaceClient.tsx` or
`CompetitionFace.tsx`). It also does not render in the idea phase at all — see §7.

### 4.3 Who can hide either

**Only `GameChrome` can hide the bottom nav**, and only on the competition face.

`GameChromeProvider` is mounted in exactly one place: `LiveFaceClient.tsx:214-287`.
So the whole context-aware-bar mechanism exists only under
`/trips/[tripId]/leaderboard`. On a standalone game route there is no provider, and
`useInGamePanel()` (`GameChrome.tsx:63-65`) returns false, so the view keeps its own
header.

The published contract (`GameChrome.tsx:24-36`) is
`{ title, onSettings?, onScorecard?, hideBottomNav? }`.

**Every `hideBottomNav` publisher** — the complete set:

| View | Line | Condition |
|---|---|---|
| `MatchGameView` | `:1372` | `screen === "score"` |
| `RackGameView` | `:735` | `!!entryGroupId` |
| `StrokeGameView` | `:765` | `!!game && scoringEnabled && !showConfig && !!entryGroupId && canScoreStroke` |
| `NonGolfGameView` | `:286` | publishes chrome, **never sets `hideBottomNav`** |

Consumed in two places: `LiveFaceClient.tsx:296` (`FaceBottomNav` returns `null`) and
`CompetitionFace.tsx:147` (`navUnderPanel` drops the panel's bottom padding).

So the surfaces a fixed tab bar must coexist with or yield to are exactly **three**:
match score entry, rack group entry, stroke group entry. All three are focused
score-entry surfaces whose exit is the app-bar back and whose primary CTA is
viewport-anchored (`CLAUDE.md` #14).

**Nothing can hide the top bar.** There is no equivalent flag; `TopNav` only *swaps*
its left zone into game mode (`TopNav.tsx:130-151`) when `useGameChrome()` is
non-null.

### 4.4 What a persistent four-tab bar would collide with

1. **The existing `TripBottomNav`** — same screen position, same `z-40`, same
   `--bt-bottomnav-height` variable that chat/FAB offsets read (`BottomNav.tsx:20`,
   `TabFab.tsx:32`).
2. **The three `hideBottomNav` surfaces above** — a fixed tab bar must either honour
   the same flag or explicitly decide that score entry keeps it.
3. **`TripTabBar`** — five *content* tabs that are a different axis from the four
   *context* tabs. Both cannot be the bottom bar; the design has to say what happens
   to Home/Crew/Lodging/Agenda/Receipts.
4. **Per-page `TopNav` mounting** — six independent mounts (4.1) must collapse to one
   for the frame to persist.
5. **`GameChromeProvider`'s single mount point** — if the shell becomes persistent,
   the provider probably has to move up with it, which changes what `useInGamePanel()`
   means (it currently distinguishes panel from standalone route purely by provider
   presence).

### 4.5 The chrome definition in force, and where the code disagrees

`STYLE_GUIDE.md:69-90` defines chrome as the persistent app frame, with **one**
surface token and border-only separation:

- **Chrome:** global top app bar (`TopNav`) with `border-bottom`; bottom navigation
  bar (`BottomNav`) with `border-top`. Token `--color-bt-card`, no shadow.
- **Not chrome (blend with page background):** page breadcrumb bar
  (`TripBreadcrumb`), trip tab bar (`TripTabBar`) — both inherit `--color-bt-base`.

**Two disagreements with the code (code wins):**

1. `TopNav` does **not** use `--color-bt-card`. It uses
   `background: var(--color-bt-nav-bg)` — a translucent value
   (`globals.css:69`, `:208`) — plus `backdropFilter: blur(14px)` and
   `borderBottom: 1px solid var(--color-bt-subtle-border)` (`TopNav.tsx:123-127`).
   `BottomNav` *does* match the guide (`--color-bt-card` + `--color-bt-border`,
   `BottomNav.tsx:151-152`).
2. `TripBreadcrumb` **does not exist** — no such file in `src/components`. The
   STYLE_GUIDE rule references a deleted component.

So the operative definition is: two elements are chrome (top bar, bottom nav), the
trip tab bar is contextual page structure, and the top bar has already diverged into
a translucent blurred treatment that the guide does not describe.

---

## 5 · History and back behaviour

### 5.1 Per transition

| Transition | History entry created | Back button does |
|---|---|---|
| **A / A′** Trip tab → trip tab | **None** (measured: `history.length` 11 → 11) | Leaves the trip entirely, and the tab resets to Home on remount |
| **B** Trip → competition face | One `push` (`BottomNav.tsx:177`) | Returns to the trip home you came from — deliberate (`BottomNav.tsx:173-174`) |
| **C** Board → game panel | One `pushState` (`GameRow.tsx:25`) | Closes the panel, board still warm |
| **D** Panel → back | Pops the `?game=` entry | — |
| **E** Face → trip home | **`replace`, not push** (`BottomNav.tsx:176`) | Deliberately does not stack a duplicate trip home; back goes to whatever preceded the face |
| **F** Trip → chat | **None** | Does **not** close the chat panel from the trip page (chat is bare `useState`, `page.tsx:63`) |
| **G** → dashboard | One `push` (`TopNav.tsx:155`) | Returns to the trip |

### 5.2 The nested-history machinery

Three cooperating layers push their own sentinels, all keyed off `popstate`:

1. **Panel level** — `GameRow.tsx:25` (`?game=`) and `:37` (`?scorecard=`), popped by
   `history.back()`; the scorecard sheet closes via `router.back()`
   (`CompetitionFace.tsx:350`).
2. **Screen level** — `useScreenHistory(depth, onBack)` (`src/hooks/useScreenHistory.ts`)
   pushes one `{btScreen: n}` sentinel per in-page screen (`:35`) and pops exactly one
   level per `popstate` (`:43-48`). Its contract is explicit: forward = grow `depth`;
   backward = call the returned `back()`, never reduce `depth` directly (`:12-19`).
3. **Settings overlay** — `useGameSettingsOverlay` pushes `{btCfg: true}`
   (`:91`, `:158`) and is the confirm-on-leave guard.

`TopNav`'s game-mode back is always `window.history.back()` (`TopNav.tsx:135`),
which is correct at every level precisely because these three listeners are stacked
(`GameChrome.tsx:9-13`).

### 5.3 The confirm-on-leave guard

`useGameSettingsOverlay` (169 lines) raises `confirmingClose` when the user tries to
leave a dirty settings overlay, and the page renders the shared
`DiscardChangesPrompt`.

The subtle parts, all load-bearing:

- **`popstate` is after the fact.** The entry is already consumed when the handler
  runs, so to *stay put* the hook re-pushes a replacement entry
  (`useGameSettingsOverlay.ts:158`, comment at `:151-157`).
- **A one-shot force flag** stops `confirmDiscard`'s own `history.back()` from being
  re-caught by the guard that raised the prompt — otherwise it loops
  (`:42-43`, `:86-90`, `:122`, `:131-132`).
- **Post-#702 the guard reads `unsavedRisk`, not `dirty`.** `useConfigDraft.ts:133`
  defines `unsavedRisk = anyTouched && (!baseline || !draftsEqual(...))`;
  `:202` wires `guardDirty = showConfig && canEdit && unsavedRisk`. The asymmetry is
  deliberate and documented at `:33-38`: *"a needless prompt costs a tap while a
  missing one destroys work"* — before the baseline freezes, divergence is unknowable,
  so leaving assumes the worst while saving stays blocked.

### 5.4 What would break if tab switches started pushing history

This is the central risk, and it is concrete:

1. **Three existing `popstate` listeners are unscoped.** `useScreenHistory.ts:43-48`
   pops a level on *any* `popstate` whose `pushed.current > 0`; `useModalBackButton`
   and `useGameSettingsOverlay:164` are the same shape. None inspects
   `event.state` to check the entry is *theirs*. A tab-switch entry popped while a
   game panel or settings overlay is open would be consumed by the wrong listener —
   the overlay would close and the tab would not change, or both would happen.
2. **The `replace`-vs-`push` asymmetry in `TripBottomNav` becomes wrong.** "Trip
   Home" uses `replace` specifically so it does not stack a duplicate
   (`BottomNav.tsx:169-177`). If tabs are history entries, "go to Trip Home" and "go
   to the Home tab" become the same operation with two different history semantics.
3. **`?tab=comp`'s redirect becomes a loop hazard.** `page.tsx:207-211` does
   `router.replace` on a tab value. If tab state is URL-driven and the URL is
   restored by a back press, the redirect fires again on every restore.
4. **The confirm-on-leave guard must learn about tabs.** Today a dirty settings
   overlay can only be left via a game-panel-level back. If a tab switch pushes
   history, the guard needs to intercept it too, or a tab tap silently discards a
   dirty draft — exactly the class #702 was fixing.
5. **`history.length` growth.** Five tabs × frequent switching produces a deep stack
   with no "up" — the Android hardware-back exit problem PF-1 already flags gets
   worse before it gets better.

The mitigation is presumably `replaceState` for tab switches (URL reflects the tab;
no entry is created), which keeps deep-linking and shareability while leaving the
history stack alone. **That is a design decision, not an audit finding → §9.**

---

## 6 · Data cost per transition, and F2

### 6.1 Measured

| Transition | RSC | tRPC batches | tRPC procedures |
|---|---|---|---|
| **Cold trip open** | (document) | **2 (serialised)** | **18** |
| A: Home → Crew | 0 | 0 | **0** |
| A′: Crew → Agenda | 0 | 1 | 1 (`games.listByTrip`) |
| B: trip → competition face | 1 | 2 | 3 (`messages.unreadCount`; `faceBootstrap`+`leaderboard`) |
| C: board → game panel | 0 | 2 | 9 |
| **D: panel → back to board** | **0** | **0** | **0** |
| E: face → trip home | 1 | 6 | **19** |
| G: trip → dashboard | 1 | 0 | 0 |

Cold-open batch composition — this is F2 made concrete:

- **Batch 1 (9, gating):** `trips.getById`, `tripMembers.list`, `ideas.list`,
  `datePoll.get`, `quickInfoTiles.list`, `competitions.getByTrip`, `schedule.list`,
  `logistics.list`, `expenses.list`.
- **Batch 2 (9, blocked behind batch 1):** `news.unreadCount`, `messages.unreadCount`,
  `users.getMe`, `notifications.status`, `trips.list`, `archivedIdeas.list`,
  `ideas.catalogList`, `teams.list`, `teamAssignments.list`.

Transition E is worth flagging on its own: at **19 procedures in 6 batches** it costs
*more* than a cold open, and it re-fetches `tripMembers.list`, `quickInfoTiles.list`,
`logistics.list` and `schedule.list` in four separate follow-up batches after the
main one. Coming *back* to the trip is the most expensive navigation in the app.

### 6.2 F2 still applies, exactly as written

`DATA_FRESHNESS_AUDIT.md` F2 cites `page.tsx:135-137` + `:215-224`. Current lines are
`:136-138` (the `dataLoading` expression) and `:216-225` (the spinner early-return) —
line drift only. The gate is 8 queries:

```
const dataLoading = isLoading || ideasLoading || membersLoading
  || competitionLoading || datePollLoading || tilesLoading
  || scheduleLoading || logisticsLoading;          // page.tsx:136-138
```

and the early return at `:216-225` means `TopNav`, `HomeTab`, `TripTabBar`,
`TripBottomNav`, chat and news cannot mount until all 8 resolve — which is why batch 2
is serialised behind batch 1. Measured 18 procedures / 2 round trips confirms the
audit's "~18 procedures across 2 batches" precisely.

### 6.3 Does the refactor subsume F2? — **Yes. Sequence the refactor first.**

F2 is not fundamentally a data-fetching bug; it is a **mount-ordering** bug that only
exists because the shell remounts.

- The gate's purpose is anti-flash, and the reason is documented in the code
  (`page.tsx:92-101`, `:111-116`): on a **trip switch** the persisted page keeps
  painting the previous trip's date-poll windows / header tiles / itinerary for a
  frame while the queries re-key. The gate makes the spinner cover that re-key window.
- That rationale is entirely about a component that **stays mounted while its
  `tripId` changes**. In a persistent four-tab shell where Home is the only context
  switcher, a trip switch is precisely the moment the shell is *told* the context
  changed — which is a first-class state transition the shell can render an explicit
  loading state for, per-region, instead of an all-or-nothing page gate.
- More directly: if the shell subtree never unmounts, there is nothing for
  `dataLoading` to block. The 2-batch serialisation is caused by the early return, and
  the early return exists only to guard a remount.

**Therefore:** fixing F2 standalone means designing a replacement gate (deciding which
of the 8 queries must block paint) that the refactor would then delete and re-decide.
The two overlap almost completely.

**Recommended sequencing:** do the four-tab refactor first and let it absorb F2, but
carry F2's anti-flash rationale forward as an explicit requirement — the cross-trip
bleed it prevents is real, and a persistent shell makes stale-context bleed *more*
likely, not less, because nothing unmounts to clear it.

**One F2-adjacent item is already fixed:** F4 (`competitions.leaderboard` cached three
incompatible ways) was resolved in #723 — all three observers now spread
`LEADERBOARD_QUERY` (`queryConfig.ts:96-98`; `CompetitionLeaderboard.tsx:117`,
`GamePageHeader.tsx:56`, `NonGolfGameView.tsx:101`). Note the now-stale comment at
`LiveFaceClient.tsx:98` still says "the leaderboard's 30s poll"; the interval is
5 minutes.

**F3 is unchanged and interacts with the refactor:** `useChatUnreadCount` is mounted
in the always-on `TopNav`, so two 50-row message pages load on every cold open. In a
persistent shell that cost is paid **once per session** instead of once per trip
open — the refactor improves F3 without addressing it.

---

## 7 · Empty and no-context states

### 7.1 What each surface renders today with no context

| Surface | No trip selected | Reachable in that state? |
|---|---|---|
| **Dashboard** (`/dashboard`) | Trip list grouped NOW/ACTIVE/IDEAS/PAST; `AuthenticatedEmptyState` when the user has no trips (`src/app/page.tsx:50-53`) | Yes — this *is* the no-context surface |
| **Trip** (`/trips/[tripId]`) | **Cannot exist without a trip** — `tripId` is a route segment. A bad/stale id errors → cookie cleared → `router.replace('/dashboard')` (`page.tsx:177-184`) | No |
| **Competition** (`/trips/[tripId]/leaderboard`) | Also requires `tripId`. With a trip but **no competition**: editors get `CompetitionSetupPanel`, everyone else `NotSetUpEmptyState` (`LiveFaceClient.tsx:189-194`) | No trip → no |
| **Chat** | Not a route — `useState` in the trip page (`page.tsx:63`) and in `LiveFaceClient.tsx:64`. Has no existence outside a trip | No |

**None of the three non-Home surfaces can currently be reached without a trip**, because
all three are either trip-route-scoped or pure in-page state. The proposed "disabled
until a context is selected" model matches how the app already behaves — the
difference is that today the tabs *don't exist* rather than being *visibly disabled*.

### 7.2 The idea phase has no tab bar at all

Worth stating separately because it is easy to miss: when a trip is in the idea phase
(`getEffectiveStatus` returns `"idea"` — `src/lib/tripStatus.ts:79`, keyed on
`locked_destination_at`), `TripDetailBody` takes a completely different branch —
`page.tsx:408`: *"Idea phase: no tab bar, no sidebar — IdeaZonePanel is the whole
page."* I confirmed this in the browser: on an idea-phase trip only the bottom nav
rendered; after setting `locked_destination_at` all five tabs appeared.

So a persistent tab bar has to decide what it shows during a phase that currently
suppresses tabs entirely.

### 7.3 Where creation lives — and why it constrains the model

- **Trip creation:** `/trips/new`, its own route. Reached from the dashboard. **Outside**
  all four proposed tabs. No constraint.
- **Competition creation:** **inside the competition surface.**
  `LiveFaceClient.tsx:193` renders `<CompetitionSetupPanel tripId={tripId} />` when
  `canEdit && !competition`, and `CompetitionSetupPanel.tsx:78` owns the only
  `competitions.create` call in the app.

**This is the constraint the spec anticipated.** The Competition tab cannot be
"disabled until a competition exists", because the tab *is* where a competition gets
created. Today the app resolves this with a separate door — the trip Home enable card
(`page.tsx:444`) — which is editor-only, so:

- an **editor** with no competition reaches creation only via trip Home;
- a **member** with no competition has no path to the competition surface at all
  (`TripBottomNav` is gated on `competition` existing, `page.tsx:553`).

Three shapes are available — pick one in §9: keep the Home-card door and let the tab
stay disabled; make the tab enabled-but-empty with creation inside it (matching
today's face); or move creation out to its own route like trip creation.

---

## 8 · Blast radius

Everything that depends on the current route structure and would need changing.

### 8.1 Server components reading route params

- `src/app/trips/[tripId]/layout.tsx:22` — `await params`, prefetches
  `competitions.getByTrip`, wraps children in `HydrationBoundary`.
- `src/app/trips/[tripId]/leaderboard/page.tsx:31` — `await params`, server-resolves
  `competitions.faceBootstrap` and passes it as `initialData`. **This is the SSR seed
  that makes the face paint populated with zero client round-trip** — if the face stops
  being a route, this optimisation has to be re-homed or lost.
- `src/app/page.tsx:33-55` — reads the auth session + `bt-last-trip-id` cookie.

### 8.2 `generateMetadata`

**None exists.** No blast radius. (`dynamic`/`revalidate` exports exist on
`/dashboard`, `/login`, `/privacy`, `/terms` only.)

### 8.3 Middleware matcher assumptions

`src/middleware.ts`:

- `isPublicRoute` (`:43-49`) is a **path-prefix allowlist**: `/`, `/login`,
  `/privacy`, `/terms`, `/auth/`, `/scoreboard/`, `/invite`. Collapsing routes into
  tab state changes which paths exist to match.
- **`/scoreboard/` does not exist** (`:47`) — stale entry, safe to note now.
- The `/api/trpc` 401 rewrite (`:73-92`) is orthogonal to routing, but the comment at
  `:64-72` records that the route **must stay in the matcher** because middleware is
  the confirmed token-refresh path. Do not narrow the matcher during the refactor.
- The matcher regex (`:107`) excludes static assets, `manifest.webmanifest`, `sw.js`.

### 8.4 E2E selectors and route assumptions

Merge-blocking project = `critical-path` (`playwright.config.ts:32-33`), covering
`critical-path.spec.ts` + `match-play.spec.ts`.

- `page.goto('/trips/${tripId}/leaderboard')` — `critical-path.spec.ts:138`, `:242`,
  `:314`; `match-play.spec.ts:352`.
- `page.goto('/trips/${tripId}/games/match/new')` — `match-play.spec.ts:172`
  (`driveToSetupWithHandicap`, two callers). **A standalone game route inside a
  merge-blocking test.**
- Nav/panel test ids that must survive: `nav-trip-home`, `nav-live`
  (`BottomNav.tsx:165`), `open-game-panel` (`GameRow.tsx:396`, `:635`), `game-panel`
  (`CompetitionFace.tsx:340`), `game-back`, `game-title` (`TopNav.tsx:137`, `:145`),
  `competition-leaderboard`, `comp-add-game`, `competition-settings-btn`.
- `TripTabBar.test.tsx` asserts the `TripBottomNav` push-vs-replace contract
  (`:47-88`) and `GlobalBottomNav` item visibility (`:90`) — the latter tests a
  component nothing renders.

### 8.5 Push-notification deep links

**Low risk today, because Phase 3 is unwired.** `NOTIFICATIONS.md:5-7` states nothing
is wired yet. The mechanism exists — `sendPush.ts:30` accepts an optional `url`, and
`public/sw.js:61` stores `data: { url: data.url || "/" }` — but no production caller
constructs a trip or game URL, so there are no hardcoded deep links to break.

**One forward-looking hazard:** `public/sw.js:73` uses `client.navigate(target)` on an
existing tab, which is a **full document navigation**. Against a persistent shell that
tears the whole app down. When Phase 3 wires deep links, they will need to be
shell-aware (or the SW will need to post a message instead of navigating).

### 8.6 Anything constructing a URL to a tab

- **`FeedbackModal`** — `:110-111`, `:209`, `:494-517` read `?tab=` and map it to a
  label. Already effectively dead (§1.1) and would need rewriting against whatever
  the new tab state is. It also branches on two routes that no longer exist
  (`/changelog` at `:501`, `/trips/*/events/*` at `:507`).
- **`StrokeGameView`** — hardcodes `/trips/${param}/games/new` in `router.replace` at
  `:662` and `:821`. Guarded on `!urlGameId` so it cannot fire in panel mode today,
  but it is a route string inside a component that also renders as a panel.
- **`CourseSearchPanel.tsx:90`** — builds
  `/courses/new?trip=…&game=…&slot=…&provider=…` and navigates there **from inside a
  game panel**, tearing down the board. `courses/new/page.tsx:46` returns via
  `router.back()` with a `/trips/${tripId}` fallback. This is the one in-app flow that
  escapes the panel idiom.
- **`authExpiry.ts:72`** — captures the current path as `?next=` and does a
  **hard** `window.location.assign` (deliberate, `:63-65`: "so all polls unmount"). If
  tab state lives only in memory, `?next=` cannot restore it — re-auth returns the
  user to the right route but the wrong tab. Validated by `safeNextPath`
  (`src/lib/nextPath.ts:26`).
- **`auth/callback/route.ts:77-99`** — honours `?next=`, else `/trips/new` for a new
  user, else `/`.
- **`BottomNav.tsx:61-68`** (`GlobalBottomNav`, dead) and `:128-135`
  (`TripBottomNav`, live) — both build `/trips/${tripId}...` hrefs and
  `router.prefetch` them (`:139-144`).

### 8.7 Dead or unreachable code the refactor should clean up

1. `GlobalBottomNav` — `BottomNav.tsx:55-105`, rendered nowhere.
2. The `<Link href={href}>` fallback in `GameRow.tsx:403` and `:640` — unreachable for
   every known game type (§2.3).
3. `/scoreboard/` in the middleware allowlist — `middleware.ts:47`.
4. `FeedbackModal`'s `/changelog` and `/trips/*/events/*` branches — `:501`, `:507`.
5. `TripBreadcrumb` referenced in `STYLE_GUIDE.md:89` — component does not exist.
6. Stale comments claiming stroke uses the route `<Link>` — `GameRow.tsx:180-181`,
   `:386`, `:602`.
7. Stale comment "the leaderboard's 30s poll" — `LiveFaceClient.tsx:98` (now 5 min).

---

## 9 · Open questions for Zach

**Product decisions — these change the design, and they're yours.**

1. **Competition creation vs. a disabled Competition tab.** Creation lives inside the
   competition surface (`LiveFaceClient.tsx:193`), so that tab can't be disabled-until-
   context in the same way as the others. Keep the trip-Home enable card as the door
   and leave the tab disabled? Make the tab enabled-but-empty with creation inside it
   (today's behaviour)? Or move creation to its own route like `/trips/new`?

2. **What a member sees when no competition exists.** Today: nothing — no door at all
   (`page.tsx:553`). Should the Competition tab appear and explain, appear disabled, or
   stay hidden?

3. **Are disabled tabs tappable?** (Tap → nothing, tap → toast, tap → bounce to Home?)
   The spec raises this; it isn't derivable from code.

4. **The idea phase currently has no tab bar at all** (`page.tsx:408`). Does the
   persistent bar render during the idea phase, and if so what do Trip/Competition/Chat
   show while `IdeaZonePanel` owns the screen?

5. **What happens to the five trip content tabs** (Home/Crew/Lodging/Agenda/Receipts)?
   They're a different axis from the four context tabs. Nested bar, in-page
   segmentation, or something else?

6. **Should a tab switch create a history entry?** §5.4 is why this matters: three
   existing `popstate` listeners are unscoped and would mis-consume tab entries. My
   read is `replaceState` (URL reflects the tab, deep-linkable and shareable, no entry
   created) avoids every listed breakage while still fixing IA-1 — but "back should
   step through tabs" is a legitimate product choice with real cost, so I'm not
   deciding it.

7. **Does the cookie bypass (IA-2) survive?** If Home becomes the only context
   switcher, `/` 307-ing straight to the last trip means users rarely see it. Keep,
   drop, or make it land on Home-with-context-preselected?

8. **Does the competition face stay a route?** It currently gets a server-side
   `faceBootstrap` seed (`leaderboard/page.tsx:31-40`) that paints the board populated
   with zero client round-trip. If it becomes a tab, that seed needs re-homing or the
   first paint gets slower — a real cost to weigh against the persistence win.

**Unconfirmed — flagged rather than asserted.**

9. **PF-9** (sheet vs centered dialog dismissal idiom) was **not re-verified** this
   pass; it was a 15+ component survey and I did not re-count. Treat the original as
   unverified rather than current.

10. **`quick-game` and `/courses/new` were not exercised in the browser.** Their
    behaviour above is read from source only.

11. **Transition costs were measured on one seeded fixture on a local dev build** (one
    competition, one game, two members, warm caches except where noted). Absolute
    numbers will differ at BBMI scale; the *shape* (which transitions cost zero and
    which pay a remount) is structural and won't.

12. **I did not verify what `NAV_AUDIT.md`'s PLATFORM findings looked like at the audit
    date**, except IA-8 and IA-1. Other never-trues may exist in that table; I checked
    the two the refactor leans on plus the one that looked wrong.

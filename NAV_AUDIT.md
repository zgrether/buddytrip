# Navigation & Web-vs-Native Audit — BuddyTrip

> **Report-only inventory** (2026-06-13). No fixes, no target tree, no platform
> recommendation. This is the input to the upcoming workflow/IA design
> conversation — it makes the current navigation *visible* and *sorted* so the
> target tree can be designed against fact.
>
> All findings tagged `[IA]` (wrong regardless of platform — fixable in IA/workflow
> design) or `[PLATFORM]` (web-vs-native gap — separate track, with rough on-web
> effort noted). Evidence is `file:line`.

---

## 1 · The current nav tree

### 1a · Route table → screen → affordances → back-target

| Route | Screen | Nav affordances on it | "Back" lands at |
|---|---|---|---|
| `/` (`src/app/page.tsx`) | **Redirect gate** (server). Unauth → MarketingPage; auth → last trip or dashboard | none (307 redirect) | n/a |
| `/dashboard` (`src/app/dashboard/page.tsx` → DashboardClient) | **User dashboard** — all trips grouped NOW/ACTIVE/IDEAS/PAST | TripCard click → `/trips/{slug\|id}`; "New trip"; TopNav (News hidden) | browser history |
| `/login` | LoginClient (respects `?mode=`) | — | — |
| `/profile` (`src/app/profile/page.tsx`) | **Profile** — sidebar tabs (desktop) / stacked (mobile) | mobile back `router.back()` (:184); desktop sidebar back → `router.back()` (:630); mobile "Idea archive" → `router.push('/profile/archived-ideas')` (:353) | `router.back()` ✓ |
| `/profile/archived-ideas` (`src/app/profile/archived-ideas/page.tsx`) | Archived ideas (**mobile-only route**) | "Back to profile" — **hardcoded `<Link href="/profile">`** (:17) | always `/profile` |
| `/quick-game` (`src/app/quick-game/page.tsx`) | **Standalone game** (localStorage) | close/back/discard → **hardcoded `/dashboard`** (:116, :229); "Play again" = local state reset | always `/dashboard` |
| `/invite` | InviteContent (token → login → auto-join) | redirect-driven | — |
| `/auth/reset-password` | Reset form → `/` on success | — | — |
| `/not-found` | 404 | `<Link>` to `/dashboard` | — |
| `/trips/new` | Trip creation (know-where vs explore) | — | — |
| `/trips/[tripId]` (`src/app/trips/[tripId]/page.tsx` → TripDetailBody) | **Trip home** — 6-tab host | TripTabBar (tabs); TopNav flag → `router.push('/dashboard')`; TripBottomNav when comp active; 404 → `router.replace('/dashboard')` (:177) | browser history (no per-tab entries) |
| `/trips/[tripId]/leaderboard` (`src/app/trips/[tripId]/leaderboard/page.tsx`) | **Live leaderboard** (read-side, only if comp `active`) | back → `/trips/{tripId}` (:109) | `/trips/{tripId}` |
| `/trips/[tripId]/games/new` (`src/app/trips/[tripId]/games/new/page.tsx`) | New stroke game (trip-nested) | back → `router.push('/trips/${param}')` (:171) | `/trips/{param}` |
| `/trips/[tripId]/games/match/new`, `/games/rack/new` | Match / rack creation | (same trip-nested pattern) | `/trips/{tripId}` |

### 1b · Tabs — *state, not place* (the structural crux)

Trip tabs (`src/components/TripTabBar.tsx`): **home · crew · lodging · schedule ·
expenses · comp**. Visibility gated by role/phase (comp = owner/organizer;
lodging/schedule = editors; lodging/expenses hidden in idea phase).

The active tab lives in **React `useState`**, not the URL
(`src/app/trips/[tripId]/page.tsx:46`). `?tab=` is read **once on mount** (:47) and
**never written back** — all 7 `setActiveTab` call sites (page.tsx:406, 416, 417,
469, 492, 504, 530) are bare state setters. Therefore a tab is a **route you stack
onto, not a place you are**: switching tabs creates no history entry, the URL never
changes, and re-entering `/trips/{id}` always defaults to home.

### 1c · The dashboard-vs-trip-home altitude map

- **Down (dashboard → trip):** TripCard click `router.push('/trips/{slug|id}')`
  (`src/components/TripCard.tsx:88`); the trip page then writes `bt-last-trip-id`
  cookie+localStorage on mount (page.tsx:157–165).
- **Up (trip → dashboard):** TopNav flag = **hardcoded `router.push('/dashboard')`**
  (`src/components/TopNav.tsx:120`) — a *forward push*, not a parent-up.
  TripBottomNav "Trip Home" stays inside the trip and never goes to dashboard
  (`src/components/BottomNav.tsx:161–177`).
- **Launch bypass:** `/` redirects authed users with a cookie **straight to the last
  trip**, skipping the dashboard entirely (page.tsx:46–47). Dashboard is only the
  new-device fallback.

### 1d · Standalone vs nested

- **Game:** `/quick-game` is trip-free (localStorage, free-text names), exits to
  `/dashboard`; trip-nested `/trips/{id}/games/new` requires `tripId`, uses crew
  lookup, persists to DB, exits to `/trips/{id}`.
- **Competition:** **no standalone competition exists** — every comp nav target
  embeds `tripId` (leaderboard route, comp tab, `competitions.getByTrip`). The nav
  model assumes every competition lives inside a trip. No `/competitions/{id}`
  surface.

---

## 2 · The two-homes seam (suspected crux)

There are two homes at different altitudes, and the seam between them is where the
confusion concentrates:

1. **User dashboard** (`/dashboard`) — "what am I part of," all trips by phase.
2. **Trip home** (`/trips/{id}`) — "what's going on inside this one," the 6-tab host.

**Three concrete facts make the seam confusing, all evidenced:**

- **The dashboard is usually skipped.** `/` 307-redirects to the last trip whenever
  the `bt-last-trip-id` cookie is set (page.tsx:46–47). A returning user may *never*
  see the global home; the trip page becomes their de-facto launch surface.
- **"Up" is lateral, not parental.** The only trip→dashboard affordance is the TopNav
  flag, a hardcoded forward `push('/dashboard')` (TopNav.tsx:120). Because the user
  often arrived via the cookie redirect (no dashboard entry in history), browser back
  does **not** reach the dashboard — clicking the flag feels like jumping sideways to
  a place they didn't come from. `[IA]`
- **Competition straddles both altitudes via two surfaces.** The **comp tab**
  (`/trips/{id}` with `?tab=comp`, owner/organizer authoring, page.tsx:516–533) and
  the **leaderboard route** (`/trips/{id}/leaderboard`, read-only, all crew, surfaced
  by TripBottomNav only when comp is `active`) show the same competition at different
  URLs with role-split access. Not duplicated data, but two doors to one object at
  different altitudes — the boundary a user must model is implicit. `[IA]`

**Why "back drops me at home" happens (the mechanism):** tabs aren't history entries
(§1b), so the browser history stack contains only *page* transitions, not *tab*
transitions. Hitting back from deep inside a trip pops the whole trip page to
whatever preceded it in browser history — frequently the dashboard or the
cookie-redirect origin — never the originating tab. This is an `[IA]` cause (state
model) with a `[PLATFORM]` amplifier (browser history ≠ native nav stack).

---

## 3 · Findings table

### `[IA]` — structural, fixable in IA/workflow design regardless of platform

| # | Finding | Mobile/Desktop | Evidence | Note |
|---|---|---|---|---|
| IA-1 | Tab state is `useState`-only; `?tab=` read once, never written back | both | page.tsx:46–59; setActiveTab ×7 (406–530) | Root cause of "back drops to home"; tabs not deep-linkable/shareable/bookmarkable |
| IA-2 | `/` cookie-redirect skips the dashboard for returning users | both | page.tsx:43–54; cookie write trips/[tripId]/page.tsx:157–165 | Dashboard is bypassed except on new device |
| IA-3 | "Up" to dashboard is a hardcoded forward push, not history-aware | both | TopNav.tsx:120 | Feels lateral; no back-path to dashboard after cookie redirect |
| IA-4 | Archived-ideas "back" is a hardcoded `/profile` Link | mobile (route exists only on mobile) | archived-ideas/page.tsx:17–23 | Breaks when entered from any other origin |
| IA-5 | Profile archived-ideas is a **real route on mobile, inline panel on desktop** | diverges | profile/page.tsx:335, 340, 353, 608 | Route existence depends on viewport |
| IA-6 | Idea Zone setup is **two separate modal implementations** by viewport | diverges | IdeaZonePanel.tsx:1285–1334 | Not a reflow — two distinct containers (`lg:hidden` / `hidden lg:flex`) |
| IA-7 | Competition split across comp-tab (author) and leaderboard route (read) by role | both | page.tsx:516–533; leaderboard/page.tsx | Two doors to one object at two altitudes |
| IA-8 | Bottom nav present on mobile, absent on desktop | diverges | BottomNav.tsx:13–31; rendered in trip page | A primary nav surface exists on only one viewport |
| IA-9 | All competition nav assumes `tripId`; no standalone-competition path | both | BottomNav.tsx:128/172, leaderboard:109, games/new:171 | Nav model has no orphaned/floating comp or game |

### `[PLATFORM]` — web-vs-native gaps (effort = on-web cost)

| # | Finding | Mobile/Desktop | Evidence | Effort | Note |
|---|---|---|---|---|---|
| PF-1 | Browser/Android-hardware back has no knowledge of tab structure | mobile-critical, both | page.tsx tab state; BottomNav.tsx:162–177 history juggling | fixable-on-web (URL-sync tabs); true native-stack feel = **needs-native** | The platform half of IA-1; Android hardware back can exit the app from a deep-linked trip |
| PF-2 | No scroll-position restoration on back | both | no `scrollRestoration` in next.config.ts; no manual save/restore | fixable-on-web-with-effort | Lost on dashboard, schedule, crew, leaderboard, messages |
| PF-3 | No swipe-between-tabs gesture | mobile | TripTabBar.tsx click-only; no gesture lib in package.json | fixable-on-web-with-effort (non-trivial) | Tab UI implies swipe; none exists |
| PF-4 | Back-to-dismiss is **inconsistent** across sheets | mobile-critical | present: AboutModal:42, FeedbackModal:105, TripSettingsModal:92 (`useModalBackButton`); **absent**: CompetitionGamesPanel:358, TeamsPanel:597/1058, CompetitionHeader, ScoreboardStyleChooser | fixable-on-web | Browser/hardware back dismisses some sheets but page-navigates away from others |
| PF-5 | No swipe-to-dismiss on bottom sheets | mobile | grab handle rendered, no touch handler in any sheet | fixable-on-web-with-effort | Handle implies a gesture that isn't wired |
| PF-6 | No ESC handler in the 4 competition overlays | desktop | same 4 components as PF-4 | fixable-on-web (minutes) | ESC works in About/Feedback, not in comp overlays |
| PF-7 | No pull-to-refresh; collides with mobile-browser native pull | mobile | no implementation; ScrollLock via `react-remove-scroll` | **effectively-needs-native** | Web has no clean answer that doesn't fight the browser's own pull |
| PF-8 | Forward button / refresh loses tab + modal state | both | consequence of IA-1; modal state not in URL | fixable-on-web (with URL state) | Re-mount resets to home tab, closes sheets |
| PF-9 | Sheet (mobile) vs centered dialog (desktop) changes the dismissal idiom | diverges (behavioral) | 15+ modals, e.g. DatesSheet:254/262, CrewTab:896/962, ScheduleTab:1493/1611, FeedbackModal:224/229 | inherent; gap is the missing swipe/back (PF-4/5) | Same component, different dismissal expectation per viewport |
| PF-10 | Chat/News: bottom-sheet (mobile) vs persistent side-rail (desktop) | diverges (behavioral) | FloatingChatPanel.tsx:500–643; NewsPanel.tsx:370–480 | inherent | Draggable *height* (mobile) vs *width* (desktop); different docking & interaction model |
| PF-11 | Address-bar / dynamic viewport not specially handled | mobile | safe-area insets used (BottomNav:82); no `dvh`/`viewport-fit` evidence | fixable-on-web (low) | Fixed elements may shift as the mobile address bar shows/hides |

---

## 4 · Scope boundary

Per the brief: **no proposed target tree, no fixes, no platform path
recommendation.** The `[IA]` items (notably the two-homes seam and
tab-state-not-in-URL) are the input the upcoming workflow/IA design settles; the
`[PLATFORM]` items are parked as a separate track with the on-web effort already
noted, so "our structure is wrong" stays cleanly separated from "the web can't do
this for free."

### Method

The catalog was assembled by four parallel read-only explorations (routing & tab
mechanics; web-vs-native platform gaps; two-homes seam & standalone-vs-nested;
mobile-vs-desktop behavioral divergence). The two spine claims — tab state in
`useState`, and the `/` cookie redirect — were independently verified against source
before publishing.

# Reachability audit — what can still be reached

**Date:** 2026-11-16 · **Base:** `main` @ `eae2b834` (merge of #1707) · **Branch:** `audit/reachability`
**Spec:** `docs/audits/REACHABILITY_AUDIT_SPEC.md` · **Refreshes:** `GAME_ROUTES_AUDIT.md` (2026-07-25), app-wide.
**Read-only.** Nothing was deleted, moved or renamed; this file is the only one created. Zach decides deletions from it.

---

## 0 · STOP — read this first

The spec says to stop and report if a route looks orphaned but something outside the repo might link to it. Two groups do, and the repo cannot answer either:

1. **The standalone game routes** (`/trips/[tripId]/games/{new, match/new, rack/new, scramble/new, skins/new, manual, pickem, scorecard}`). Nothing in the app now sends a person to most of them (§1), so they look orphaned. Three outside sources could still hold their URLs, and none is searchable from the repo:
   - **News posts.** A news block can be a hyperlink (`src/lib/news.ts:49-55`), so a post may carry a `bbmi.app` game URL. The repo cannot show which posts do.
   - **Push notifications already delivered.** The sender builds panel URLs today (`src/server/lib/gameFinishNotify.ts:404-406`), but until `2b71471dc` (2026-09-27) a **side game's** finish push carried the route URL, `gameHref(tripId, gameTypeId, gameId)` i.e. `/trips/{id}/games/{seg}?game=…` (`git show 2b71471dc -- src/server/lib/gameFinishNotify.ts`). A notification from before that date, or a link someone copied from one, opens such a URL. This is the one concrete outside-link source the history confirms.
   - **Bookmarks and shared links** from the days games were only reachable at their URL.
2. **`/quick-game` (bare) and `/auth/reset-password` / `/auth/callback`.** `/quick-game` carries its own comment calling a bare URL "an old bookmark" (`src/app/quick-game/page.tsx:182`). The two auth routes are reached only from emails whose **templates live in the Supabase dashboard**, not in the repo (`LoginClient.tsx:312` sets `redirectTo`; the template text and the redirect allow-list are outside it).

**What was not done, and is yours to decide:** I did not query production (news post bodies, sent notification payloads, email templates) and did not look at the Supabase dashboard. Both are reads you could authorise. Until then, treat every "by URL only" verdict below as "unreachable *from inside the app*", not "safe to delete".

The remaining sections are complete for what the repo can show. The verdicts in §6 that depend on this are marked **(needs outside check)**.

---

## 1 · Every route

"Reached by" cites the control or the code that sends someone there. "URL only" means no link, button or redirect in the repo produces it. **Nothing was run in a browser**; each claim is from reading the code that renders the control.

### Pages

| Route | File | Reached by in normal use | Status |
|---|---|---|---|
| `/` | `src/app/page.tsx` | PWA `start_url` (`src/app/manifest.ts:24`); returning user after sign-in via `auth/callback/route.ts` ("returning user → `/`"); marketing page for signed-out visitors, redirect to a trip or `/dashboard` for signed-in ones (`page.tsx:107-108`). | reached |
| `/login` | `src/app/login/page.tsx` | Marketing CTAs (`marketing/HeroSection.tsx:16`, `CtaSection.tsx:19`, `MarketingNav.tsx:31-32`, `MarketingFooter.tsx:29`); middleware sends every signed-out request here (`src/middleware.ts:191`). | reached |
| `/auth/reset-password` | `src/app/auth/reset-password/page.tsx` | Emailed reset link only; `LoginClient.tsx:312` asks Supabase to send it with this `redirectTo`. | email only — **STOP item 2** |
| `/auth/callback` | `src/app/auth/callback/route.ts` | Emailed confirm / magic links; target is built at `src/lib/authRedirect.ts:35`. | email only — **STOP item 2** |
| `/invite` | `src/app/invite/page.tsx` | Emailed invite links (`src/lib/email.ts:124`, `:283`); `invite/authHandoff.ts:51`; `login/page.tsx:35`. | email only; middleware treats it as public (`middleware.ts:132`) |
| `/privacy`, `/terms` | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Footer links (`components/SiteFooter.tsx:61-62`, `marketing/MarketingFooter.tsx:30-31`); `/privacy` also from the About modal (`components/AboutModal.tsx:233`). | reached |
| `/dashboard` | `src/app/dashboard/page.tsx` | Brand button in the top bar (`components/TopNav.tsx:120`); Home tab (`components/shell/AppShell.tsx:347`); signup default destination (`authRedirect.ts:23`); `not-found.tsx:26`; root redirect (`page.tsx:108`); the test-push URL (`server/routers/notifications.ts:206`). | reached |
| `/quick-game` | `src/app/quick-game/page.tsx` | Mobile only: a Quick Game tile on the dashboard opens a setup sheet, and Start / Resume does `router.replace("/quick-game?format=…")` (`dashboard/DashboardClient.tsx:535`). The tile strip is `lg:hidden` (`DashboardClient.tsx:318`), so **a desktop user has no control that reaches it**. A bare `/quick-game` is documented as an old bookmark (`quick-game/page.tsx:182`). `?format=rack` is accepted but no tile links to it (`:185-189`). | reached on mobile; URL only on desktop — **STOP item 2** |
| `/courses/new` | `src/app/courses/new/page.tsx` | Course picker inside game settings: "search the wider database" and the add-a-course row push to it (`components/games/course/CourseSearchPanel.tsx:211`, `:231`; target at `:102-103`). | reached |
| `/trips/new` | `src/app/trips/new/page.tsx` | Only the server redirect for a brand-new signup with no trips (`auth/callback/route.ts:93`). In-app creation is a modal now (`components/trips/CreateTripModal.tsx:15-38`, opened at `DashboardClient.tsx:504`). The "New trip" link that points here (`components/BottomNav.tsx:63`) is in the legacy bar nothing renders (§3). | redirect + URL only |
| `/trips/[tripId]` | `src/app/trips/[tripId]/page.tsx` (+ `layout.tsx`) | Trip cards (`components/TripCard.tsx:92`), the rail (`shell/ContextRail.tsx:429`), tab switches (`shell/AppShell.tsx:195,273,352`), create flow (`trips/CreateTripFlow.tsx:83`), invite and trip emails (`email.ts:58`, `:125`), chat and news pushes (`server/lib/chatNotify.ts:203`, `newsNotify.ts:70`). | reached |
| `/trips/[tripId]/leaderboard` | `.../leaderboard/page.tsx` | Alias that `router.replace`s to `?view=cup` (`:57`). In-app: the Schedule tab's "Go to Games →" button (`tabs/ScheduleTab.tsx:1220` → `trips/[tripId]/page.tsx:385`) and any stale `?tab=comp` (`page.tsx:302-308`). The two nav bars that also linked it are legacy (§3). Merge-blocking E2E uses it (§4). | reached, thinly |
| `/trips/[tripId]/games/new` (stroke) | `.../games/new/page.tsx` | **With `?game=`:** the Schedule tab's agenda game chip, a real `<Link>` (`tabs/ScheduleTab.tsx:319-326`), for any linked game of this format. **Without `?game=`:** the old stand-alone create screen — nothing links to it; `StrokeGameView` still creates a game here (`StrokeGameView.tsx:845-855`). | reached with `?game=`; bare is URL only |
| `.../games/match/new` | `.../games/match/new/page.tsx` | Agenda chip, as above. Bare URL redirects to the Games page (`MatchGameView.tsx:1103-1107`), so its create screen is already gone. | reached with `?game=` |
| `.../games/rack/new` | `.../games/rack/new/page.tsx` | Agenda chip. Bare URL still has a create flow (`RackGameView.tsx:564`, button at `:1183`). | reached with `?game=`; bare is URL only |
| `.../games/scramble/new` | `.../games/scramble/new/page.tsx` | Agenda chip. Renders `StrokeGameView`. | reached with `?game=` |
| `.../games/skins/new` | `.../games/skins/new/page.tsx` | Agenda chip. | reached with `?game=` |
| `.../games/manual` | `.../games/manual/page.tsx` | Agenda chip (non-golf formats). | reached with `?game=` |
| `.../games/pickem` | `.../games/pickem/page.tsx` | Agenda chip (pick'em). Bare URL renders nothing (`PickemGameView.tsx:1219`). | reached with `?game=` |
| `.../games/scorecard` | `.../games/scorecard/page.tsx` | **Nothing navigates here.** `gameHref(..., { scorecard: true })` is called only as a yes/no gate (`competition/GameRow.tsx:333,348`; `games/course/CourseRowContent.tsx:59,100,133`), and the scorecard icon opens an overlay instead (`GameRow.tsx:555` → `openScorecardOverlay`). | **URL only** — **STOP item 1** |
| *(game rows on the Games page)* | `competition/GameRow.tsx` | Not a route. For completeness: every registered format opens as a panel (`lib/gameRoutes.ts:171-181`), and the row's `<Link href>` branch (`GameRow.tsx:630`, `:975`) only runs for a format `opensAsPanel` rejects. Every registered format passes, and `gameHref` returns `null` for any other, so **that branch cannot render today**. | dead branch |
| `not-found.tsx`, `manifest.ts`, `layout.tsx` (root + trips) | `src/app/` | Framework files. `/manifest.webmanifest` is read by the browser, not linked. | n/a |

### API routes

| Route | File:line | Caller |
|---|---|---|
| `/api/trpc/[trpc]` | `src/app/api/trpc/[trpc]/route.ts:31` | `src/lib/providers.tsx:121,125` (the live client). `src/lib/trpc.ts:17` also targets it but is itself unused (§3). |
| `POST /api/lodging-meta` | `api/lodging-meta/route.ts:28` | `trips/[tripId]/components/AddPropertySheet.tsx:265` |
| `POST`, `GET /api/places` | `api/places/route.ts:18`, `:124` | `AddPropertySheet.tsx:318,332`; `AddScheduleItemSheet.tsx:84,254,277`. The `GET` is called as `/api/places?placeId=…`; the doc comment at `:122` says `/api/places/details`, which no file serves. |
| `GET /api/golf-courses/search` | `api/golf-courses/search/route.ts:38` | `src/lib/courseService.ts:92` |
| `GET /api/golf-courses/[courseId]` | `api/golf-courses/[courseId]/route.ts:27` | `courseService.ts:102` |
| `GET /api/matchups/teams` | `api/matchups/teams/route.ts:28` | `components/matchup/MatchupSearch.tsx:86` |
| `GET /api/matchups/schedule` | `api/matchups/schedule/route.ts:26` | `MatchupSearch.tsx:114` |

All eight API handlers have a caller.

---

## 2 · Every tRPC procedure

**195 procedures** across 30 routers, enumerated from `src/server/routers/*.ts` and mounted names from `src/server/router.ts`. The count matches `grep -c '\.(query|mutation|subscription)\('` per file exactly (archivedIdeas 3, competitions 13, … users 6), so the parse missed none. Per-procedure counts are in Appendix C.

**175 have at least one client call in code. 20 have none.** "Client call" means a code line (not a comment) matching `(trpc|utils|api|caller|client|ctx|t).<ns>.<name>`, found under `src/` outside `src/server/` and tests. No application code creates a server-side caller (`createCaller` appears only in tests and `trpc.ts`), so a procedure with no client call has no application caller at all.

| Procedure | Defined | Used by | Verdict |
|---|---|---|---|
| `games.listTypes` | `games.ts:702` | nothing — no test, no server, no client. The comment calls it "a thin server-side accessor (tests / any future server caller)". | delete candidate. `TRACKER.md:361` already lists it. |
| `games.removeOrganizer` | `games.ts:2671` | nothing. `GameIdentityHeader.tsx:31`: "the `removeOrganizer` path is gone". | delete candidate; `PERMISSIONS.md:256,407` documents it and must change with it. |
| `pickem.setPointsTotal` | `pickem.ts:668` | nothing | delete candidate |
| `matches.reorder` | `matches.ts:563` | nothing; named only in comments at `schedule.ts:177`, `teamAssignments.ts:472` | delete candidate |
| `pickem.saveMatches` | `pickem.ts:700` | no router call. `PickemGameView.tsx:563-568`: left in place deliberately, "they carry 18 tests"; I found no router-level test, so those exercise the `save_pickem_matches` RPC directly (**unconfirmed**) | keep until that call is made; the code says so on purpose |
| `competitions.teamAssignmentCounts` | `competitions.ts:273` | `competitions.d1followon.test.ts` (3). Comment says "Used by GameSheet" — not true now. | delete candidate; the test goes with it. `TRACKER.md:361` lists it. |
| `datePoll.returnToPoll` | `datePoll.ts:455` | `datePoll.test.ts` (3); no UI control | delete candidate, or the UI for it was never built (**unconfirmed which**) |
| `teamAssignments.rosterFingerprint` | `teamAssignments.ts:120` | `rosterFingerprint.test.ts` (2). Built for "PR 8's before-and-after previews" which fetch the fingerprint server-side. | delete candidate |
| `playGroups.setParticipantStrokes` | `playGroups.ts:117` | `games.configHash.test.ts`, `rackNStack.test.ts` (4) | delete candidate; tests use it as a fixture |
| `games.addParticipants` | `games.ts:1080` | tests only, 51 call lines in 25 files (fixture seeding); the UI uses `saveConfig` | keep until the fixtures move; then delete |
| `games.setStatus` | `games.ts:1611` | tests only (11) | same |
| `games.enableScoring`, `games.disableScoring` | `games.ts:1645`, `:1713` | tests only (90 call lines in 40 files; 1). `MatchGameView.tsx:445,1438` mention them in comments only. | the UI flips scoring through `save_game_config` now; keep while tests use them |
| `games.setPointsTotal`, `games.setPointsDistribution` | `games.ts:2409`, `:2489` | tests only (17; 29) | same |
| `matches.setPairings` | `matches.ts:77` | tests only (82 call lines); comments in `splitSides.ts:7`, `assertAffected.ts:22`, `games.ts:2074` | same |
| `matches.assignPlayer`, `matches.setHandicap`, `matches.setPointValue`, `matches.enableScoring` | `matches.ts:220`, `:358`, `:456`, `:600` | tests only (3; 14; 6; 12) | same |

None of the 20 is called from a script (`scripts/` has no tRPC caller). Of the 20: 4 have no caller of any kind, 1 (`pickem.saveMatches`) has none in application code and tests the RPC directly, and 15 are called only by tests. 11 of those 15 are tools the test fixtures seed games with, so deleting one means rewriting the fixtures first.

---

## 3 · Unused files, exports, dependencies

Command: `npx --yes knip@5 --no-progress --reporter json` at `eae2b834`, no config, nothing added to `package.json`. Output has a `dotenv` banner line in front that must be stripped before parsing. Exit code 1 is knip's normal "found issues". Result: **22 unused files, 120 unused exports, 229 unused types, 2 dependency findings, 4 unlisted, 2 duplicate exports.**

### 3a. Unused files (22), each checked by hand

Three are application code and confirmed orphans. Searched for the file's name in every form an import takes (`@/…`, relative, `import()`, string) across `src/ e2e/ scripts/ *.md *.json *.yml`; plus an independent import-graph pass over all 1,369 `.ts`/`.tsx` files in `src/` and `e2e/` that found the same three and **no** file imported only by tests.

| File | Evidence | Verdict |
|---|---|---|
| `src/components/InvitationCard.tsx` | No importer. Its own header calls it "the canonical 'enable this feature' CTA used by every" home panel; later work replaced the panels (`git log`: `d837e9f6f` introduced it). | delete candidate |
| `src/components/competition/TeamMemberChip.tsx` | No importer. `components/news/NewsBlock.tsx:43` names it in a comment only. | delete candidate |
| `src/lib/trpc.ts` | No importer of `@/lib/trpc` (the live client is `lib/trpc-client`). It builds its own base URL; `providers.tsx:27` does the same. | delete candidate; **docs say it is live**: `DOMAIN_AND_EMAIL.md:23,134` |

The other 19 are **false positives or not application code** — knip has no config here:

- `public/sw.js` — registered by string at `components/pwa/ServiceWorkerRegistration.tsx:17` (`register("/sw.js")`). **Keep.**
- `e2e/auth.setup.ts` — named by `playwright.config.ts:46`. **Keep.**
- `scripts/measure-hero-name-contrast.mjs`, `scripts/repair-ghost-orphans.mjs` — run by hand by design (their headers say so). No package script or doc names them. **Keep; your call.**
- 14 files under `design/` — prototypes and handoff sources. `eslint.config.mjs:60` already ignores `design/**` as "design exploration, not application code". Not shipped.

### 3b. Dead code inside live files that knip does not flag

**`src/components/BottomNav.tsx`** (`GlobalBottomNav` at `:56`, `TripBottomNav` at `:118`) is a legacy nav bar that nothing renders. Its only importers are `TripTabBar.test.tsx` and a guard-test table (`components/shell/bottomNavInset.guard.test.ts:69`). Live code imports only its **`TabId` type** (`trips/[tripId]/page.tsx:16`, `components/TripTabBar.tsx:5`, `lib/domainColors.ts:1`), which is why knip counts the file as used. `AppTabBar` replaced it (`shell/AppTabBar.tsx:22`). This matters because the bar holds three of the in-app links to `/dashboard`, `/trips/new` and `/leaderboard` that a search for those paths turns up. They are not controls anyone can press.

### 3c. Exports and types

120 unused exports, triaged by a name search over `src/ e2e/ scripts/` (Appendix A):

- **20 named nowhere else.** Several are whole components or hooks: `CoPlannerPanel` (`IdeaZonePanel.tsx:1658`), `HelperCardsWithLink`, `MatchupChips`, `useAuthLoaded`, plus the chat helpers `parseChatRoomKey`, `chatRoomLabel`, `chatRoomMessageFilter`. Also `publicProcedure` and `protectedProcedure` in `server/trpc.ts:278,289` — no router uses either.
- **4 named only by tests** (`GlobalBottomNav`, `TripBottomNav`, `isRace`, `matchesToSaveRows`).
- **79 used inside their own file only** — the code is live, only the `export` keyword is extra.
- **17 whose name also exists in another file** (re-exports like `GameRow.tsx:27`, or two files that each export `Field`/`CourseRow`). Not confirmed one by one.

229 unused types: **0** named nowhere, **208** used only in their own file, 19 shared names, 2 test-only. Nothing to delete; it is an `export`-keyword cleanup.

### 3d. Dependencies

| Finding | Evidence | Verdict |
|---|---|---|
| `@trpc/next` (`package.json:24`) | The only occurrence of the string `@trpc/next` in the repo, outside `package-lock.json`. | delete candidate |
| `supabase` devDependency (`package.json:49`) | Nothing imports it. `ci.yml:117` says the npm-bundled binary "isn't needed" (CI uses `supabase/setup-cli`). Local use goes through the CLI binary. | **unconfirmed** — depends how you run it locally (`scripts/reproduce-ci-e2e.sh` reads its pin from `ci.yml`) |
| unlisted: `postcss` (`postcss.config.mjs`), `@tanstack/query-core` (two tests), `server-only` (`server/trpc-ssr.ts:1`) | Transitive packages (Tailwind, TanStack Query, Next). | leave; not orphans |
| duplicate exports | `authedProcedure`/`protectedProcedure` (`server/trpc.ts:281,289`); `SHELL_DESKTOP_PX`/`CHAT_COLUMN_PX` (`shell/breakpoints.ts:46-47`) | an alias pair; nothing to do |

---

## 4 · What still depends on the orphans

### E2E — the four merge-blocking specs

Run by `playwright.config.ts`: `critical-path`, `chat-action`, and (inside `critical-path`) `match-play` and `side-game`.

**`GAME_ROUTES_AUDIT.md`'s Flag 1 is no longer true.** July found both spine specs created games by visiting `/games/new` and `/games/match/new`. Now:

- `e2e/critical-path.spec.ts` creates its game through the competition board's "Add a game" (`:73-98`, `:125-135`); `/games/new` appears only in comments (`:18`, `:73`, `:135`).
- `e2e/match-play.spec.ts` says its standalone-route helper was "retired as unreachable" (`:258-262`).

What the four specs still touch:

| Spec | Routes it visits | Orphan dependency |
|---|---|---|
| `critical-path.spec.ts` | `/trips/${id}/leaderboard` (`:150`, `:311`, `:383`) | **the `/leaderboard` alias** |
| `match-play.spec.ts` | `/leaderboard` (`:274`); `?view=cup` (`:450`); **`/trips/${id}/games/match/new?game=…` (`:293`)** | the alias, **and the match game route** — used by the "gear" entry, which `dirty settings refuse to leave silently` (`:186-188`) needs because "only the gear path gates a browser back" (`:264-266`) |
| `side-game.spec.ts` | `?view=cup`, `?view=cup&game=` | none |
| `chat-action.spec.ts` | `?view=cup`, `?view=trip` | none |

So two things block removal: the `/leaderboard` alias (4 uses) and `/games/match/new` with `?game=` (1 test). Every other game route has no merge-blocking spec.

Other specs: `games-stroke-play.spec.ts:100` visits bare `/games/new`; `correction-latency.spec.ts:269` and `handler-accumulation.spec.ts:208` visit `/games/manual?game=`. **No Playwright project runs `games-stroke-play`**; the other two run only under `MEASURE=1`. The 11 specs no project runs are `auth`, `competition-setup`, `dashboard`, `games-stroke-play`, `idea-comparison`, `idea-zone`, `itinerary-panel`, `news`, `trip-detail`, `trip-new`, `trip-settings`. `dashboard.spec.ts:205` still asserts "FAB navigates to /trips/new"; no project runs it, so nothing notices that in-app creation is a modal now (§1). (`CLAUDE.md` says "13 deferred"; I count 11.)

### Guard and unit tests

- `src/lib/gameRoutes.test.ts:6-54` pins every `gameHref` output, including the `/games/…` paths and `/games/scorecard`.
- `src/components/TripIdProvider.test.ts:70` allow-lists `leaderboard/page.tsx` as the one place that may read the `tripId` param directly.
- `src/components/TripTabBar.test.tsx` imports the dead `BottomNav` components; `components/shell/bottomNavInset.guard.test.ts:69` lists the file.
- `src/lib/botPaths.test.ts:130`, `src/lib/authExpiry.test.ts:84`, `src/app/auth/callback/route.test.ts:66` use `/games/match/new` as a **sample string**, not as a dependency on the route existing.
- `src/app/api/maxDuration.guard.test.ts:16-29` scans every `route.ts` under `src/app/api`; adding or removing an API route changes what it checks.

### Docs that name these things

`GAME_ROUTES_AUDIT.md` (superseded by this file); `TRACKER.md:361` (`games.listTypes`, `competitions.teamAssignmentCounts`; its line numbers `games.ts:225`, `competitions.ts:160` are stale, now `:702`, `:273`); `PERMISSIONS.md:256,407` (`removeOrganizer`); `DOMAIN_AND_EMAIL.md:23,134` (`src/lib/trpc.ts`); the leaderboard alias's own header (`leaderboard/page.tsx:7-30`) which says "8 places in the app" and "7 places in the E2E specs, including both merge-blocking ones" — both numbers are out of date (§1, §4).

---

## 5 · Where the redesign sends each screen

From `docs/design/REDESIGN_PLAN.md` (read at `eae2b834`):

- **Home** (Phase 4, `HOME_AND_NAV.md`) replaces `/dashboard` (§6 D5–D6; "‹ Home" title bar).
- **+ → Game → How to score → Who's playing → score sheet → finished game** (Phase 2, `GAME_LOOP.md`) retires **Quick Game** (D8, X4, Phase 2 line "Retires Quick Game"). Golf rounds reuse today's Quick Game setup sheet, `CoursePicker` and entry screens "unchanged" there, so those components are not replaced even though `/quick-game` is.
- **You → Golf courses** library (X8): "Builder is today's `/courses/new` (`CourseEntryFlow`), opened from the library and returning to it." `/courses/new` **stays**.
- **Standalone game routes**: no screen in the plan is a "game page at a URL". The finished-game screen and the score sheet are the replacements; trip golf games stay as panels over the cup board ("Already built: reuse it").
- **`/trips/new`**: the plan's "+ chooser (Game · Competition · Trip)" replaces the entry; the signup redirect would then point at the new first-run flow (Phase 0 "first-run and sign-up").
- **Chat** goes away ("News replaces it", hidden not deleted, §2 and Phase 4), which affects the chat helpers in §3c.
- **The `bbmi.app` → PMDF redirect** is a Phase 4 item (spec 5). That is the strongest reason the **outside-link check in §0 matters before the redesign ships**: the domain move will carry every old link with it.

---

## 6 · Verdict per orphan

"Keep" = in use. "Replace" names the plan's screen. "Delete candidate" lists what must change first.

| Orphan | Verdict | What has to change first |
|---|---|---|
| `/trips/[id]/games/scorecard` | **delete candidate (needs outside check)** | Nothing in-app navigates there. Drop the page, and decide whether `gameHref(…, {scorecard:true})` stays only as a boolean gate (rename it; today it is a URL builder used as a yes/no) and update `gameRoutes.test.ts:54`. Replaced by the scorecard overlay already in use (`GameRow.tsx:555`). |
| `/games/new` bare (stroke create) | **delete candidate (needs outside check)** | Remove the create branch in `StrokeGameView.tsx:845-855` and the retired `games-stroke-play.spec.ts`. |
| `/games/rack/new` bare (rack create) | **delete candidate** | Remove `startRack` and `createGame` in `RackGameView.tsx:198,564,1183`. |
| `/games/match/new` bare | already redirects; **keep as-is** | None. (`MatchGameView.tsx:1103-1107`.) |
| `/games/{new,match/new,rack/new,scramble/new,skins/new,manual,pickem}?game=` | **keep for now; replace in the redesign** with panels / the finished-game screen (Phase 2) | The Schedule tab's agenda chip links to them (`ScheduleTab.tsx:319`). Re-point it at `gamePanelHref` (the app's own panel URL, `gameRoutes.ts:158-160`), then the routes lose their only in-app caller. `match/new` also needs the gear-path E2E test (`match-play.spec.ts:186,293`) changed. **(needs outside check)** |
| `GameRow` `<Link href>` branches | **delete candidate** | `GameRow.tsx:630-642`, `:975-984` cannot render (§1). Safe once `gameHref` loses its callers. |
| `/trips/[id]/leaderboard` alias | **keep until the redesign** | 4 uses in merge-blocking E2E, the Schedule tab button (`ScheduleTab.tsx:1220` → `?tab=comp`), `TripIdProvider.test.ts:70`. Re-point the button at `gamesPageHref`, change the specs to `?view=cup`, then drop it. Possible old links (`?tab=comp`, bookmarks) — **needs outside check**. |
| `/trips/new` | **keep; replace in the redesign** with the first-run flow | Only the signup redirect reaches it (`callback/route.ts:93`). Do not delete before the redirect moves. |
| `/quick-game` | **replace in the redesign** (Phase 2, D8/X4) | Mobile-only entry; keep until the no-account score sheet ships. **(needs outside check)** for old bookmarks. |
| `/dashboard` | **replace in the redesign** (Home, Phase 4) | In use today. |
| `/courses/new` | **keep** (X8) | None. |
| `/auth/*`, `/invite`, `/privacy`, `/terms`, `/login`, `/` | **keep** | None. |
| `src/components/BottomNav.tsx` components | **delete candidate** | Move the `TabId` type to its own file (3 importers), then remove the two components, `TripTabBar.test.tsx`'s cases for them, and the guard-table row at `bottomNavInset.guard.test.ts:69`. |
| `InvitationCard.tsx`, `TeamMemberChip.tsx` | **delete candidate** | Nothing. |
| `src/lib/trpc.ts` | **delete candidate** | Correct `DOMAIN_AND_EMAIL.md:23,134`. |
| `@trpc/next` | **delete candidate** | `package.json` + lockfile only. |
| Never called, and either untested or tested only by their own tests: `games.listTypes`, `games.removeOrganizer`, `pickem.setPointsTotal`, `matches.reorder` (no test at all); `competitions.teamAssignmentCounts`, `datePoll.returnToPoll`, `teamAssignments.rosterFingerprint`, `playGroups.setParticipantStrokes` (tests only) | **delete candidate** | Edit `TRACKER.md:361` and `PERMISSIONS.md:256,407`; remove the 3 + 3 + 2 + 4 test call lines that exercise the last four. |
| 12 fixture-only procedures (`games.addParticipants`, `setStatus`, `enableScoring`, `disableScoring`, `setPointsTotal`, `setPointsDistribution`; `matches.setPairings`, `assignPlayer`, `setHandicap`, `setPointValue`, `enableScoring`; and `pickem.saveMatches`, whose tests are on the RPC) | **keep for now** | Rewrite the fixtures that seed games through them (e.g. 90 call lines for `games.enableScoring`, 82 for `matches.setPairings`, 51 for `games.addParticipants`) to go through `save_game_config`; then delete. |
| 20 unreferenced exports, 79 `export`-only extras | **delete / drop the keyword** | Appendix A1, A3. |

---

## Method and what the search could and could not see

- **Code is ground truth**; every row above cites `file:line` at `eae2b834`.
- **Absence of matches ≠ absence of search.** Proof that the searches can find what they claim to look for:
  - Template-string hrefs are caught: `lib/gameRoutes.ts:51,55,60,63` (`` `/trips/${tripId}/games/${seg}?game=…` ``) and `StrokeGameView.tsx:855` came up from the same `/games/(new|match|…)` and `/trips/${` greps that returned no navigator for `/games/scorecard`.
  - `router.push`, `router.replace`, `redirect()`, `<Link>` and `window.location` all appear in the results (`DashboardClient.tsx:535`, `CourseSearchPanel.tsx:211`, `page.tsx:108`, `authExpiry.ts:71`).
  - Email links were read directly (`src/lib/email.ts:58,124,283`); push URLs from every `sendPush` caller (`chatNotify.ts:203`, `newsNotify.ts:70`, `gameFinishNotify.ts:836,1425,1529`, `notifications.ts:206`, `pickemMatchesNotify.ts:78`); the service worker (`public/sw.js:61,68` only reads `data.url`); middleware (`middleware.ts:126-132`); `vercel.json` (regions only, no rewrites) and `next.config.ts` (no redirects).
  - The procedure parse is checked against an independent count (195 = 195 per file).
- The search excluded `design/`, `_archive/`, `.claude/` and `node_modules`. `design/` holds prototypes only (§3a).
- **What the repo cannot show:** production news posts, delivered notification payloads, Supabase auth email templates and redirect allow-list, user bookmarks. See §0.
- **Not done:** no browser session. "Reached by" is from the code that renders each control; a control hidden behind a feature flag or role I did not trace could be missing from §1.
- To regenerate: `npx --yes knip@5 --no-progress --reporter json`, strip the leading `[dotenv…]` line.

---

## Appendix A — knip exports triage (120)

Classified by a name search over `src/`, `e2e/`, `scripts/` (comment lines excluded). Regenerable: see Method.

### A1. Named nowhere else (20) — delete candidates

- `src/app/trips/[tripId]/components/AddPropertySheet.tsx` — PLATFORM_LABEL:20
- `src/app/trips/[tripId]/components/IdeaZonePanel.tsx` — CoPlannerPanel:1658
- `src/components/HelperCards.tsx` — HelperCardsWithLink:84
- `src/components/competition/CompetitionGamesPanel.tsx` — formatLabel:142
- `src/components/games/MatchSides.tsx` — MatchupChips:58
- `src/components/games/pickem/PickemTeamRollUp.tsx` — formatPayout:499
- `src/components/shell/contentArea.ts` — CONTENT_INSET_PX:75
- `src/lib/auth-context.tsx` — useAuthLoaded:66
- `src/lib/avatarIcons.ts` — AVATAR_ICON_IDS:140
- `src/lib/betDraft.ts` — MAX_BET_SIDES:58
- `src/lib/bracketDouble.ts` — doubleDrawMatchCount:189
- `src/lib/bracketPlacements.ts` — placementRows:143
- `src/lib/chatRoom.ts` — parseChatRoomKey:98, chatRoomMessageFilter:136, chatRoomLabel:148
- `src/lib/formatLines.ts` — MATCH_PLAY_WAYS_NOTE:46
- `src/lib/news.ts` — NEWS_BLOCK_TYPES:138
- `src/lib/quickGame.ts` — isStrokeGame:259
- `src/server/trpc.ts` — publicProcedure:278, protectedProcedure:289

### A2. Named only by tests (4)

- `src/components/BottomNav.tsx` — GlobalBottomNav:56, TripBottomNav:118
- `src/components/competition/CompetitionHero.tsx` — isRace:46
- `src/lib/configDraft.ts` — matchesToSaveRows:647

### A3. Used inside their own file only (79) — drop the `export`, keep the code

- `src/__tests__/helpers/strictTestClient.ts` — isInfrastructureFailure:51
- `src/app/trips/[tripId]/tabs/SplitPanel.tsx` — computeSplitDisplay:9
- `src/app/trips/[tripId]/tabs/components/CrewRoster.tsx` — RolePill:90
- `src/app/trips/[tripId]/tabs/components/LeaveTripButton.tsx` — OwnerCannotLeave:105
- `src/app/trips/[tripId]/tabs/components/TravelControls.tsx` — TRAVEL_MODE_META:65
- `src/app/trips/[tripId]/tabs/components/travelBands.ts` — firstName:86
- `src/app/trips/[tripId]/tabs/components/travelForm.ts` — parseArrivalDate:74, parseArrivalTime:87
- `src/components/InfoTileModal.tsx` — PICKER_ICONS:604
- `src/components/competition/CompetitionLeaderboard.tsx` — mergeByDisplayOrder:1045
- `src/components/competition/GameRow.tsx` — iconArmed:211
- `src/components/competition/PlaceRibbon.tsx` — MEDAL_OF_PLACE:15
- `src/components/games/ChecklistRow.tsx` — LOCKED_NOTE:78
- `src/components/games/GameChrome.tsx` — usePublishGameChrome:202
- `src/components/games/MatchGridRow.tsx` — MATCH_ROW_GRID:21
- `src/components/games/NonGolfSettingsRows.tsx` — TotalPoolRow:413
- `src/components/games/StandardGrid.tsx` — NAME_W_MIN:282, NAME_W:283, HOLE_W:284, FADE_W:294, SubCell:1304
- `src/components/games/bracket/BracketSeedList.tsx` — RandomizeSeedsPrompt:168
- `src/components/games/course/CoursePicker.tsx` — SavedScreen:1116
- `src/components/games/pickem/PickemGameCard.tsx` — COLLAPSE_MS:62
- `src/components/games/pickem/PickemSheet.tsx` — formatClosedAt:77, pickOutcome:220
- `src/components/games/pickem/PickemSlateModal.tsx` — MULTIPLIER_MIN:97, MULTIPLIER_MAX:98
- `src/components/games/pickem/PickemTeamRollUp.tsx` — formatPayoutValue:504, payoutUnit:510
- `src/components/games/pickem/slateRowVisual.tsx` — coverBoxStyle:319, statusToneColor:453, MultiplierBadge:474, SpreadBadge:504
- `src/components/games/quick/setupFields.tsx` — GloriousField:433
- `src/components/games/rack/RackBoard.tsx` — RsToggle:220
- `src/components/marketing/MarketingPage.tsx` — MARKETING_CSS:35
- `src/components/shell/breakpoints.ts` — SHELL_DESKTOP_PX:46, CHAT_COLUMN_PX:47, RAIL_YIELD_PX:79
- `src/components/shell/useAppView.ts` — APP_VIEWS:44
- `src/hooks/useRealtimeScoreEvents.ts` — readersFor:310
- `src/lib/betDraft.ts` — MAX_STAKE:56
- `src/lib/chatRoom.ts` — CHAT_ROOM_KINDS:35
- `src/lib/configDraft.ts` — toBracketConfig:210, rackGroupsToPersist:977
- `src/lib/dates.ts` — formatDate:44
- `src/lib/gameReadiness.ts` — setupReasonBlocked:216
- `src/lib/gameRoutes.ts` — PICKEM_ROUTE:27
- `src/lib/gameTypes.ts` — toGameType:617
- `src/lib/golfCourseApi.ts` — SEARCH_LIMIT:8
- `src/lib/lodgingDomains.ts` — isLodgingHost:29
- `src/lib/matchupApi.ts` — ESPN_BASE:99, normalizeQuery:273, scoreTeam:301
- `src/lib/news.ts` — newsBlockSchema:180
- `src/lib/pickemSheet.ts` — usableSubsetRanking:365
- `src/lib/pickemSlateDays.ts` — slateSortKey:151
- `src/lib/pwaInstall.ts` — MAX_DISMISSALS:67
- `src/lib/quickGame.ts` — QUICK_GAME_TYPE_ID:279, scoringEntityIds:605
- `src/lib/rosterMutations.ts` — rosterPatches:60
- `src/lib/sideBets.ts` — splitToPlayers:878
- `src/lib/ssrfGuard.ts` — parseIPv4:38, isBlockedIPv4:97, isBlockedIPv6:111
- `src/lib/stateText.ts` — LIVE_TEXT:24, SETTLED_TEXT:25
- `src/lib/teamTextColor.ts` — relativeLuminance:36
- `src/lib/tripStatus.ts` — subDays:38
- `src/server/lib/competitionLeaderboard.ts` — reconcileConvention:206
- `src/server/lib/gameReadiness.ts` — gameRowTouched:284
- `src/server/lib/gameStarted.ts` — startedGameIds:56
- `src/server/lib/recredit.ts` — RECREDIT_STALE_MESSAGE:287
- `src/server/lib/rosterChange.ts` — personUnfinishedGames:66, blockedRefusal:98, TEAM_HAS_RESULTS_MESSAGE:238, TEAM_NOT_EMPTY_MESSAGE:241
- `src/server/routers/teams.ts` — INDIVIDUALS_LOCKED_AT_FIRST_RESULT:83

### A4. Same name exists in another file (17) — re-exports or name collisions; not hand-confirmed one by one

- `src/components/competition/CompetitionGamesPanel.tsx` — Field:964
- `src/components/competition/GameRow.tsx` — gameHref:27, isGolfFormat:27
- `src/components/games/HandicapRoster.tsx` — HandicapRoster:134
- `src/components/games/course/CoursePicker.tsx` — CourseRow:604, Field:1206, Footer:1215
- `src/components/games/quick/setupFields.tsx` — CourseRow:155
- `src/components/games/skins/SkinsEntryView.tsx` — ScoreSaveBadge:428
- `src/lib/bracketAdvance.ts` — roundCount:418
- `src/lib/bracketPlacements.ts` — drawComplete:153
- `src/lib/chatRoom.ts` — isTeamRoom:107
- `src/lib/sideBets.ts` — playedThrough:702
- `src/lib/skinsOutbox.ts` — putIn:41, clearIn:44, entriesOf:51
- `src/server/lib/gameReadiness.ts` — ROSTER_TYPES:30

## Appendix B — knip types triage (229)

- Named nowhere else: 0
- Used inside their own file only: 208 (drop the `export`)
- Named only by tests: 2
- Same name in another file: 19
- Per-type list: `node` script output is not committed; rerun `npx knip@5 --reporter json` (strip the dotenv banner line before parsing).

## Appendix C — all 195 procedures, client-caller count

| Procedure | Kind | Defined | Client call sites (code lines) | Test call lines |
|---|---|---|---|---|
| `archivedIdeas.list` | query | `archivedIdeas.ts:21` | 5 | 4 |
| `archivedIdeas.archive` | mutation | `archivedIdeas.ts:46` | 2 | 9 |
| `archivedIdeas.remove` | mutation | `archivedIdeas.ts:109` | 1 | 2 |
| `competitions.myTeamColor` | query | `competitions.ts:63` | 5 | 10 |
| `competitions.getByTrip` | query | `competitions.ts:92` | 23 | 12 |
| `competitions.leaderboard` | query | `competitions.ts:120` | 22 | 115 |
| `competitions.faceBootstrap` | query | `competitions.ts:147` | 27 | 30 |
| `competitions.teamAssignmentCounts` | query | `competitions.ts:273` | 0 | 3 |
| `competitions.create` | mutation | `competitions.ts:301` | 1 | 34 |
| `competitions.update` | mutation | `competitions.ts:465` | 2 | 6 |
| `competitions.skipSuggestion` | mutation | `competitions.ts:513` | 1 | 8 |
| `competitions.delete` | mutation | `competitions.ts:555` | 1 | 11 |
| `competitions.resetScoring` | mutation | `competitions.ts:588` | 1 | 9 |
| `competitions.finish` | mutation | `competitions.ts:622` | 2 | 9 |
| `competitions.setTiebreakOrder` | mutation | `competitions.ts:662` | 1 | 2 |
| `competitions.resetToSkeleton` | mutation | `competitions.ts:704` | 1 | 5 |
| `courses.create` | mutation | `courses.ts:40` | 2 | 13 |
| `courses.search` | query | `courses.ts:119` | 2 | 2 |
| `courses.apiUsage` | query | `courses.ts:147` | 8 | 2 |
| `courses.list` | query | `courses.ts:165` | 3 | 1 |
| `courses.getById` | query | `courses.ts:183` | 16 | 2 |
| `datePoll.get` | query | `datePoll.ts:12` | 34 | 25 |
| `datePoll.addWindow` | mutation | `datePoll.ts:73` | 1 | 10 |
| `datePoll.castDateVote` | mutation | `datePoll.ts:119` | 1 | 17 |
| `datePoll.castVoteForMember` | mutation | `datePoll.ts:202` | 1 | 4 |
| `datePoll.removeWindow` | mutation | `datePoll.ts:276` | 1 | 3 |
| `datePoll.lockDateWindow` | mutation | `datePoll.ts:299` | 1 | 6 |
| `datePoll.unlock` | mutation | `datePoll.ts:367` | 3 | 7 |
| `datePoll.returnToPoll` | mutation | `datePoll.ts:455` | 0 | 3 |
| `datePoll.setPollMode` | mutation | `datePoll.ts:521` | 4 | 9 |
| `expenses.list` | query | `expenses.ts:12` | 25 | 4 |
| `expenses.create` | mutation | `expenses.ts:56` | 2 | 5 |
| `expenses.updateSplits` | mutation | `expenses.ts:144` | 1 | 4 |
| `expenses.optOut` | mutation | `expenses.ts:242` | 1 | 5 |
| `expenses.remove` | mutation | `expenses.ts:308` | 1 | 3 |
| `feedback.send` | mutation | `feedback.ts:15` | 1 | 6 |
| `games.create` | mutation | `games.ts:494` | 4 | 307 |
| `games.listTypes` | query | `games.ts:702` | 0 | 0 |
| `games.listByTrip` | query | `games.ts:705` | 21 | 10 |
| `games.sideBoard` | query | `games.ts:726` | 10 | 14 |
| `games.getById` | query | `games.ts:732` | 36 | 103 |
| `games.bracketPool` | query | `games.ts:800` | 2 | 0 |
| `games.bracketDraw` | query | `games.ts:839` | 6 | 16 |
| `games.pickWinner` | mutation | `games.ts:896` | 1 | 20 |
| `games.configHash` | query | `games.ts:1065` | 6 | 78 |
| `games.addParticipants` | mutation | `games.ts:1080` | 0 | 51 |
| `games.finish` | mutation | `games.ts:1157` | 1 | 261 |
| `games.update` | mutation | `games.ts:1521` | 2 | 21 |
| `games.setStatus` | mutation | `games.ts:1611` | 0 | 11 |
| `games.enableScoring` | mutation | `games.ts:1645` | 0 | 90 |
| `games.disableScoring` | mutation | `games.ts:1713` | 0 | 1 |
| `games.saveConfig` | mutation | `games.ts:1754` | 1 | 137 |
| `games.setPointsTotal` | mutation | `games.ts:2409` | 0 | 17 |
| `games.delete` | mutation | `games.ts:2456` | 1 | 18 |
| `games.setPointsDistribution` | mutation | `games.ts:2489` | 0 | 29 |
| `games.reorder` | mutation | `games.ts:2568` | 1 | 10 |
| `games.openCorrection` | mutation | `games.ts:2624` | 1 | 25 |
| `games.addOrganizer` | mutation | `games.ts:2649` | 1 | 14 |
| `games.removeOrganizer` | mutation | `games.ts:2671` | 0 | 0 |
| `games.listOrganizers` | query | `games.ts:2685` | 14 | 25 |
| `games.myDelegateGameIds` | query | `games.ts:2702` | 3 | 2 |
| `games.delegatesByTrip` | query | `games.ts:2714` | 1 | 2 |
| `games.resetScoring` | mutation | `games.ts:2747` | 1 | 19 |
| `games.resetToSkeleton` | mutation | `games.ts:2778` | 1 | 10 |
| `ghostCrew.create` | mutation | `ghostCrew.ts:21` | 2 | 49 |
| `ghostCrew.update` | mutation | `ghostCrew.ts:274` | 1 | 30 |
| `ghostCrew.remove` | mutation | `ghostCrew.ts:476` | 1 | 22 |
| `golfCourses.findOrCreate` | mutation | `golfCourses.ts:14` | 1 | 0 |
| `ideaLodging.list` | query | `ideaLodging.ts:12` | 5 | 4 |
| `ideaLodging.create` | mutation | `ideaLodging.ts:64` | 1 | 5 |
| `ideaLodging.update` | mutation | `ideaLodging.ts:126` | 1 | 3 |
| `ideaLodging.remove` | mutation | `ideaLodging.ts:174` | 1 | 3 |
| `ideas.list` | query | `ideas.ts:12` | 14 | 5 |
| `ideas.create` | mutation | `ideas.ts:54` | 2 | 12 |
| `ideas.update` | mutation | `ideas.ts:117` | 1 | 1 |
| `ideas.remove` | mutation | `ideas.ts:185` | 1 | 7 |
| `ideas.vote` | mutation | `ideas.ts:219` | 1 | 7 |
| `ideas.catalogList` | query | `ideas.ts:284` | 1 | 0 |
| `invites.claim` | mutation | `invites.ts:33` | 1 | 11 |
| `logistics.list` | query | `logistics.ts:12` | 22 | 2 |
| `logistics.create` | mutation | `logistics.ts:43` | 2 | 7 |
| `logistics.update` | mutation | `logistics.ts:117` | 1 | 2 |
| `logistics.confirm` | mutation | `logistics.ts:195` | 1 | 0 |
| `logistics.unconfirm` | mutation | `logistics.ts:211` | 1 | 0 |
| `logistics.remove` | mutation | `logistics.ts:230` | 1 | 2 |
| `matches.setPairings` | mutation | `matches.ts:77` | 0 | 82 |
| `matches.assignPlayer` | mutation | `matches.ts:220` | 0 | 3 |
| `matches.setHandicap` | mutation | `matches.ts:358` | 0 | 14 |
| `matches.setPointValue` | mutation | `matches.ts:456` | 0 | 6 |
| `matches.addMatch` | mutation | `matches.ts:501` | 1 | 4 |
| `matches.reorder` | mutation | `matches.ts:563` | 0 | 0 |
| `matches.enableScoring` | mutation | `matches.ts:600` | 0 | 12 |
| `matches.setResult` | mutation | `matches.ts:670` | 1 | 36 |
| `matches.listByGame` | query | `matches.ts:766` | 15 | 32 |
| `matchOutcomes.upsertOutcome` | mutation | `matchOutcomes.ts:37` | 1 | 41 |
| `matchOutcomes.deleteOutcome` | mutation | `matchOutcomes.ts:115` | 1 | 14 |
| `matchOutcomes.listByGame` | query | `matchOutcomes.ts:168` | 1 | 9 |
| `messages.list` | query | `messages.ts:279` | 8 | 27 |
| `messages.unreadCountByChannel` | query | `messages.ts:392` | 3 | 3 |
| `messages.unreadCount` | query | `messages.ts:404` | 4 | 23 |
| `messages.readState` | query | `messages.ts:418` | 3 | 6 |
| `messages.markRead` | mutation | `messages.ts:475` | 1 | 30 |
| `messages.markViewing` | mutation | `messages.ts:543` | 1 | 8 |
| `messages.send` | mutation | `messages.ts:575` | 1 | 53 |
| `messages.clearChannel` | mutation | `messages.ts:712` | 1 | 5 |
| `news.list` | query | `news.ts:109` | 4 | 16 |
| `news.unreadCount` | query | `news.ts:174` | 4 | 7 |
| `news.markRead` | mutation | `news.ts:210` | 1 | 4 |
| `news.roster` | query | `news.ts:243` | 2 | 4 |
| `news.competitionDraw` | query | `news.ts:284` | 1 | 3 |
| `news.create` | mutation | `news.ts:321` | 1 | 21 |
| `news.resend` | mutation | `news.ts:387` | 1 | 5 |
| `news.update` | mutation | `news.ts:426` | 1 | 2 |
| `news.setPinned` | mutation | `news.ts:471` | 1 | 1 |
| `news.delete` | mutation | `news.ts:492` | 2 | 2 |
| `notifications.status` | query | `notifications.ts:51` | 1 | 0 |
| `notifications.subscribe` | mutation | `notifications.ts:60` | 2 | 7 |
| `notifications.isRegistered` | query | `notifications.ts:95` | 1 | 7 |
| `notifications.unsubscribe` | mutation | `notifications.ts:114` | 1 | 4 |
| `notifications.getPreferences` | query | `notifications.ts:134` | 7 | 9 |
| `notifications.setPreference` | mutation | `notifications.ts:146` | 1 | 14 |
| `notifications.testSend` | mutation | `notifications.ts:199` | 1 | 1 |
| `pickem.get` | query | `pickem.ts:125` | 14 | 29 |
| `pickem.saveConfig` | mutation | `pickem.ts:481` | 1 | 8 |
| `pickem.savePicks` | mutation | `pickem.ts:526` | 1 | 4 |
| `pickem.savePicksFor` | mutation | `pickem.ts:582` | 1 | 0 |
| `pickem.sheetStatus` | query | `pickem.ts:638` | 2 | 0 |
| `pickem.setPointsTotal` | mutation | `pickem.ts:668` | 0 | 0 |
| `pickem.saveMatches` | mutation | `pickem.ts:700` | 0 | 0 |
| `pickem.setResult` | mutation | `pickem.ts:746` | 1 | 11 |
| `pickem.setScore` | mutation | `pickem.ts:831` | 1 | 11 |
| `pickem.setDeadline` | mutation | `pickem.ts:853` | 1 | 0 |
| `pickem.setPhase` | mutation | `pickem.ts:880` | 1 | 4 |
| `playGroups.setFoursomes` | mutation | `playGroups.ts:26` | 1 | 25 |
| `playGroups.setParticipantStrokes` | mutation | `playGroups.ts:117` | 0 | 4 |
| `playGroups.listByGame` | query | `playGroups.ts:158` | 12 | 2 |
| `quickInfoTiles.list` | query | `quickInfoTiles.ts:10` | 8 | 3 |
| `quickInfoTiles.create` | mutation | `quickInfoTiles.ts:35` | 1 | 4 |
| `quickInfoTiles.update` | mutation | `quickInfoTiles.ts:79` | 1 | 1 |
| `quickInfoTiles.remove` | mutation | `quickInfoTiles.ts:126` | 1 | 1 |
| `recredits.candidates` | query | `recredits.ts:35` | 2 | 3 |
| `recredits.preview` | query | `recredits.ts:45` | 1 | 2 |
| `recredits.confirm` | mutation | `recredits.ts:54` | 1 | 7 |
| `schedule.list` | query | `schedule.ts:10` | 19 | 4 |
| `schedule.create` | mutation | `schedule.ts:34` | 1 | 5 |
| `schedule.update` | mutation | `schedule.ts:89` | 2 | 1 |
| `schedule.reorder` | mutation | `schedule.ts:159` | 1 | 2 |
| `schedule.remove` | mutation | `schedule.ts:203` | 1 | 2 |
| `scores.upsertEntry` | mutation | `scores.ts:25` | 1 | 114 |
| `scores.deleteEntry` | mutation | `scores.ts:186` | 1 | 5 |
| `scores.listByGame` | query | `scores.ts:246` | 7 | 25 |
| `skinsOutcomes.upsertHole` | mutation | `skinsOutcomes.ts:39` | 1 | 5 |
| `skinsOutcomes.clearHole` | mutation | `skinsOutcomes.ts:135` | 1 | 0 |
| `skinsOutcomes.listByGame` | query | `skinsOutcomes.ts:188` | 2 | 1 |
| `teamAssignments.list` | query | `teamAssignments.ts:111` | 17 | 18 |
| `teamAssignments.rosterFingerprint` | query | `teamAssignments.ts:120` | 0 | 2 |
| `teamAssignments.hasResults` | query | `teamAssignments.ts:131` | 9 | 5 |
| `teamAssignments.previewChange` | query | `teamAssignments.ts:140` | 1 | 9 |
| `teamAssignments.assign` | mutation | `teamAssignments.ts:159` | 1 | 71 |
| `teamAssignments.remove` | mutation | `teamAssignments.ts:283` | 1 | 23 |
| `teamAssignments.setCaptain` | mutation | `teamAssignments.ts:357` | 1 | 21 |
| `teamAssignments.reorder` | mutation | `teamAssignments.ts:407` | 1 | 15 |
| `teams.list` | query | `teams.ts:164` | 13 | 9 |
| `teams.create` | mutation | `teams.ts:172` | 1 | 14 |
| `teams.update` | mutation | `teams.ts:255` | 1 | 18 |
| `teams.delete` | mutation | `teams.ts:325` | 1 | 25 |
| `tripMembers.list` | query | `tripMembers.ts:129` | 55 | 24 |
| `tripMembers.checkEmail` | query | `tripMembers.ts:142` | 1 | 0 |
| `tripMembers.departedNames` | query | `tripMembers.ts:185` | 3 | 5 |
| `tripMembers.departureSummary` | query | `tripMembers.ts:239` | 2 | 14 |
| `tripMembers.add` | mutation | `tripMembers.ts:277` | 1 | 13 |
| `tripMembers.updateRole` | mutation | `tripMembers.ts:356` | 3 | 6 |
| `tripMembers.updateNickname` | mutation | `tripMembers.ts:423` | 1 | 8 |
| `tripMembers.remove` | mutation | `tripMembers.ts:477` | 1 | 29 |
| `tripMembers.leave` | mutation | `tripMembers.ts:523` | 1 | 5 |
| `tripMembers.inviteByEmail` | mutation | `tripMembers.ts:565` | 1 | 19 |
| `tripMembers.updateTravel` | mutation | `tripMembers.ts:788` | 1 | 7 |
| `tripMembers.updateMemberTravel` | mutation | `tripMembers.ts:850` | 2 | 3 |
| `tripMembers.sendInvitationBlast` | mutation | `tripMembers.ts:913` | 1 | 12 |
| `trips.list` | query | `trips.ts:12` | 20 | 25 |
| `trips.getById` | query | `trips.ts:94` | 54 | 15 |
| `trips.create` | mutation | `trips.ts:117` | 1 | 16 |
| `trips.lockDestination` | mutation | `trips.ts:225` | 2 | 7 |
| `trips.renameTripName` | mutation | `trips.ts:266` | 1 | 4 |
| `trips.transferOwnership` | mutation | `trips.ts:295` | 1 | 10 |
| `trips.lockDates` | mutation | `trips.ts:389` | 3 | 2 |
| `trips.delete` | mutation | `trips.ts:473` | 1 | 6 |
| `trips.updateAboutMessage` | mutation | `trips.ts:497` | 1 | 0 |
| `trips.changeDestination` | mutation | `trips.ts:544` | 1 | 5 |
| `users.getMe` | query | `users.ts:11` | 12 | 10 |
| `users.updateMe` | mutation | `users.ts:31` | 1 | 2 |
| `users.updateAvatar` | mutation | `users.ts:72` | 1 | 11 |
| `users.search` | query | `users.ts:99` | 1 | 6 |
| `users.deletionBlockers` | query | `users.ts:148` | 1 | 0 |
| `users.deleteMe` | mutation | `users.ts:185` | 1 | 3 |

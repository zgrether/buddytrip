# Data Freshness & Request Inventory Audit

**Date:** 2026-07-24 · **Auditor:** Claude Code (Opus) · **Scope:** whole-app data fetching —
every router, query hook, the Realtime layer, middleware, and the trip / chat / competition surfaces.

**Method.** Code is ground truth; every claim cites `file:line`. Audited against a pristine export of
`main` @ **`dc72a456`** (see §0 — no working tree was on `main`). Production was **not** touched
(per spec: a parallel session-expiry measurement is running against prod logs). No tests were run.
Library defaults were read from **installed source in `node_modules`**, not from memory. Anything
not provable from code is marked **unconfirmed** and escalated to §9 rather than inferred.

**This is a read-only audit. Nothing was fixed, and no file other than this one was created or modified.**

---

## 0 · Phase 0 baseline + STOP flags

| Check | `AUDIT_REPORT.md` expectation | Actual on `main` @ `dc72a456` | Verdict |
|---|---|---|---|
| Next.js | 15.5.12 | `15.5.12` (`package.json`, installed) | ✅ match |
| React | 18.3.1 | `18.3.1` | ✅ match |
| tRPC | 11.12 | `@trpc/server` `11.12.0` | ✅ match |
| TanStack Query | 5.90 | `5.90.21` | ✅ match |
| Supabase-js | 2.99 | `2.99.1` (`@supabase/ssr` `0.9.0`) | ✅ match |
| Migrations | "≈090" (`AUDIT_REPORT.md:10`) | **94 active**, highest **`092`** (+76 in `_archive/`) | ⚠️ minor drift |

### 🚩 FLAG 1 — no working tree is on `main` (deviation from the spec's opening instruction)

The spec says "Confirm you are on `main` and up to date before starting." That was **not possible**:

```
C:/Users/zgret/Repos/Claude/buddytrip                    2b1393ef [fix/push-enable-affordance]
.claude/worktrees/heuristic-hypatia-e0358e               390001fc [claude/vercel-cpu-burn-diagnosis-8e1f51]
.claude/worktrees/jovial-wu-5b0b7b                       15e43b75 (detached HEAD)
.claude/worktrees/upbeat-grothendieck-b36bb3             557d72be [claude/upbeat-grothendieck-b36bb3]
```

This session runs **inside the worktree checked out to `claude/vercel-cpu-burn-diagnosis-8e1f51`** — the
branch the spec puts out of scope. That branch is also **5 commits behind `main`** (`main` has since
gained #678–#682, the entire push-notification subsystem: `notifications` router, `pushSubscriptions`,
`ChatNotifyToggle`, `InstallBanner`). Auditing in place would have (a) audited post-fix code for the very
commit the spec asks me to evaluate as possibly inert, and (b) **missed `notifications.getPreferences`
entirely** — a procedure named in the cold-open ground truth.

**Resolution:** `main` was exported read-only via `git archive main` to a scratchpad tree and audited
there. The out-of-scope branch was **not** merged, rebased, modified, or checked out. Local `main`
== `origin/main` == `dc72a456` (verified up to date).

### 🚩 FLAG 2 — migration drift (minor, not material)

`AUDIT_REPORT.md:10` says "migrations ≈090". Actual: **94 active migrations, highest `092`** — `091`
(expense-own-receipt RLS) and `092` (push_subscriptions) landed after that audit. Expected drift, no
bearing on data freshness. **Not treated as a blocking STOP.**

### 🚩 FLAG 3 — tab-state mechanism differs from `NAV_AUDIT.md` §1b (spec anticipated this)

**PARTLY TRUE.** Detail in §4.1. The `useState` / read-`?tab=`-once / never-written-back mechanism is
**still true** for the 5 in-page tabs, but **`comp` is no longer a tab at all** — it is a separate route
(`/trips/[tripId]/leaderboard`) reached by `router.push`. `NAV_AUDIT.md`'s "6-tab host / 7 `setActiveTab`
call sites" framing no longer matches code.

### 🚩 FLAG 4 — security

**No new security issue found in code.** Service-role key is confined to `src/lib/supabase-admin.ts:18-26`
and every importer lives under `src/server/` — nothing client-bundled (§6.5). **However**, the *already-filed*
issue **#634** (Vercel Preview carries the RLS-bypass service-role key **and** points at prod Supabase —
`ENVIRONMENT_AUDIT.md:31-33`) remains open and is **not** verifiable from source. It is unchanged, not new.

### ⚠️ One STOP-adjacent judgement call

Task 5 asks for "the current plan's Realtime limits" and Task 3's `/login` anomaly ultimately needs one
log field. Neither is answerable from source. Per the spec's own instruction I did **not** observe
production — both are escalated to §9 rather than guessed.

---

## 1 · The query inventory

**Legend.** `STRUCTURE_QUERY` (`src/lib/queryConfig.ts:42-45`) = `{ staleTime: Infinity, gcTime: 30min }`.
**Inherited** = global defaults from `src/lib/providers.tsx:70-78` (`staleTime: 60_000`,
`refetchOnWindowFocus: false`, `retry: 1`) + library defaults (`gcTime: 5min`, `refetchOnMount: true`,
`refetchIntervalInBackground: undefined`). **Every procedure below is `authedProcedure`** — no
`publicProcedure` is reachable from any client call site in the app (verified across
`src/server/routers/*.ts`). Classes: **Ref**=Reference · **Slow**=Slow-collaborative ·
**Live**=Live-competitive · **Conv**=Conversational.

### 1.1 Always-mounted shell — fires on EVERY trip-page load

`TopNav` is rendered unconditionally at `src/app/trips/[tripId]/page.tsx:393`.

| Procedure | Call site | Component | Mounted | Effective options | Class | Mismatch? |
|---|---|---|---|---|---|---|
| `trips.list` | `src/components/TopNav.tsx:96` | TopNav | always | inherited; `enabled: !hideTripSwitcher` | Ref | No |
| `news.unreadCount` | `src/components/NewsPanel.tsx:61` | NewsToolButton (`TopNav.tsx:352`) | always | inherited; `enabled: !!tripId` | Conv | No — cheap count |
| `messages.list` (infinite, crew) | `src/components/FloatingChatPanel.tsx:1108` | ChatToolButton (`TopNav.tsx:383`) | **always — panel CLOSED** | inherited; `enabled: !!tripId` | Conv | **YES** — 50-row page fetched for a badge |
| `messages.list` (infinite, planning) | `src/components/FloatingChatPanel.tsx:1118` | ChatToolButton | **always (organizers)** | inherited; `enabled: !!tripId && canSeeOrganizers` | Conv | **YES** — 2nd 50-row page |
| `messages.readState` | `src/components/FloatingChatPanel.tsx:1134` | ChatToolButton | always | inherited | Conv | No |
| `notifications.status` | `src/components/pwa/InstallBanner.tsx:47` | InstallBanner (`TopNav.tsx:336`) | always, no gate | **`staleTime: Infinity`** (explicit) | Ref | No |
| `users.getMe` | `src/components/UserMenu.tsx:45` | UserMenu (`TopNav.tsx:314`) | always, no gate | inherited | Ref | No |
| `trips.list` | `src/components/FeedbackModal.tsx:118` | FeedbackModal (`TopNav.tsx:327`) | always (**no `enabled` gate**, unlike `users.getMe:121` which has `enabled: open`) | inherited | Ref | Informational — dedupes to TopNav's key, 0 extra requests |

`BottomNav.tsx` fires **no tRPC** — only `router.prefetch()` for route JS (`src/components/BottomNav.tsx:141`).

### 1.2 Trip page top-level — `src/app/trips/[tripId]/page.tsx`

| Line | Procedure | `enabled` | Gates `dataLoading`? | Class |
|---|---|---|---|---|
| 658 | `trips.resolveSlug` | `!isId`, `retry: false` | blocks the whole body (separate spinner) | Ref |
| 81 | `trips.getById` | — | ✅ | Ref/Slow |
| 89 | `ideas.list` | — | ✅ | Slow |
| 90 | `tripMembers.list` | — | ✅ | Slow |
| 97 | `datePoll.get` | — | ✅ | Slow |
| 100 | `quickInfoTiles.list` | — | ✅ | Slow |
| 107 | `competitions.getByTrip` | — | ✅ | Slow |
| 116 | `schedule.list` | — | ✅ | Slow |
| 118 | `logistics.list` | — | ✅ | Slow |
| 123 | `expenses.list` | — | ❌ background prefetch | Slow |
| 126 | `teams.list` | `!!competition?.id` | ❌ | Slow |
| 130 | `teamAssignments.list` | `!!competition?.id` | ❌ | Slow |

All inherited options (60s staleTime). **8 queries gate first paint** (`page.tsx:135-137`). None use `STRUCTURE_QUERY`.

### 1.3 Trip tabs & panels (all inherited options, all dedupe against §1.2 keys)

| Procedure | Call sites | Mounted | Class | Mismatch? |
|---|---|---|---|---|
| `ideas.list` | `tabs/HomeTab.tsx:36`, `components/IdeaZonePanel.tsx:1362,1797` | Home tab | Slow | No |
| `ideas.catalogList` | `components/CatalogBrowser.tsx:132` | idea-phase empty state | Ref | No |
| `archivedIdeas.list` | `components/ArchivedIdeasBrowser.tsx:91`, `src/components/profile/ArchivedIdeasPanel.tsx:25` | empty state / profile tab | Slow | No |
| `ideaLodging.list` | `IdeaZonePanel.tsx:117,1355` | per idea card / sheet | `staleTime: 30_000` (explicit) → Slow | No |
| `tripMembers.list` | `useTripRole.ts:11`, `tabs/CrewTab.tsx:519`, `tabs/ExpensesTab.tsx:26`, `setup-guide/FreshTripGuide.tsx:78`, `SetDatesFlipCard.tsx:88`, `tabs/components/DatePollCard.tsx:56`, `ItineraryView.tsx:101`, `CrewEmailPanel.tsx:87`, `FloatingChatPanel.tsx:258`, `TripSettingsModal.tsx:170` | various | Slow | No (dedupes) |
| `tripMembers.checkEmail` | `src/components/emailValidation.tsx:34` | invite form, debounced | `staleTime: 30_000`, gated | Ref | No |
| `datePoll.get` | `tabs/components/DatePollCard.tsx:55` | Home tab | Slow | No |
| `quickInfoTiles.list` | `src/components/TripHeaderDock.tsx:345` | header dock, every tab | Slow | No |
| `competitions.getByTrip` | `setup-guide/CompetitionEnableCard.tsx:27`, `tabs/ScheduleTab.tsx:531`, `TripSettingsModal.tsx:101` | various | Slow | No |
| `schedule.list` | `tabs/ScheduleTab.tsx:526`, `ItineraryView.tsx:102`, `FreshTripGuide.tsx:80` | Home/Schedule | Slow | No |
| `logistics.list` | `components/LodgingPanel.tsx:433`, `tabs/LodgingTab.tsx:27`, `ItineraryView.tsx:103`, `FreshTripGuide.tsx:79` | Lodging/Home | Slow | No |
| `expenses.list` | `tabs/ExpensesSection.tsx:580`, `tabs/ExpensesTab.tsx:27` | Expenses tab | Slow | No |
| `trips.getById` | `components/AddScheduleItemSheet.tsx:144`, `LodgingPanel.tsx:437` | modal / tab | Ref | No |
| `games.listByTrip` | `tabs/ScheduleTab.tsx:532` | Schedule tab — **only holder, not parent-prefetched** | Slow | No |
| `trips.list` | `src/components/TripSwitcher.tsx:79` (`enabled: open`), `src/app/dashboard/DashboardClient.tsx:69` | switcher / dashboard | Ref | No |
| `users.getMe` | `src/app/profile/page.tsx:102`, `DashboardClient.tsx:65`, `FeedbackModal.tsx:121` | page / modal | Ref | No |

### 1.4 Chat / News / Notifications

| Procedure | Call site | Mounted | Class | Mismatch? |
|---|---|---|---|---|
| `messages.list` (infinite ×2) | `FloatingChatPanel.tsx:230,239` | panel-open only (`:70`) | Conv | No |
| `messages.readState` | `FloatingChatPanel.tsx:288` | panel-open | Conv | No |
| `messages.markRead` (mut) | `FloatingChatPanel.tsx:331`, effect `:340-348` | panel-open | Conv | No |
| `messages.clearChannel` (mut) | `TripSettingsModal.tsx:186` | owner danger-zone | — | — |
| `news.list` | `NewsPanel.tsx:118` | panel-open only (`:69`) | Conv | No — correctly cold |
| `news.list` (prefetch) | `TopNav.tsx:365` | **hover/focus/pointerdown** on News button | Conv | No — good pattern |
| `news.roster` | `news/NewsComposer.tsx:847`, `news/RichTextEditor.tsx:188` | composer only | Ref | No |
| `news.competitionDraw` | `news/NewsComposer.tsx:942` | composer only | Ref | No |
| `notifications.getPreferences` | `src/components/ChatNotifyToggle.tsx:20` | **chat-panel-open only** (`FloatingChatPanel.tsx:562,636`) | Conv | No |
| `notifications.subscribe` / `setPreference` / `testSend` (muts) | `InstallBanner.tsx:50`, `ChatNotifyToggle.tsx:23`, `profile/page.tsx:538` | user-gesture only | — | — |

> **Note on the ground truth.** `notifications.getPreferences` is mounted **only** when the chat panel is
> open. Its presence in the cold-open trace therefore implies a **real user tap on Chat** inside the 18s
> window — it is not part of the automatic cascade. Same for `messages.markRead` (`FloatingChatPanel.tsx:331`).

### 1.5 Competition & games

| Procedure | Call site | Mounted | Effective options | Class | Mismatch? |
|---|---|---|---|---|---|
| `competitions.faceBootstrap` | `competition/LiveFaceClient.tsx:99` | Live-face root, always | `STRUCTURE_QUERY` + SSR `initialData` | Ref | No |
| **`competitions.leaderboard`** | `competition/CompetitionLeaderboard.tsx:108` | board, every face load | inherited + **`refetchInterval: 30_000`** | **Live** | No — correct |
| **`competitions.leaderboard`** | `competition/GamePageHeader.tsx:43-46` | **every** game view header | **`STRUCTURE_QUERY` (staleTime ∞)** | **Live** | **🔴 YES — see §8-F4** |
| **`competitions.leaderboard`** | `games/NonGolfGameView.tsx:88` | non-golf view | inherited, **no poll** | **Live** | **🔴 YES — no freshness path** |
| `games.myDelegateGameIds` | `CompetitionLeaderboard.tsx:123` | board | `STRUCTURE_QUERY` | Ref | No |
| `users.getMe` | `CompetitionLeaderboard.tsx:137`, `LiveFaceClient.tsx:114`, `TeamsPanel.tsx:327` | board / face / panel | `STRUCTURE_QUERY` / inherited / inherited | Ref | Minor — 3 policies, 1 key |
| `teamAssignments.list` | `CompetitionLeaderboard.tsx:138`, `CompetitionSettingsModal.tsx:212`, `TeamsPanel.tsx:312,1324`, `useCanEditTeam.ts:56` | board / modals | `STRUCTURE_QUERY` in 2, inherited in 3 | Ref | Minor — policy drift |
| `tripMembers.list` | `CompetitionLeaderboard.tsx:179` (prefetch), `LiveFaceClient.tsx:171`, `CompetitionGamesPanel.tsx:136`, `TeamsPanel.tsx:324,1320`, `GameIdentityHeader.tsx:76`, +§1.3 sites | many | **5+ different policies** | Ref | Minor — see §8-F8 |
| `games.listByTrip` / `teams.list` | `CompetitionFace.tsx:122,214` | face | `STRUCTURE_QUERY` (cache-hit off bootstrap seed) | Ref | No |
| `teamAssignments.rosterLocked` | `CompetitionSettingsModal.tsx:113`, `TeamsPanel.tsx:320,1672` | modals | inherited | Ref | Minor |
| **`games.configHash`** | `hooks/useConfigSync.ts:56-63` | all 4 game views | **poll 20s**, `refetchIntervalInBackground: false` | Ref | Dup — see §8-F7 |
| **`games.configHash`** | `hooks/useConfigDraft.ts:76-79` | all 4 game views | **poll 20s**, `refetchIntervalInBackground: false` | Ref | Dup (same key, dedupes) |
| **`scores.listByGame`** | `games/MatchGameView.tsx:295`, `RackGameView.tsx:159`, `StrokeGameView.tsx:102` | game views | **poll 20s**, bg false | **Live** | No — poll is the only option (§5-F) |
| **`matchOutcomes.listByGame`** | `games/MatchGameView.tsx:304` | match view | **poll 20s**, bg false | **Live** | No — same |
| `games.listOrganizers` | `MatchGameView.tsx:635`, `RackGameView.tsx:166`, `StrokeGameView.tsx:265` (`STRUCTURE_QUERY`); `NonGolfGameView.tsx:143` (inherited); `hooks/useGameEditAccess.ts:40` (**`staleTime: 0`, `refetchOnWindowFocus: true`**) | all game views | **3 conflicting policies on 1 key** | Ref | **YES — §8-F6** |
| `games.getById` | `MatchGameView.tsx:287`, `RackGameView.tsx:152`, `StrokeGameView.tsx:92`, `NonGolfGameView.tsx:75`, `ScorecardPreviewSheet.tsx:31`, `games/scorecard/page.tsx:42` | game views | `STRUCTURE_QUERY` | Ref | No |
| `matches.listByGame` | `MatchGameView.tsx:290` | match view | `STRUCTURE_QUERY` | Ref | No |
| `playGroups.listByGame` | `RackGameView.tsx:155`, `StrokeGameView.tsx:260` | views | `STRUCTURE_QUERY` | Ref | No |
| `trips.resolveSlug` | `MatchGameView.tsx:146`, `RackGameView.tsx:68`, `StrokeGameView.tsx:74`, `NonGolfGameView.tsx:65`, `games/scorecard/page.tsx:35` | views | `STRUCTURE_QUERY`, `retry:false` | Ref | No |
| `competitions.getByTrip` | `MatchGameView.tsx:155`, `RackGameView.tsx:145`, `NonGolfGameView.tsx:79` | views | `STRUCTURE_QUERY` | Ref | No |
| `teams.list` / `teamAssignments.list` | `MatchGameView.tsx:158,165`, `RackGameView.tsx:147,148`, `StrokeGameView.tsx:258,259` | views | `STRUCTURE_QUERY` | Ref | No |
| `courses.getById` | `hooks/useScorecardTeeRows.ts:36-43` (`STRUCTURE_QUERY`); `course/CourseRowContent.tsx:75`, `GameSetupRows.tsx:151` (inherited); imperative `.fetch` at `MatchGameView.tsx:731,759`, `RackGameView.tsx:492,514`, `StrokeGameView.tsx:428,450` | views/rows | **3 policies** | Ref | Minor |
| `courses.list` / `courses.search` | `course/CoursePicker.tsx:106,132`, `CourseSearchPanel.tsx:52,63` | picker | inherited, gated | Ref | No |
| `courses.apiUsage` | `CoursePicker.tsx:111`, `CourseSearchPanel.tsx:53` | picker | `staleTime: 0` (explicit) | Ref | No — intentional |
| `games.listByTrip` | `RackGameView.tsx:78` | resume-latest | `STRUCTURE_QUERY` | Ref | No |

**Every polling query in the entire app (exhaustive — 4 procedures, 8 call sites):**

| Procedure | Interval | `refetchIntervalInBackground` | Sites |
|---|---|---|---|
| `competitions.leaderboard` | **30 s** (literal) | **not set** → falsy (see §2) | `CompetitionLeaderboard.tsx:115` |
| `games.configHash` | **20 s** (`GAME_SYNC_INTERVAL_MS`, `useConfigSync.ts:13`) | explicit `false` | `useConfigSync.ts:60`, `useConfigDraft.ts:78` |
| `scores.listByGame` | 20 s | explicit `false` | `MatchGameView.tsx:297`, `RackGameView.tsx:161`, `StrokeGameView.tsx:106` |
| `matchOutcomes.listByGame` | 20 s | explicit `false` | `MatchGameView.tsx:306` |

**No polling exists outside the competition/games surfaces.** Trip, chat, news, profile, and nav
surfaces contain zero `refetchInterval`.

---

## 2 · Global query configuration

**Constructed at `src/lib/providers.tsx:51-81`:**

| Option | Global value | Source |
|---|---|---|
| `staleTime` | **60_000** | explicit, `providers.tsx:72` |
| `refetchOnWindowFocus` | **false** | explicit, `providers.tsx:76` |
| `retry` | **1** | explicit, `providers.tsx:77` |
| `gcTime` | 5 min | library default (not overridden) |
| `refetchOnMount` | `true` | library default |
| `refetchInterval` | none | per-call-site only |
| `refetchIntervalInBackground` | **not set anywhere globally** | — |

`httpBatchLink` (`providers.tsx:86-89`) sets only `url` + `transformer` — **no `maxURLLength`, no custom
batching window**, so it uses the library default: everything dispatched in the same synchronous
tick/microtask coalesces into one HTTP POST.

### 2.1 The `refetchIntervalInBackground` question — SETTLED, and it matters

**TanStack Query v5.90.21's built-in default is `undefined` (falsy). The global config does not override it.**

Evidence from installed source — `node_modules/@tanstack/query-core/build/modern/queryObserver.js:213-217`:

```js
this.#refetchIntervalId = timeoutManager.setInterval(() => {
  if (this.options.refetchIntervalInBackground || focusManager.isFocused()) {
    this.#executeFetch();
  }
}, this.#currentRefetchInterval);
```

`refetchIntervalInBackground` appears **exactly once in the entire modern build** — that line. No default
is ever assigned to it, so it is `undefined` unless a call site sets it.

And `focusManager.js:56-60`:

```js
isFocused() {
  return globalThis.document?.visibilityState !== "hidden";
}
```

So "focused" means **document is visible**. The interval *timer* keeps ticking when hidden, but
`#executeFetch()` is skipped — **no network request, no server CPU**.

> ### 🔴 Consequence: the pending commit `500bb56c` is INERT
>
> The unmerged branch adds `refetchIntervalInBackground: false` to the leaderboard poll
> (`CompetitionLeaderboard.tsx`). Since `undefined` and `false` are **both falsy at the same `||`**,
> this changes **nothing at runtime**. The leaderboard poll on `main` **already** pauses in a hidden tab.
>
> The spec's suspicion is confirmed. This also means the earlier CPU diagnosis attributing sustained
> burn to *backgrounded* leaderboard polling was **wrong in mechanism** — and the production ground
> truth agrees with the code, not the diagnosis: **"a locked Android PWA generates exactly zero
> requests"** and **"sustained burn came from desktop tabs"** (i.e. *visible* tabs, which poll correctly
> by design). The real burn is the `/login` redirect loop (§6.4), not background polling.
>
> Note the 8 call sites that *do* set it explicitly (§1.5) are equally inert — but they are harmless,
> self-documenting, and should not be churned.

**Explicit vs default across the app:** of 4 polling procedures / 8 poll call sites, **7 set
`refetchIntervalInBackground: false` explicitly** and **1 relies on the default**
(`CompetitionLeaderboard.tsx:115`). Behaviour is identical in all 8. Every non-polling query
(≈100 call sites) relies on the default, where the option is meaningless.

### 2.2 Retry configuration — the failed-poll multiplier

`retry: 1` (`providers.tsx:77`) = **1 retry after the initial failure → 2 requests per failed tick**,
a **2× multiplier**. There is no `retryDelay` override, so v5's exponential backoff
(`min(1000 * 2^attempt, 30000)`) applies — the retry lands ~1 s later.

Applied to the §6.4 redirect loop, one failed 30 s poll tick costs **2 × (middleware invocation +
307 + followed POST to `/login` + full `/login` page render)**. Mutations inherit the same `retry: 1`.

---

## 3 · The cold-open burst

### 3.1 Entry path — the `/` → 307 → trip redirect

The redirect is **server-component logic, not middleware**:
- `src/middleware.ts:42-49` classifies `/` as **public**, so middleware does not redirect it.
- `src/app/page.tsx:33-37` (async Server Component) calls `getUser()`, then reads the
  `bt-last-trip-id` cookie (`:44`) and calls `redirect(\`/trips/${lastTripId}\`)` (`:47`).
- Next's `redirect()` from a Server Component emits **307** (method-preserving, non-cacheable —
  correct here since the target is cookie-dependent and must not be cached as permanent).
- That cookie is written client-side on every trip visit at `src/app/trips/[tripId]/page.tsx:162-170`.

### 3.2 Ordered request map (~25 requests)

| # | Request | Origin |
|---|---|---|
| 1 | `GET /` → **307** | `src/app/page.tsx:47` |
| 2 | `GET /manifest.webmanifest` | browser, from `src/app/manifest.ts` |
| 3–4 | `GET /terms`, `GET /privacy` | `next/link` prefetch, `src/components/SiteFooter.tsx:37-38` (mounted app-wide, `src/app/layout.tsx:55-61`) |
| 5 | **tRPC batch 1** — `trips.resolveSlug` (1 proc) | `src/app/trips/[tripId]/page.tsx:658` |
| 6 | **tRPC batch 2 (9 procs)** — `trips.getById`, `ideas.list`, `tripMembers.list`, `datePoll.get`, `quickInfoTiles.list`, `competitions.getByTrip`, `schedule.list`, `logistics.list`, `expenses.list` | `page.tsx:81-123` |
| 7 | **tRPC batch 3 (9 procs)** — `teams.list`, `teamAssignments.list`, `trips.list`, `users.getMe`, `notifications.status`, `messages.list` ×2, `messages.readState`, `news.unreadCount` | `page.tsx:126-133` + first mount of `TopNav` subtree |
| 8 | `GET /trips/…/leaderboard` (RSC prefetch) | `src/components/BottomNav.tsx:139-144` `router.prefetch` in a `useEffect` |
| 9 | `GET /login` | see §3.5 |
| 10 | `GET /trips/bbmi-2026-b88a` ×2 | see §3.5 |
| 11 | **tRPC batch 4 (small)** — `notifications.getPreferences` (+ `messages.markRead`) | `ChatNotifyToggle.tsx:20`, `FloatingChatPanel.tsx:331` — **requires a user tap on Chat** |

### 3.3 Why FOUR batches instead of one — the structural answer

Batching is per-tick; a call issued in a later React commit starts a new HTTP batch. Two confirmed
splitters, both structural:

**(a) The whole-subtree loading gate — the dominant cause.** `TripDetailBody` computes
`dataLoading` from 8 queries (`page.tsx:135-137`) and **returns a bare spinner instead of the real
tree** (`page.tsx:215-224`):

```jsx
const dataLoading = isLoading || ideasLoading || membersLoading
  || competitionLoading || datePollLoading || tilesLoading
  || scheduleLoading || logisticsLoading;
…
if (dataLoading) {
  return (<div className="flex min-h-screen items-center justify-center">…spinner…</div>);
}
```

`TopNav`, `HomeTab`, `TripBottomNav`, `FloatingChatPanel`, `NewsPanel` — and therefore **every query
they own** — do not exist in the React tree at all until batch 2 resolves. This is a *whole-subtree*
dependent query: batch 3 cannot physically be part of batch 2. **This single gate is what turns one
round-trip into two**, and it is the structural root of the cold-open shape.

**(b) A true `enabled` waterfall.** `teams.list` / `teamAssignments.list` (`page.tsx:126-133`) are gated
`enabled: !!competition?.id`; `competition` comes from `competitions.getByTrip` **inside batch 2**, so
they can only fire in a later commit. Classic parent→child dependent query.

**(c)** The leaderboard prefetch (`BottomNav.tsx:139-144`) is a `useEffect` RSC fetch — a different
transport entirely, never batchable with tRPC. **(d)** Batch 4 is user-gated (chat tap).

**Ruled out:** no Suspense boundaries gate these (loading states are plain conditional returns), and no
timer-based staggering exists in this path.

### 3.4 Are the two 9-procedure batches duplicates?

**No — genuinely different procedure sets** (see §3.2 rows 6 and 7; zero procedure-name overlap).
Where batch-3 descendants call a batch-2 procedure (e.g. `HomeTab.tsx:36` `ideas.list`,
`ItineraryView.tsx:101-103`, `useSetupProgress.ts:29-31`), **TanStack dedupes by query key → zero extra
network calls**; `useSetupProgress.ts:14-15` says so explicitly.

### 3.5 The `/login` render + doubled `/trips/bbmi-2026-b88a`

**Mechanism confirmed; initiator unconfirmed.** Both code paths for a *chain* exist and compose exactly
into the observed timing (`/login` :46 → `/trips` :47 → `/trips` :48):

1. `src/middleware.ts:57-62` — an **authenticated** request to `/login` is redirected to `/`:
   ```js
   if (user && request.nextUrl.pathname === "/login") {
     const url = request.nextUrl.clone();
     url.pathname = "/";
     return NextResponse.redirect(url);
   }
   ```
2. `src/app/page.tsx:47` — `/` for an authed user with the cookie redirects to `/trips/{lastTripId}`.

So **one `/login` hit by an authed user mechanically produces `/login` → `/` → `/trips/…`** — which
matches the observed sequence, with the second `/trips` hit being the in-flight RSC prefetch from
`BottomNav.tsx:141` (or the chain's own navigation) landing a beat later.

**What is *not* confirmed is what requested `/login` in the first place.** Ruled out from code: no client
code on a trip page routes to `/login` — every `/login` reference is in the invite flow
(`src/app/invite/page.tsx:176,211`) or marketing chrome (`MarketingNav.tsx:31`,
`MarketingFooter.tsx:29`), and `src/lib/auth-context.tsx:34-54` never redirects there. The service
worker is a confirmed **no-op pass-through** with no `respondWith` (`public/sw.js:28-32`), so it cannot
replay or rewrite navigations.

Remaining candidates, each with what would settle it:

| Candidate | Settled by |
|---|---|
| A `<Link href="/login">` prefetch from marketing chrome rendered momentarily before the authed redirect | `Referer` + `Next-Router-Prefetch` header on the `/login` request |
| A request arriving without auth cookies (e.g. a credential-less prefetch) → middleware 307s it to `/login` (`middleware.ts:51-55`) | Whether the `/login` hit was a **307 target** (status of the preceding request) or an origin |
| A concurrent refresh-token race across the ~20 simultaneous `getUser()` calls | Supabase Auth logs: two `grant_type=refresh_token` in the same second, one `invalid_grant` |
| Stale browser history / a second tab | `Sec-Fetch-Site` / `Referer` on both `/trips` hits |

One log field — the `/login` request's status and `Referer` — distinguishes these. Escalated to §9.

### 3.6 Deferrable without the user noticing

| Request | Owner | Note |
|---|---|---|
| `messages.list` ×2 + `readState` | `FloatingChatPanel.tsx:1108,1118,1134` | **Biggest win** — two 50-row page fetches for a badge |
| `notifications.status` | `InstallBanner.tsx:47` | banner is usually hidden |
| `users.getMe` | `UserMenu.tsx:45` | menu is closed by default; hover-prefetch pattern already exists at `TopNav.tsx:365` |
| `news.unreadCount` | `NewsPanel.tsx:61` | badge only |
| `trips.list` | `TopNav.tsx:96` | switcher dropdown label |
| `teams.list`, `teamAssignments.list`, `expenses.list` | `page.tsx:123-133` | self-documented prefetches for unopened tabs |
| `/trips/…/leaderboard` prefetch | `BottomNav.tsx:139-144` | unconditional on mount; could be hover/viewport-gated |

**Deliberately not deferrable:** `datePoll.get`, `quickInfoTiles.list`, `schedule.list`, `logistics.list`
are in the `dataLoading` gate on purpose (`page.tsx:91-119` comments) to prevent cross-trip data flashing.

---

## 4 · Warm tab-switch cost

### 4.1 Tab-state mechanism — `NAV_AUDIT.md` §1b verdict: **PARTLY TRUE**

Quoted claim (`NAV_AUDIT.md:35-46`): *"The active tab lives in React `useState`, not the URL
(`page.tsx:46`). `?tab=` is read once on mount (:47) and never written back — all 7 `setActiveTab` call
sites … are bare state setters."*

**Still true** for the 5 in-page tabs: `src/app/trips/[tripId]/page.tsx:36-59` uses
`useState<TabId>(() => searchParams.get("tab") …)` — read only inside the initializer, and no
`router.push`/`replace`/`pushState` ever writes `?tab=` back. Switching home/crew/lodging/schedule/expenses
is a **pure client state change: zero network, zero history entry**.

**Now stale on one point:** `comp` is **no longer a tab**. `TripTabBar.tsx:14-24` lists only the 5 tabs
("the competition is a face, not a tab"), and `page.tsx:206-210` `router.replace`s a stale `?tab=comp`
deep link to `/trips/[tripId]/leaderboard`; `goToTab` (`page.tsx:254-260`) intercepts `"comp"` with a
`router.push`. Call sites are now **6**, not 7.

### 4.2 Per-tab warm cost

All 5 tabs are **conditionally rendered** (`page.tsx:512,523,533,536,539`), so switching away **unmounts**
the tab and **all local state is lost** (scroll position, open sheets, in-progress form drafts) —
every switch, regardless of cache.

Network cost is near-zero, because nearly every tab's data is *already held* by the always-mounted
`TripDetailBody` (§1.2). Staleness is a property of the cache entry, not the observer, so a remount
only refetches if the entry is stale (`refetchOnMount: true` checks `isStale()`).

| Tab | Queries on mount | Remount **<60 s** | Remount **>60 s** |
|---|---|---|---|
| home | `ideas.list`, `tripMembers.list`, `schedule.list`, `logistics.list`, `datePoll.get` | **0 requests** | 5 procs → **1 HTTP batch** |
| crew | `tripMembers.list` | 0 | 1 proc → 1 request |
| lodging | `logistics.list`, `trips.getById` | 0 | 2 procs → 1 batch |
| schedule | `schedule.list`, `competitions.getByTrip`, **`games.listByTrip`** | 0 | ≤3 procs → 1 batch. `games.listByTrip` is the **only** tab query with no parent holder → subject to 5 min `gcTime` eviction |
| expenses | `tripMembers.list`, `expenses.list` | 0 | 2 procs → 1 batch |
| comp | — | n/a — route, not tab | — |

**Net:** warm tab switching is **already efficient** — 0 requests inside 60 s, one coalesced batch after.
The real cost is **lost component state**, not network.

### 4.3 Competition face & game panel

- **The Live face is a real route.** `src/app/trips/[tripId]/leaderboard/page.tsx` is an async Server
  Component that calls `helpers.competitions.faceBootstrap.fetch({ tripId })` server-side (`:33-41`),
  reached via `router.push` (`BottomNav.tsx:176-177`) — so a cold navigation costs middleware + RSC
  render + a server-side `faceBootstrap` resolve.
- **But repeat navigations inside 5 minutes cost nothing.** `next.config.ts:77-79` sets
  `experimental.staleTimes.dynamic: 300` — the Router Cache serves the RSC payload client-side, the
  Server Component does **not** re-run, and **middleware does not run** for that navigation. After 300 s
  the next navigation is a full server round-trip again.
- **The game panel is not a navigation at all.** `competition/GameRow.tsx:23-26` uses
  `window.history.pushState` (`?game=`); `CompetitionFace.tsx:113-127` derives the open panel from
  `useSearchParams()` and renders it over the still-mounted board (`:331-344`) — **no server round-trip**.
  The game view itself is conditionally rendered (`CompetitionFace.tsx:164-172`), so it remounts (and
  loses local state) on every close/reopen.

### 4.4 The `faceBootstrap` seeding path

`LiveFaceClient.tsx:144-166` seeds, in a `useMemo` during render (before children mount):

| Cache | Mode |
|---|---|
| `competitions.getByTrip` (`:146`), `games.myDelegateGameIds` (`:147`), `games.listByTrip` (`:159`), `teams.list` (`:160`), `teamAssignments.list` (`:161`) | **unconditional `setData`** |
| `competitions.leaderboard` (`:151-157`) | **only-if-absent** (`getData(…) === undefined`) |

`setData` stamps `dataUpdatedAt = now`, so the unconditional seeds **deliberately suppress the refetch
`refetchOnMount: true` would otherwise trigger** — children mount against fresh data with **zero
network**. That is the intended design, and it is correct.

The `leaderboard` guard is the important nuance and is **right**: `faceBootstrap` is `STRUCTURE_QUERY`
(`staleTime: Infinity`), so `boot.leaderboard` can be *staler* than the board's 30 s poll; an
unconditional overwrite would clobber fresher standings on every remount. Cold paint only.

---

## 5 · Realtime inventory

### 5.1 Subscriptions (5 hooks)

| # | Hook | Channel | Tables + filter | Events | Mounted | Torn down |
|---|---|---|---|---|---|---|
| 1 | `hooks/useRealtimeCompetition.ts:44` | `competition:${tripId}` | `competitions`, `trip_id=eq.${tripId}` (`:51`) | `*` | `LiveFaceClient.tsx:61` **and** `trips/[tripId]/page.tsx:143` | `:67-69` |
| 2 | `hooks/useRealtimeMembers.ts:36` | `members:${tripId}` | `trip_members`, `trip_id=eq.` (`:44`) | `*` | `LiveFaceClient.tsx:62`, `page.tsx:148` | `:55-57` |
| 3 | `hooks/useRealtimeTripData.ts:49` | `tripdata:${table}:${tripId}` ×3 | `quick_info_tiles`, `logistics_items`, `schedule_items` (`:53`) | `*` | `page.tsx:153` **only** (not the Live face) | `:64-66` |
| 4 | `hooks/useRealtimeChat.ts:128` | `trip-chat:${tripId}` | `messages`, `trip_id=eq.` (`:70-77`) | **INSERT** | `FloatingChatPanel.tsx:1100` via `useChatUnreadCount` → `TopNav.tsx:383` — **always mounted** | `:148-150` |
| 5 | `hooks/useRealtimeGame.ts:61` | `game:${gameId}` | `games`, `game_matches`, `game_participants`, `play_groups`, `game_delegates` (`:37-43`) | `*` | **`MatchGameView.tsx:323` ONLY** | `:76-78` |

All channel names are keyed by `tripId`/`gameId` — **no static-name collision hazard**. All effects key
on stable primitives + stable provider refs — **no resubscribe churn**.

### 5.2 Architecture

**No shared subscription manager.** Each hook independently calls `supabase.channel(...)`. What *is*
shared is the **client**: `src/lib/supabase.ts:22-29` exposes a module-singleton `getRealtimeClient()`
built explicitly (`:13-17`) so hooks don't each mint a WebSocket. Net: **one WebSocket, N independently
created channels multiplexed over it**.

**Channels open for one user on the Live face with a match panel open: 4** — `competition:{trip}`,
`members:{trip}`, `trip-chat:{trip}`, `game:{game}`. With a rack/stroke/non-golf panel: **3** (no game
channel exists for those formats). On the trip page: **5** (competition, members, 3× tripdata) **+ chat**.

### 5.3 Lifecycle

Every hook unsubscribes on unmount (cited above; tests cover it —
`useRealtimeMembers.test.ts:95`, `useRealtimeTripData.test.ts:106`, `useRealtimeChat.test.ts:88`).

**No hook touches `visibilitychange` / `document.hidden`.** The only `visibilitychange` listener in `src`
is `hooks/useDraftOutbox.ts:82-88`, unrelated to Realtime. **Stated plainly: a hidden or backgrounded
tab keeps its WebSocket and all channels open.** This is confirmed by absence, not inferred.

*(Cost note: an idle socket costs Supabase connection quota, not Vercel Active CPU.)*

### 5.4 Cache interaction

| Hook | Mechanism |
|---|---|
| `useRealtimeCompetition` | `invalidate()` — **both** `competitions.getByTrip` **and** `competitions.faceBootstrap` (`:40-41`); reconnect tick invalidates `getByTrip` only (`:64`) |
| `useRealtimeMembers` | `invalidate()` → `tripMembers.list` (`:34`) |
| `useRealtimeTripData` | `invalidate()` → `quickInfoTiles.list` / `logistics.list` / `schedule.list` (`:43-45`) |
| `useRealtimeChat` | **direct `setData`** — `setQueriesData` prepends the row with id-dedup (`:88-126`); `invalidate()` only on the reconnect tick (`:142-145`) |
| `useRealtimeGame` | `invalidate()` → `games.getById`, `matches.listByGame`, `games.configHash`, `games.listOrganizers` (`:52-57`). **Does not** invalidate `faceBootstrap` or `leaderboard` |

Only `useRealtimeCompetition` invalidates `faceBootstrap` — consistent with CLAUDE.md pattern #10.

### 5.5 What's polled that could be a subscription — **and the hard constraint**

Tables **in** the `supabase_realtime` publication: `competitions`, `messages`, `trip_members`,
`quick_info_tiles`, `logistics_items`, `schedule_items`, `games`, `game_matches`, `game_participants`,
`play_groups`, `game_delegates` (migrations `001:1131-1141`, `017:24,34`, `077:27-29`, `084:34-48`).

> ### 🔴 Score tables are DELIBERATELY excluded from Realtime
>
> `score_entries`, `match_hole_outcomes`, and `game_results` are **not** published. Migration
> `20260716130000_084_games_realtime.sql:21` says so explicitly: *"Score tables (score_entries /
> match_hole_outcomes) are DELIBERATELY excluded: scores have their own poll + outbox path (#15/#16)
> and are high-frequency; this is config only."*
>
> **So the spec's "nothing should poll" through-line collides with a deliberate DB-level design
> decision.** Live scores cannot become a subscription without a new migration publishing those
> tables — it is not an oversight to extend. This is the single most important product decision in
> the audit → **§9-Q1**.

| Poll | Realtime already covers it? |
|---|---|
| `scores.listByGame` (×3 views) | **No** — `score_entries` unpublished |
| `matchOutcomes.listByGame` | **No** — `match_hole_outcomes` unpublished |
| `competitions.leaderboard` (30 s) | **No** subscription exists; `CompetitionLeaderboard.tsx:112-114` says so ("A future realtime invalidation can drop in by cancelling this interval"). Also **not replaceable 1:1** — it aggregates the unpublished score tables |
| `games.configHash` (20 s) — **Match** | **YES, redundantly** — `useRealtimeGame` watches exactly those 5 tables; the poll is a documented reconnect backstop (`useRealtimeGame.ts:69-71`) |
| `games.configHash` (20 s) — **Rack / Stroke / Non-golf** | **YES, and unused** — the tables are published but `useRealtimeGame` is only wired into `MatchGameView.tsx:323`. **Free win, zero migration** → §8-F5 |

### 5.6 Realtime limits at 30 concurrent users

From code: ~**3–5 channels per user over 1 WebSocket** → 30 users ≈ **30 concurrent connections,
~90–150 channel subscriptions**, plus message fan-out on every chat INSERT and competition/member/trip-list
change.

**The plan's actual quota is unconfirmed** — not derivable from source, and I did not access the
dashboard. → **§9-Q5**.

---

## 6 · Auth & session interaction

### 6.1 Cookie plumbing — `getAll` yes, `setAll` yes but **conditionally swallowed**

`src/lib/supabase-server.ts:4-28` implements both, but `setAll` is wrapped in a silent try/catch:

```ts
setAll(cookiesToSet) {
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options)
    );
  } catch {
    // The `setAll` method was called from a Server Component.
    // This can be ignored if you have middleware refreshing sessions.
  }
}
```

Which behaviour applies depends entirely on the caller:
- via `src/app/api/trpc/[trpc]/route.ts` (**Route Handler** — `cookies()` is mutable) → the write *can* land;
- via `src/server/trpc-ssr.ts:21` (`createSSRHelpers`, called from Server Components —
  `trips/[tripId]/layout.tsx`, `leaderboard/page.tsx`) → `cookieStore.set()` throws and the write is
  **provably a no-op**.

### 6.2 Does the tRPC route handler attach refreshed cookies? — **unconfirmed**

`src/app/api/trpc/[trpc]/route.ts:1-13` is the whole file: `fetchRequestHandler` with `endpoint`, `req`,
`router`, `createContext` — **no `responseMeta`, no cookie bridge** (grep for
`responseMeta|onError|errorFormatter` across `src/server` and `src/app/api` returns nothing). Any cookie
set during context creation reaches the response only through **Next's own Route Handler `cookies()`
plumbing** — architecturally plausible, but **nothing in this repo demonstrates or tests it**. Marked
**unconfirmed**, per the spec's instruction not to assert that refresh works because it looks like it should.

### 6.3 Where refresh actually happens

| Path | Status |
|---|---|
| **Middleware** (`src/middleware.ts:34-36`) — `getUser()` re-verifies/refreshes; its `setAll` (`:15-23`) is **not** swallowed and writes to `supabaseResponse`, which is returned (`:64`) | ✅ **Confirmed working — the load-bearing path** |
| **tRPC context** (`src/server/trpc.ts:51-76`) — prefers `getClaims()` (local verify, **no refresh**, `:57-64`), falls back to `getUser()` (`:68-73`) | ⚠️ Refresh may occur, but persistence depends on §6.2 (**unconfirmed**), and is a **proven no-op** via `trpc-ssr.ts` |
| **Browser client** (`src/lib/supabase.ts:3-8`) — `createBrowserClient` with no options → `autoRefreshToken` defaults `true`; `@supabase/ssr` writes cookies | ✅ Independent, **foreground-only** (timers throttle when hidden) |

### 6.4 The leaderboard-poller scenario — the crux

**Middleware matches `/api/trpc`.** `src/middleware.ts:67-74`:

```js
matcher: [
  "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
]
```

The negative lookahead excludes only static assets — **`/api/trpc/*` is matched**, so middleware
(including `getUser()`) runs on **every tRPC POST**, polls included. Good news: refresh is therefore
**not** navigation-dependent, and a polling-only user *does* keep their session refreshed while the
refresh token is valid.

**But when the refresh token finally dies:** `/api/trpc` is not in `isPublicRoute` (`:42-49`), so
`middleware.ts:51-55` fires:

```js
if (!user && !isPublicRoute) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);      // 307
}
```

The request **never reaches tRPC**, so `authedProcedure`'s clean `UNAUTHORIZED` → **401**
(`src/server/trpc.ts:98-103`) is *never produced*. tRPC's `httpBatchLink` uses `fetch` with the default
`redirect: "follow"`, and **307 preserves the method** — so the browser re-issues a **POST to `/login`**,
which renders a full HTML page. The client gets HTML where it expects a JSON batch.

**Per failed tick, with `retry: 1` (§2.2): 2 × (middleware + 307 + full `/login` render).** A 30 s
leaderboard poll ⇒ **240 wasted renders/hour per stuck tab**; six tabs ⇒ ~1,440/hr — matching the
observed **~1,150 `/login` renders in 30 minutes**. This is the sustained burn, and it is **structural**,
not a background-polling problem (§2.1).

*(The exact client-visible failure mode — JSON-parse error vs. other — is runtime-dependent and marked
**plausible**, not confirmed. The pending out-of-scope branch addresses this seam; noted and not touched.)*

### 6.5 Security check — clean

`src/lib/supabase.ts:5-6` uses only `NEXT_PUBLIC_*`. `SUPABASE_SERVICE_ROLE_KEY` is read **only** in
`src/lib/supabase-admin.ts:18-26`, and every importer (`server/lib/sendPush.ts`, `server/lib/vapid.ts`,
`server/routers/{messages,notifications,scores,users}.ts`) is under `src/server/` — **no `"use client"`
importer**. No new issue. Pre-existing infra risk #634 noted in §0-FLAG 4.

---

## 7 · Doc drift found

| # | Doc claim | Code | Verdict |
|---|---|---|---|
| **1** | `CLAUDE.md:88-90` (Testing Rules): *"The server-router suites run against ONE shared REMOTE Supabase project"* + all the shared-remote flakiness conventions | `.github/workflows/ci.yml:38-52,71-83` runs **`supabase start`** and points env at the **local** stack (comment `:32-37`: *"an EPHEMERAL LOCAL Supabase … NOT the shared prod project"*); `.env.example:16-17` defaults to `http://127.0.0.1:54321`; `TRACKER.md:136-138` records #636 shipping this | **STALE-FALSE.** `TRACKER.md` is current. **CLAUDE.md contradicts itself** — its own Migration Workflow section (`:399-402`) already says CI runs `supabase start` |
| **2** | `vitest.config.mts:15-16,22-23` comments: *"Server-router tests run against the shared REMOTE Supabase project"* | Same file `:33-34` says *"Post-Step-0 the whole suite hits ONE local Supabase"* | **STALE-FALSE** — the file contradicts itself across its own comments |
| **3** | `ENVIRONMENT_AUDIT.md:14-33` §0: *"Prod, CI, and local dev all share the single Supabase project"* as current state | Superseded by #636 (row 1) | **STALE-FALSE** — same drift, second document |
| **4** | `CLAUDE.md:74-83`: *"the ONE Playwright smoke test"* + *"The 12 older `e2e/*.spec.ts`"* | `playwright.config.ts:32-36` runs **two** specs (`critical-path` **and** `match-play`); `e2e/` holds **15** specs → **13** deferred. `AUDIT_REPORT.md:16` independently says 15 | **STALE — numbers wrong** (2 running, 13 deferred) |
| **5** | `NAV_AUDIT.md:35-46` §1b: tab state, *"7 `setActiveTab` call sites"*, comp as a tab | `page.tsx:36-59` mechanism intact for 5 tabs; **`comp` is now a route** (`TripTabBar.tsx:14-24`, `page.tsx:206-210,254-260`); **6** call sites | **PARTLY TRUE** (see §4.1) |
| **6** | `src/lib/queryConfig.ts:29-31`: *"Do NOT spread it onto a STATE query (scores.listByGame, **competitions.leaderboard**)"* | `competition/GamePageHeader.tsx:45` spreads `...STRUCTURE_QUERY` onto **`competitions.leaderboard`** | **CODE VIOLATES ITS OWN DOC** — see §8-F4 |
| **7** | Pending branch commit msg: *"the only interval poll lacking `refetchIntervalInBackground: false`"* | Library default is already falsy (§2.1) | **INERT** — true statement, no runtime effect |
| **8** | `AUDIT_REPORT.md:46,65` — votes have no realtime/poll, ~60 s staleTime; `ideas.list` has no `refetchInterval` | Confirmed | **TRUE** |
| **9** | `CLAUDE.md` #16 — `configHash` reads `game_matches` (not the historical `matches` bug), excludes score fields | `server/routers/games.ts:88`, `:22-29,40-46`, `lib/configHash.ts:46-54` | **TRUE** |
| **10** | `CLAUDE.md` #8/#16 — leaderboard 30 s poll, scores ~20 s `GAME_SYNC_INTERVAL_MS` | `CompetitionLeaderboard.tsx:115`, `useConfigSync.ts:13` | **TRUE** |
| **11** | `AUDIT_REPORT.md:10` — "migrations ≈090" | 94 active, highest `092` | **STALE (minor)** |

Nothing in `NAV_AUDIT.md` outside §1b makes a data-fetching claim; the rest of the file is navigation/IA only.

---

## 8 · Findings ranked by impact

*Structural roots first. **No fixes were applied.** Sizes are rough: S ≤ ½ day, M ≈ 1–2 days, L > 2 days.*

### 🔴 F1 — The `/api/trpc` → 307 → `/login` render loop *(structural root; the actual burn)*
**What.** Middleware matches `/api/trpc` (`middleware.ts:67-74`); on a dead session it 307s the POST to
`/login` (`:51-55`) instead of letting tRPC return its clean 401 (`server/trpc.ts:98-103`). `fetch` follows
the 307 method-preserving, so a **full `/login` page renders** for a response no tRPC client can parse —
forever, at poll cadence, doubled by `retry: 1`.
**Evidence.** §6.4. Matches the measured ~1,150 `/login` renders in 30 min and the 93 % 307 rate.
**Impact.** By far the largest single source of wasted server compute. ~240 wasted renders/hr per stuck tab.
**Fix size.** S — *already addressed on the out-of-scope branch; not touched here.*

### 🔴 F2 — The cold-open `dataLoading` gate serializes the whole app *(structural root)*
**What.** `page.tsx:135-137` + `:215-224` return a spinner until **8** queries resolve, so the entire
`TopNav`/`HomeTab`/`BottomNav`/chat/news subtree — and every query it owns — cannot mount until batch 2
lands. This is what makes the cold open **two** round-trips deep instead of one, and it delays first
paint to the slowest of 8 queries.
**Evidence.** §3.3(a).
**Impact.** Doubles cold-open latency and splits ~18 procedures across 2 batches. Affects every trip open.
**Fix size.** M — needs a considered decision about which data truly must gate paint (the anti-flash
rationale at `page.tsx:91-119` is real and must be preserved).

### 🔴 F3 — Chat badge fetches two full message pages on every trip load *(structural root)*
**What.** `useChatUnreadCount` is mounted in the always-on `TopNav` (`FloatingChatPanel.tsx:1100` ←
`TopNav.tsx:383`) and fires **two 50-row infinite-query pages** (`:1108`, `:1118`) plus `readState`
(`:1134`) **with the chat panel closed** — to render a number. It also opens the chat WebSocket channel.
**Evidence.** §1.1, §1.4. (The shared-cache-key design at `:1102-1107` is genuinely good — it prevents a
*second* fetch when the panel opens. The cost is that the *first* one is unconditional.)
**Impact.** ~100 message rows serialized on every cold open, for a badge. Grows with chat volume.
**Fix size.** S–M — a dedicated count procedure mirrors what News already does (`news.unreadCount`).

### 🟠 F4 — `competitions.leaderboard` is cached three incompatible ways, one of which freezes scores
**What.** Same query key, three policies: correct 30 s poll (`CompetitionLeaderboard.tsx:108-117`);
**`STRUCTURE_QUERY` / `staleTime: Infinity`** (`GamePageHeader.tsx:43-46`); and inherited-with-no-poll
(`NonGolfGameView.tsx:88`). `queryConfig.ts:29-31` **explicitly forbids** the second.
**Evidence.** §1.5, §7-6. On the **standalone** game routes (`games/match/new`, `games/new`,
`games/rack/new`, `games/manual`) no `CompetitionLeaderboard` is mounted, so the `Infinity` observer is
the **only** one — standings freeze until remount. In the panel path the board's poll masks it.
**Impact.** Correctness (stale standings shown as live), not volume.
**Fix size.** S.

### 🟠 F5 — Rack / Stroke / Non-golf poll for config that Realtime already covers *(free win)*
**What.** `useRealtimeGame` watches exactly the 5 config tables the 20 s `configHash` poll exists to
detect — but it is wired into **`MatchGameView.tsx:323` only**. The other three formats poll blind.
**Evidence.** §5.5. Tables are **already published** (migration `084:34-48`) — **no migration needed**.
**Impact.** Demotes 3 of the 20 s polls to reconnect backstops and makes config changes push-instant.
**Fix size.** S.

### 🟠 F6 — `games.listOrganizers`: three conflicting policies on one key
**What.** `STRUCTURE_QUERY` (`MatchGameView.tsx:635`, `RackGameView.tsx:166`, `StrokeGameView.tsx:265`),
inherited (`NonGolfGameView.tsx:143`), and **`staleTime: 0` + `refetchOnWindowFocus: true`**
(`useGameEditAccess.ts:40-43`) — co-mounted in every game view. The `staleTime: 0` observer is deliberate
(access must not go stale) and effectively wins, making the `STRUCTURE_QUERY` spreads misleading.
**Impact.** Low runtime; high confusion — an access-control surface whose caching reads as accidental.
**Fix size.** S.

### 🟡 F7 — `games.configHash` polled from two hooks
`useConfigSync.ts:56-63` and `useConfigDraft.ts:76-79` both register the same key from all 4 views.
TanStack dedupes → **no extra network**, but two call sites own one poll. **Fix size.** S (cosmetic).

### 🟡 F8 — Reference-class cache policy drift
`tripMembers.list` has **5+** policies, `courses.getById` **3**, `users.getMe` **3**,
`teamAssignments.list` **2** (§1.5). No functional harm today (data rarely changes mid-session), but
there is no rule — the STRUCTURE/STATE split exists precisely to prevent this.
**Fix size.** M (mechanical but broad).

### 🟡 F9 — Non-golf has no freshness mechanism at all
`NonGolfGameView` has **no** score poll and **no** leaderboard poll (`:88`). A teammate posting a result
on another device never appears until remount. Every other format polls at 20 s. **Fix size.** S.

### 🟢 F10 — Realtime sockets never close on tab-hide
No `visibilitychange` handling in any realtime hook (§5.3); a hidden tab holds 3–5 channels open. **Costs
Supabase connection quota, not Vercel CPU** — hence low rank, but relevant at 30 concurrent users (§9-Q5).
**Fix size.** S.

### 🟢 F11 — Deferrable cold-open requests
`notifications.status`, `users.getMe`, `trips.list`, `news.unreadCount` and the unconditional leaderboard
`router.prefetch` (`BottomNav.tsx:139-144`) all load before they're needed; a hover-prefetch pattern
already exists at `TopNav.tsx:365`. **Fix size.** S each.

### ⚪ F12 — Doc drift (§7)
`CLAUDE.md`'s Testing Rules section actively misleads (it contradicts its own Migration Workflow
section), and `vitest.config.mts` contradicts itself. **Fix size.** S — *deliberately not fixed, per spec.*

---

## 9 · Open questions for Zach

**Q1 — Live scores: publish the score tables to Realtime, or keep polling? *(the big one)***
The audit's "nothing should poll" principle collides with a deliberate design decision: migration
`084:21` **excludes** `score_entries` / `match_hole_outcomes` from Realtime because they're
"high-frequency" and already have the poll + outbox path. So live scoring **cannot** become a
subscription without a new migration. The trade: a 20 s poll means a birdie shows up to 20 s late on
every other device — during BBMI, with 30 people watching a board, is that latency acceptable, or is
sub-second the point of the competition face? This is a feel-of-the-round question, not a cost one.
*(Related: `competitions.leaderboard` aggregates those same tables, so the 30 s board poll can't be
replaced 1:1 either — it would need invalidation-on-score-event.)*

**Q2 — What must gate first paint?** F2's fix is a product judgement. The 8-query gate exists to stop
cross-trip data flashing on trip switch (`page.tsx:91-119`) — a real UX concern you chose deliberately.
Is a fast paint with progressive fill-in preferable to a slower, flash-free paint? I can't answer that
from code.

**Q3 — Should the chat badge cost two message pages?** F3's cleanest fix is a server-side count
procedure (as News already has). But the current design means opening chat is **instant** (pages are
already cached). Is that warm-open worth ~100 rows on every trip load, or should chat pay its own
open cost?

**Q4 — One log field would close the cold-open anomaly.** §3.5's redirect *chain* is code-confirmed, but
the **initiator** of the `/login` hit isn't. The `/login` request's **status** (was it a 307 *target* or an
origin?) plus its `Referer` / `Next-Router-Prefetch` header settles it. Per spec I did not touch prod —
this needs one look at a log line you already have.

**Q5 — Supabase plan Realtime quota.** Code gives ~30 connections / ~90–150 channel subscriptions at 30
users (§5.6), plus chat fan-out. The plan's actual concurrent-connection and message limits are not in
source. Worth confirming against the dashboard **before** BBMI, especially if Q1 adds score-table
publication (which would multiply message volume substantially).

**Q6 — Where should this audit live, and the branch situation.** No worktree is on `main` (§0-FLAG 1);
this file was written to the **primary checkout root** (`C:\Users\zgret\Repos\Claude\buddytrip`,
currently on `fix/push-enable-affordance`) as an **untracked** file — untracked files are branch-agnostic,
so it survives branch switches and touches no branch's history. Note that checkout already had two
unrelated uncommitted deletions (`W-GAMEPAGE-01_*.md`) **before** this audit — so `git status` there shows
those plus this one new untracked file, not a clean one-file diff. Nothing else was modified anywhere.

---

### Appendix · What this audit did not do
No file other than this one was created or modified. Nothing was committed. No branch was created,
merged, or rebased. `claude/vercel-cpu-burn-diagnosis-8e1f51` was not touched. No tests were run. No
request was made to `bbmi.app` or any production surface. `main` was read via a read-only
`git archive` export.

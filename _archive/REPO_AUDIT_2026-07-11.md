# BuddyTrip — Repo Audit / Ground-Truth Map (2026-07-11)

Survey of actual `src/` + `supabase/migrations/` on `main` (HEAD `1351d60c`, #568 merged).
Verified against code, not docs. Produced for a new planning session per `CC_SPEC_repo_audit.md`.
**Read this over the tracking docs — several of those are stale (see §6).**

---

## 1. Competition / game architecture

**Format catalog lives in CODE, not the DB.** `src/lib/gameTypes.ts` (`GAME_TYPE_DEFINITIONS`, ~L147-289)
is the home of record; the `game_type_templates` table is dead/archival (readers migrated — issue #440
tracks archiving it). It's **4 engine formats + 4 manual variants**:

| id | name | `resultStrategy` |
|----|------|------------------|
| `gtt_stroke_play` | Stroke Play | `stroke_total` |
| `gtt_match_play_singles` | Singles Match Play | `match_play` |
| `gtt_match_play_doubles` | 2v2 Match Play | `match_play` |
| `gtt_rack_n_stack` | Rack-n-Stack | `rack_n_stack` |
| `gtt_generic_card` / `_yard` / `_bar` / `gtt_manual` | (manual) | `null` |

The 4 manual types collapse to ONE route (`MANUAL_ROUTE`, `gameRoutes.ts`) + ONE view (`NonGolfGameView`);
`isManualGameType()` (known id + null strategy) is the predicate.

**Scoring model.** `competitions.scoring_model` ∈ {`match_play`, `points`}; written `competitions.ts:221`,
branched server-side in `src/server/lib/competitionLeaderboard.ts:46-165` (defaults `match_play`) and
client-side in `CompetitionFace.tsx:268` (match_play → Ryder hero; points → standings + matrix). Each format
declares `compatibleScoringModels`; the add-game menu filters via `gameTypesForScoringModel()`.

**Format→strategy resolution is data-driven** (CLAUDE.md pattern #8): `games.finish`
(`src/server/routers/games.ts:558-628`) looks up `game_type_id → def.resultStrategy` then branches
`match_play`/`rack_n_stack`/`stroke_total`/`null`. Unknown id → hard error (no silent stroke fallback).

**Panel/navigation model — confirmed.** NO Next.js parallel routes (no `@slot` dirs anywhere). The
leaderboard is the persistent surface; games open as **`?game=` client-overlay panels** set via
`window.history.pushState` (`GameRow.tsx:22-24`, synced to `useSearchParams` with no server round-trip).
Host = `CompetitionFace.tsx` (reads `search.get("game")`, gates on `opensAsPanel`, mounts a `fixed` layer over
the warm board). Views: `MatchGameView` / `RackGameView` / `StrokeGameView` / `NonGolfGameView`.
`opensAsPanel` (`gameRoutes.ts:85-92`) covers **all four engine formats + manual**.

**GameChrome / TopNav context-aware app bar (#550) — landed (Phases 1+2, PRs #565/#566).** Provider
`GameChrome.tsx`, mounted in `LiveFaceClient.tsx:214`. All 4 views publish chrome via `usePublishGameChrome`
gated on `useInGamePanel()`; off-panel deep-links keep their own header (provider-aware suppression). Fields:
`title`, `onSettings?`, `onScorecard?`, `hideBottomNav?`. `TopNav.tsx:116-282` consumes it (back+title left;
scorecard/gear right). `hideBottomNav` published only on focused entry surfaces (stroke entry / match score /
rack entry group).

> **Flags for triage:**
> - **Stale comments:** `GameRow.tsx:168-169,349` still say "stroke navigates via href / keeps the route Link."
>   FALSE since PR 547 — stroke opens as a panel like the others. Comment-only; behavior is correct.
> - **Dead code:** `GameChromeData.onScorecard` + its TopNav button (`TopNav.tsx:261-271`) exist but **no view
>   ever publishes `onScorecard`** (match moved the affordance onto the card header; others omit it). The
>   app-bar scorecard button is currently unreachable.

## 2. Scoring / durability / permissions / cross-device sync (event-critical)

**All three subsystems have LANDED and are wired end-to-end.**

**`useScoreSaver` + durable outbox (#543).** `src/hooks/useScoreSaver.ts` is the single write path:
optimistic value → `outboxPut` to localStorage *before* the mutation settles → cleared only on server
confirmation; failure keeps value + outbox entry and flags the cell `error` (never rolls back to blank).
`mutateAsync` per-cell (fixes the "rapid foursome left every cell spinning" bug), `retry: 4` + exp backoff,
recover-on-mount re-sends survivors. Outbox keyed `bt.scoreOutbox.v1:<gameId>` by
`scoreCellKey(participantId,unitLabel)` = same id the server upsert uses. Advance/finish gate:
`unconfirmedOnHole` / `unconfirmedCount` (only `saving`/`error` block). Shared by **stroke / rack / match**
entry surfaces. **Non-golf is the deliberate exception** — no per-hole entry; it posts placement RESULTS via
`games.post` (`NonGolfScoreboard.tsx:67`), not `score_entries`.

**Score-entry permissions (#557 / mig 072) — three tiers, every write path guarded.** Server SoR
`src/server/lib/scoreAccess.ts::canWriteScore`: Tier 1 owner/co-admin/this-game delegate (short-circuits via
`canEditGame`); Tier 2 member via pure `memberCanScoreUnit` (`src/lib/scoreUnit.ts`) resolving per-format unit
membership (2v2 play_group / 1v1 match side / rack shared play_group / stroke self). Guarded paths:
`scores.upsertEntry` + `scores.deleteEntry` (`canWriteScore`), `games.post`/`openCorrection`
(`requireGameRunAction`), `games.setManualResults`/`finish` (`requireGameEdit`), structural `matches.*`
(`requireGameEdit`/`canEditGame`). **RLS defense-in-depth**: mig 072 `can_score_unit()` (SECURITY DEFINER)
mirrors the pure fn; policy `score_entries_write` closes the prior "any member could POST direct to
/rest/v1/score_entries" hole.

**Game-state sync (config-hash poll, #563) — ✅ MERGED / LANDED. (This was the key unknown — it's in.)**
- Server `games.configHash` (`games.ts:216-258`, `requireTripMember`) hashes config cols + participants +
  play_groups + matches, ordered for stability; **score-derived fields excluded on purpose** (entering scores
  never churns the hash).
- Util `src/lib/configHash.ts`: canonical sorted-key JSON + FNV-1a 32-bit → 8-hex (client-safe).
- Client `src/hooks/useConfigSync.ts`: poll **20s** (`GAME_SYNC_INTERVAL_MS`), `refetchIntervalInBackground:
  false`; first hash = baseline, later change → silent full-config invalidate. Coalesced onto the same tick as
  the score poll (`scores.listByGame`) = one round-trip.
- Score reconcile: `useScoreSaver.reconcile` → pure `scoreReconcile.ts::reconcileScores` overlays server values
  EXCEPT unconfirmed local cells (`protectedKeys`) — active enterer always wins.
- Wired in stroke/rack/match; non-golf uses config-sync only (no per-hole scores).
- **Deliberate gaps (documented):** remote-delete of a score isn't mirrored locally (self-heals on next
  edit/reopen); a config change in the <20s warm-reopen window isn't caught until the next change.

## 3. Scorecard + overlays (#564)

Scorecard is a **Sheet overlay**, not a route swap. `Sheet` primitive (`src/components/Sheet.tsx`, scrim +
panel + dismiss, `bodyClassName` prop). `ScorecardSheet` (`src/components/games/ScorecardSheet.tsx`) wraps it
with `bodyClassName="p-0"` (full-bleed so `StandardGrid` owns its scroll + sticky first column). Base-view +
`gridOpen` split in `StrokeGameView.tsx` (`gridOpen` state L105; sheet layered OVER the still-mounted base
L614). **Score state preserved when opening the scorecard from entry — confirmed** (base stays mounted;
`values`/`saveStatus`/`onCellTap` come from the caller's `useScoreSaver` and feed both views).

**Leaderboard scorecard = course preview, no scores — confirmed by design.**
`ScorecardPreviewSheet.tsx` renders `StandardGrid` with `participants={[]} values={{}}` (empty par/yardage/
stroke-index preview, no match context), from `CompetitionFace.tsx:392`.

## 4. Styling / tokens / shared helpers

- **Tokens** `--color-bt-*` in `src/app/globals.css` (light `:root` + dark block + `@theme inline` map).
- **`teamTextColor`** (`src/lib/teamTextColor.ts:54`, #560): luminance/WCAG-contrast pick between
  `--color-bt-on-accent` and white; used in `Avatar`, `MatchCard`, `rack/RackBoard`.
- **Scorecard icon** = lucide **`Table2`**, used consistently (TopNav, ScoreEntryView, MatchEntryView,
  MatchCard, GameRow, PointsMatrix, CourseRowContent). **Custom checkbox** = `src/components/games/Checkbox.tsx`
  (teal fill + lucide `Check`), shared by `ModifierCards` (game modifiers) and `StandardGrid` (multi-tee pass).
- **Hardcoded-hex debt is materially larger than STYLE_GUIDE §7 admits.** Beyond the sanctioned hero-gradient
  art (`CompetitionHero.tsx`), the team-identity palette + marketing island + Google logo are intentional
  exemptions. Real stray debt on product surfaces: `#00d4aa` city-pins (`LocationHero.tsx:123`,
  `TripCard.tsx:182` — in §7 backlog); `#fbbf24`/`#fb923c`/`#818cf8` (`HelperCards.tsx`, `InfoTileModal.tsx`,
  `TripHeaderDock.tsx` — NOT tracked); and the biggest offender, **bare `#0d1f1a`** (== `--color-bt-on-accent`)
  as an inline literal in ~15 files (Avatar, profile/page, TopNav, NewsPanel, HoleEditor, CoursePicker, …) and
  bare `#ffffff`/`#fff` on danger fills in ~8 more. STYLE_GUIDE §7 self-admits it "should be re-audited."
  CLAUDE.md's "never hardcode hex" rule is materially under-enforced. (Token-migration debt = issue tracked in
  DEFERRED.md §Token Migration + STYLE_GUIDE §7.)

## 5. Tests / CI health

- **Vitest: genuinely GREEN — 956/956 tests, 92/92 files pass** (`npx vitest run --exclude
  "**/.claude/worktrees/**"`, ~100s; slow files are the real-DB integration suites `matches`/`rackNStack`).
  Zero skips, zero flake markers anywhere in `src/**/*.test.*`.
- **Playwright: 2 specs gate merges** — `critical-path.spec.ts` (auth→stroke→scores→scorecard) **and**
  `match-play.spec.ts` (promoted into the gate). `playwright.config.ts` has only `setup` + `critical-path`
  projects (`testMatch: /(critical-path|match-play)/`). Auth = real-UI `signInWithPassword` as `test-owner`,
  saved storageState. **13** deferred mock-based specs match no project (never run). *(CLAUDE.md says "12
  older" + "one smoke test" — minor drift; match-play was pulled into the gate.)*
- **CI (`.github/workflows/ci.yml`): both jobs merge-blocking.** `test` job: `npm ci --ignore-scripts` →
  `supabase db push` (migrations to remote) → `tsc --noEmit` → full `vitest run`. `e2e` job (`needs: test`):
  build → `playwright test` (the 2-spec gate). Concurrency-cancel added #567. Supabase postinstall ECONNRESET
  + CLI-version flakes already mitigated in-config (pinned `2.78.1`). **Bare CI is genuinely green.**
- **Known flakes:** tripStatus (#548) FIXED & stable (clock frozen). The "#553 news clock-skew" concern
  **appears stale** — `news.test.ts` has no clock-dependent/`Date.now`/fake-timer test as described (candidate
  to re-verify/close #553 & #453/#459 which are the wall-clock/keypad E2E flake tickets).
- **⚠ `.claude/worktrees` Vitest exclude is NOT persisted** (`vitest.config.mts:16` excludes only `e2e/**` +
  `node_modules/**`; `package.json` test = bare `vitest run`). 3 live worktrees carry **233 duplicate test
  files** a bare local `npx vitest run` will execute. CI unaffected (no worktrees on checkout). This is exactly
  **open issue #549** — still valid; fixing = add the exclude to `vitest.config.mts`.

## 6. Doc accuracy (drift vs code)

**Premise corrections (the spec's assumptions were partly wrong):**
- **`PROJECT_STATUS.md` does not exist** in the repo. Nothing to rewrite. (Forward-strategy SoR is
  `TRACKER.md`, per CLAUDE.md.)
- **`SCORING_PLAYBOOK.md` does not exist.** The expected dead-schema refs (`rounds.modifiers`,
  `player_hole_scores`) are **NOT** in the current `DEFERRED.md` (it was last rewritten 2026-07-01) — they
  survive only as "already-dropped" comments in migration files + `_archive/`.

**`DEFERRED.md` — real drift:**
- The entire **"Active — Competition & Gaming Engine" A→B→C→D block is SHIPPED**, but framed as "the current
  focus / September critical path." (Slices 0/A/B/C/D all done; routers + tests + competition face all exist.)
- **Phantom tables:** Slice D names `competition_teams`, `competition_team_members`, `competition_games`
  (`DEFERRED.md:71-73`) — none exist. Live tables: `competitions`, `teams`, `team_assignments`, `games`
  (`games.competition_id` FK, mig 056), `game_results`.
- **Wrong course home:** Slice C says course picker → `circle_courses` (`:66`). Reality (CLAUDE.md + mig 039):
  course data is global in **`courses`** via `CourseService`; `circle_courses` is a thin stub, NOT the home.
- Genuinely-open items (keep): Slice E games-tab/scheduling (partial), Slice F modifiers, 2v2 per-individual
  handicaps, desktop side-by-side tee, competition-style chooser, point-value weighting, comp header status
  strip, dead-hole display, v2/Circle-Era, post-launch list, URL slugs (in-flight), token-migration debt.
- One self-referential stale note at `:124-133` claims "TRACKER.md … does not exist" — but it **does** exist.

**`PERMISSIONS.md` — three-tier score model CORRECT (#557/mig 072 ✅), but three schema-name errors:**
- **`events` router/table (`:136,146-148`) — dropped.** `events`/`event_point_distributions` dropped mig 047;
  no `events.ts` router. Functionality moved to `games.*` (`setPointsDistribution`, `setManualResults`).
- **`game_organizers` table + `is_game_organizer()` (`:212,214`) — renamed.** mig 061 → `game_delegates` +
  `is_game_delegate()`. *(Note: the tRPC procedures `games.addOrganizer/removeOrganizer/listOrganizers` were
  NOT renamed — those references stay correct.)*
- **"status incl. drop" (`:153`) — removed.** `dropped`/abandon killed mig 069; `games.setStatus` accepts only
  `pending|active|complete`.

**`CLAUDE.md` / `STYLE_GUIDE.md`:** no factual errors found in the surveyed areas (deploy URL, migration refs,
glossary all check out). STYLE_GUIDE §7's hex backlog is understated vs reality (see §4) but not *wrong*.

## 7. Open backlog (17 open issues)

`bbmi-blocking`: none open. Open set (label): **#558** Quick-Game format picker (feature/post-launch) ·
**#553** news clock-skew test (chore/polish — *likely stale, see §5*) · **#550** context-aware app bar
(feature/polish — *Phases 1+2 shipped via #565/#566; likely closeable or scope-narrowed*) · **#549** worktrees
Vitest pollution (chore/polish — *valid, §5*) · **#517** touch-aware DnD · **#504** non-golf declared-outcome
refresh · **#470** silent score-orphan on player reassign (bug/post-launch) · **#459** stroke keypad E2E flake
· **#453** tripStatus countdown TZ-sensitivity (*note: #548 froze the clock — re-verify*) · **#451** alive-face
Phase 3 assembling animation (feature/pre-launch) · **#448** permissions reconciliation (team procs looser
than owner-only UI) · **#440** archive `game_type_templates` · **#420** local-Supabase test migration · **#419**
BBMI-replay acceptance E2E · **#416** per-user tee assignment · **#412** add-game format-compatible options ·
**#411** add-time incompatible-format gate.

Triage candidates surfaced by this audit: **#549** (fix = one line in `vitest.config.mts`), **#550** (implemented
— close or narrow), **#553/#453** (flake concern may be already-mitigated — re-verify before keeping).

---

## Bottom line
- Competition engine A→D, scoring durability (#543), score permissions (#557/mig 072), **and cross-device
  game-state sync (#563)** are all **shipped and wired**. The "key unknown" — config-hash sync — **landed.**
- CI is genuinely green (956 unit + 2 merge-blocking E2E specs).
- Doc rot is concentrated in **DEFERRED.md** (A–D shown as open; phantom tables; `circle_courses` mis-home) and
  **PERMISSIONS.md** (dropped `events`; `game_organizers`→`game_delegates`; "status incl. drop"). CLAUDE.md,
  STYLE_GUIDE.md, TRACKER.md are accurate. PROJECT_STATUS.md / SCORING_PLAYBOOK.md don't exist.
- Small cleanups worth capturing: stale stroke-nav comments (`GameRow`), unwired `onScorecard` app-bar button,
  understated hex debt in STYLE_GUIDE §7, and the un-persisted worktrees Vitest exclude (#549).

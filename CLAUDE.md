# CLAUDE.md

## Project Overview

- **BuddyTrip** — mobile-first group trip planning and competition scoring app
- Repo: github.com/zgrether/buddytrip
- Deployed: bbmi.app

## Stack

- Next.js 15 (App Router) · React 18 · TypeScript · Tailwind v4 · tRPC v11 · TanStack Query v5 · Supabase (Postgres + Auth + Realtime) · Zod · Vitest · Playwright · Vercel

## Glossary — ratified nomenclature (one word per concept, every layer)

Consistency is load-bearing: the same concept under two names is how auth/spec
seams drift. These are the canonical terms — use them in code identifiers, DB
values, and UI copy alike. (Ratified in `TRACKER.md` §3; this is the home of
record.) Any rename must declare which layer it touches —
**display-string** (cosmetic), **code-identifier** (`tsc`+grep catch misses), or
**DB-value** (an enum/string RLS branches on — `tsc` CANNOT catch a missed RLS
string; highest risk, needs an atomic migration + auth verification).

**Competition hierarchy (4 levels):** competition leaderboard (cup standings) →
game scoreboard (one game's state) → game score entry (entering scores) → game
scorecard (hole-by-hole). "hub" is retired. "face" stays a *navigation* term only
(`CompetitionFace.tsx` — a competition is a face, not a tab).

| Concept | Canonical | Note / landmine |
|---------|-----------|-----------------|
| Unit of play | **game** + **match** (a pairing inside match-play) | "round" means golf's 18 holes ONLY — never a game/match |
| Scoring-on / visibility | **enableScoring** / **Live** (first score flips it) / reveal = Go-Live | one action, one name (`matches.activate` was the old alias — renamed) |
| Combatants | **team** (roster) / **side** (slot, may be solo) | preserve the split — a side is a slot, a team is the roster |
| Rights | **Owner / Organizer / Member** (trip) · **co_admin** (comp) · **delegate** (game) | trip role VALUE is `Organizer` (mig 029, not "Planner"); the one game-scope term is `delegate` |
| A person | **member** (trip) / **participant** (game) / **guest** (placeholder) | ghost == guest — grep hazard |
| Container | **competition** (code) / **cup** (UI) | not "Events" |

## Commit Rules

- Commit after each individual task, not at the end of a phase
- Every commit needs a clear message describing what changed
- Create a PR after each phase is complete
- Never merge a PR with failing tests
- Verify a PR's base is `main` before merging unless intentionally stacking — a
  stacked PR merged into its base branch instead of `main` strands its content
  off `main` (the wrong-base incident that left PR 2's work unshipped)
- **"Unconfirmed" is a valid, preferred answer.** If you can't point to the code
  proving a claim, write "unconfirmed" and list it as an open question — in
  reports, PR descriptions, and commit messages alike.
- **No impact numbers without shown work.** State expected impact only with a
  measurement or derivation shown, else "unmeasured" — an inert predicted
  reduction is worse than no prediction: it gets recorded as verified.
- **Check findings against in-flight work before reporting.** Before finalizing
  a report or PR, check it against open branches/PRs and say so explicitly if a
  finding contradicts or undermines one.

## Issue Tracking (GitHub issues + `TRACKER.md`)

Two layers, kept separate so the issue list stays short enough to actually read.
**GitHub issues = the small, hot, actively-worked set; `TRACKER.md` = slow-moving
strategy + the "someday" nominations** (e.g. the R1 format-architecture refactor,
the full dead-code list, glossary rename sites). Don't promote a tracker
nomination to an issue until it's about to be worked. Labels are two dimensions
only — **type** (`bug`/`dead-code`/`feature`/`refactor`/`chore`) + **priority**
(`bbmi-blocking`/`pre-launch`/`polish`/`post-launch`); the `BBMI 2026` milestone
holds **only** `bbmi-blocking` issues (its 100% bar is the event-critical forcing
function). The standing discipline, followed every session with no reminder:
**(1) Entry rule — actionable, not merely true:** an issue earns its place only
if there's a real version you'd pick up and do; a vague "could be better
someday" doesn't earn one. **(2) Capture-at-the-source:** when you
scope something out of the current task, file it as a labelled issue *in the same
session* — a report is ephemeral and the finding is lost when the session ends.
**(3) Close-on-merge:** every PR that resolves an issue says `Closes #NN`.
**(4) Prune at the merge seam (the shrink valve):** when a feature/phase merges
and you return to `TRACKER.md` to pick the next item, *in that same moment* scan
open issues and close — as `wontfix` with a one-line reason — anything the merge
made obsolete; the backlog going DOWN during this pass is a success. Prune at the
seam, never on a calendar.

## Testing Rules

- Every new tRPC router gets a Vitest unit test before the task is considered done
- Every new database query gets tested against the test DB the suite uses
- **Critical-path E2E must stay green in CI (merge-blocking).** Three Playwright
  specs run merge-blocking — `e2e/critical-path.spec.ts` (auth → stroke game →
  scores → scorecard), `e2e/match-play.spec.ts`, and `e2e/chat-action.spec.ts`
  (chat opens as an overlay without changing the selected tab, and closing —
  including via back — returns to it, on both the desktop and mobile chrome
  variants) — guarding the assembled spine is reachable, the class of break
  unit tests miss. New screens get E2E coverage **when they touch the critical
  path**; broader per-screen coverage is added as specific regressions warrant
  — not up front. (The old "every screen gets an E2E test" rule was
  aspirational and unmet.) E2E auth is a `storageState` login as `test-owner`
  (`e2e/auth.setup.ts`); tests seed a unique trip and tear it down. The other
  13 `e2e/*.spec.ts` are a deferred, mock-based set no Playwright project runs
  yet.
- Tests live next to what they test (`trips.test.ts` alongside `trips.ts`)
- No task is considered complete until its tests pass
- CI runs Vitest (full) + the three merge-blocking Playwright specs on every
  push via GitHub Actions
- **Local-stack test conventions (learned the hard way, ~6× this refactor).**
  CI and local dev both run the server-router suites against an EPHEMERAL LOCAL
  Supabase (`supabase start`, #636), not a shared remote project — see Migration
  Workflow below. Still worth following:
  - **Seed sequentially, never `Promise.all`.** `createTrip`/`addTripMember`/
    `createCompetition` can still race and flake; do them in order.
  - **Budget 60s, not 30s** for BOTH `testTimeout` AND `hookTimeout`
    (`vitest.config.mts`) — Docker/Postgres overhead on CI runners is real enough
    that vitest's 10s `hookTimeout` default flakes a `beforeAll` under load.
  - **A red integration test is real until proven otherwise.** The old shared-remote
    made load timeouts genuinely ambiguous; the ephemeral local stack removes most
    of that — treat a red CI run as a regression first, re-run in isolation
    (`vitest run <file>`) only to confirm before calling it noise.
  - **After any behaviour change, grep tests for assertions of the OLD behaviour
    before pushing** (e.g. relaxing a zod floor → a test asserting the old
    rejection) — proactively, not as a second red CI run.

## Seed Data Rules

- Mock/test data lives only in `supabase/seed.sql` — never in migration files
- Migration files are production-safe — schema, views, functions, triggers, RLS policies only
- `seed.sql` is never run automatically — manual development use only
- Pre-launch reset (done 2026-06-06): truncated all user/trip-scoped data tables.
  `TRUNCATE users CASCADE` alone is NOT enough — `trips` and its child rows have
  no FK to `users`, so they'd orphan; truncate the full data set and keep the
  reference tables (`catalog_ideas`/`golf_courses`/`game_type_templates`). The 6
  real auth-backed `public.users` rows (Zach ×2 + the 4 shared CI test users) are
  recreated after, matching their `auth.users` UUIDs, so the test suite keeps
  working. A pre-reset JSON snapshot lives in `/backups` (gitignored).

## Document Authority

| Question | Defer to |
|----------|---------|
| What's done vs. what's next? | `TRACKER.md` |
| What's deferred and why? | `DEFERRED.md` |
| Who can do what? | `PERMISSIONS.md` |
| How should it look? | `STYLE_GUIDE.md` |
| What shape is the data? | `supabase/migrations/` (migrations are authoritative) |
| How does Realtime work? | Hooks in `src/hooks/useRealtime*.ts` (code is authoritative) |
| How are the domain + email configured (and how to migrate domains)? | `DOMAIN_AND_EMAIL.md` |
| What patterns must CC follow? | This file (`CLAUDE.md`) |

If documents conflict with each other → stop and flag, do not silently resolve.
`CLAUDE.md` is not exempt from code-is-ground-truth — if this file contradicts
the code, the code wins and the contradiction gets flagged, not silently followed.

## Code Conventions

- All decisions about what to build next come from `TRACKER.md` (forward-strategy SoR)
- Supabase queries use the typed client from `src/lib/supabase.ts`
- Auth guards use the `useTripRole(tripId)` hook
- Error handling: tRPC procedures throw `TRPCError` with appropriate codes
- No hardcoded user IDs, roles, or trip IDs in application code
- Before making any styling change, read `STYLE_GUIDE.md`
- Never use hardcoded hex color values — use tokens from the `--color-bt-*` system
- Never set background colors outside the surface hierarchy defined in `STYLE_GUIDE.md` Section 1

## Enforced Patterns

These patterns have been established through prior work. Follow them exactly — do not invent alternatives.

1. **Optimistic updates** — hand-rolled `utils.<query>.getData` → `setData`, with
   `invalidate()`/`refetch()` (re-pull server truth) as the "rollback" on error. NOT
   the `onMutate` + snapshot-restore idiom: `src/components/games/` has **zero**
   `onMutate` (grep confirms). A mutation reads the cached row, writes an optimistic
   patch via `setData`, and on failure re-fetches rather than restoring a snapshot.
   (The whole game-settings surface has since moved to draft-then-save — one atomic
   `save_game_config` per page, no per-row optimism at all — see #18.)
2. **TypeScript cache typing** — explicit generics on `queryClient.setQueryData`
3. **Migration naming** — `NNN_descriptive_name.sql` (sequential, no gaps). The `NNN`
   is COSMETIC: Supabase applies and orders migrations by the full `YYYYMMDDHHMMSS_`
   timestamp prefix, not the `NNN`. So two branches in flight can each grab the same
   `NNN` and both merge — main currently carries two `084`s (`084_games_realtime` +
   `084_save_game_config_structure_field_split`), applied fine because their timestamps
   differ. **Check `main` for the next free `NNN` before picking one** (it recurs the
   moment two branches are open). Do NOT rename an already-applied migration to
   de-dup — CI's `schema_migrations` history check compares filenames and fails on a
   rename. A dup `NNN` is a cosmetic wart, not a bug; leave applied ones alone.
4. **RLS INSERT RETURNING split** — separate INSERT and SELECT to avoid RLS race condition
5. **Middleware auth** — `requireAuth` before any `requireTripMember`/`requireTripRole`
6. **Test isolation** — 4 shared persistent users (`test-owner`, `test-planner`, `test-member`, `test-outsider`), unique trips per test
7. **Persistence-agnostic game UI** — scorecard components in `src/components/games/`
   (`ScoreEntryView`, `MatchEntryView`, `MatchCard`, `RelHandicapControl`,
   `StrokeKeypad`, `StandardGrid`, `FinalStandings`) take all data via props and
   emit changes via callbacks (`onChange`/`onClear`/`onFinish`/`onCellTap`).
   **No tRPC / DB / auth inside.** The parent owns persistence — a trip wrapper
   backs them with tRPC; Quick Game (Slice A2) backs the *same* components with
   local storage. Unit count / labels / sections come from `scorecard_schema`
   props, never a literal (no hardcoded `18` / "hole"). Slice B layers the strip +
   stroke pips OVER this Slice A view rather than replacing it (shared
   `entryChrome.tsx` = nav/progress/CTA).
8. **Shared result computation** — the pure scoring/ranking lives in a
   **client-safe** module (`src/lib/strokePlay.ts` for stroke play,
   `src/lib/matchPlay.ts` for match play — no server/DB deps) so the live strip
   (client) and the persisted final record use the SAME function and can't
   diverge. The DB-write wrapper (`src/server/lib/{strokePlay,matchPlay}.ts`)
   imports the pure fn. Mirror this split for every new `result_strategy`, and
   branch `games.finish` on the template's `result_strategy` (data-driven, NOT a
   hardcoded format name) so new strategies slot in without touching `finish`.
   **`games.finish` is now the ONLY finalize — this line went from prescription to
   description.** A second finalize, `games.post`, existed for non-golf and was
   merged away: it ran the same select, the same `result_strategy` dispatch and the
   same lock write, its three engine arms were character-for-character duplicates
   of `finish`'s, and no client or test ever reached them. It existed to route
   AROUND the `null` (manual) arm — which was already a first-class member of the
   same closed strategy set, served by `post` and refused by `finish`. So the fork
   was never a design; it was this rule not being followed. `null` is now a served
   arm of the one dispatch (`placements` is its manual-only input), and the tell to
   watch for is a NEW procedure appearing whose reason for existing is "this format
   is different" — that is a hardcoded format name wearing a procedure's clothes.
   Two supporting facts worth keeping: the guards the two ran behind
   (`requireGameEdit` / `requireGameRunAction`) are the same function with a
   different error string, so the split had no permission basis either; and `post`'s
   own doc comment asserted a distinction ("NOT 'finalize': re-runnable") its code
   never made, which is how the two drifted into looking like different things.
   The competition board's LIVE projected-points pill extends this: the read-only
   `src/server/lib/liveProjection.ts` runs the SAME pure projection fns the game
   pages use (`rollupMatchPlay` / `computeRack("projected")`) server-side and
   folds the result into the `competitions.leaderboard` payload (rides its 30s
   poll, no new client fetch), so the board pill and the game-page projection row
   can't diverge. When a surface needs a live projection, reuse the pure fn — do
   NOT write a second rollup.
9. **Derived values recompute on every input — not just the obvious one.** A value
   derived from multiple inputs must re-derive when *any* of them changes;
   enumerate the full trigger set, not just the one that's easy to think of.
   Match-play hole results derive from `score_entries` +
   `game_participants.handicap_strokes` + roster (`side_a`/`side_b`), so
   `matches.setHandicap` and `matches.assignPlayer` retrigger the recompute
   (`computeMatchPlayResults` + client query invalidation) exactly as a score
   entry does. **Freeze boundary:** recompute in-progress matches only — pass
   `computeMatchPlayResults(..., { skipComplete: true })` so a `complete`/frozen
   result is never rewritten by a late edit (`finish` omits the flag → processes
   all). The tell to watch for: "X is derived from {A, B, C}" but the code only
   re-derives on a change to A.
10. **Bootstrap-seeded caches: invalidate `faceBootstrap`, not just the child
    query.** The competition Live face renders its leaderboard + setup guide from
    child caches (`competitions.leaderboard`, `teams.list`,
    `teamAssignments.list`, `games.listByTrip`, …) that `LiveFaceClient` **seeds
    from `competitions.faceBootstrap`** via `setData` on every mount. So any
    mutation that changes faceBootstrap-snapshotted data — team colors/names,
    assignments, game config, **finalize/lock/score-correction results**, go-live
    — MUST invalidate `competitions.faceBootstrap`, **not only** the specific
    child query. Invalidating just the child is silently undone: the face's
    `setData` re-seed writes the bootstrap's (possibly stale, router-cached)
    value back AND marks the query fresh, so no refetch fires and the surface
    reads stale until the 30s poll. Keep the child invalidate too (other
    surfaces read it directly), but `faceBootstrap` is the one that actually
    refreshes the face. The tell: "I invalidated `competitions.leaderboard` but
    the board is still stale until a hard refresh / the poll." (History: the
    team-color audit established this for setup-data mutations; the rack/1v1
    finalize + correction lag was the same class on the result path.)
11. **Glorious Finishing Holes weight is DERIVED, never snapshotted.** The "last N
    holes worth 2×" modifier (`games.modifiers.glorious_holes: { holes: N }`) is
    applied at COMPUTE time by `holeWeight`/`remainingSwing` (`src/lib/gloriousHoles.ts`),
    never stored on a hole result — flip the flag or change N mid-round and the tally
    just recomputes (nothing migrates). It weights the match tally (a won glorious
    hole is ±2) and, critically, close-out/dormie compare the lead to the WEIGHTED
    `remainingSwing`, NOT raw holes left (a 4-up lead with 3 glorious holes / swing 6
    is still live). Match SINGLES/DOUBLES only, **guarded on `game_type_id`** (via
    `isMatchPlayFormat`) — NOT the competition `scoring_model` (rack is `match_play`
    by scoring_model but is net-stroke entry, excluded). The ONE weighted `matchState`
    (`src/lib/matchPlay.ts`, `buildDecided` now emits `{hole, result}[]`) feeds the
    live client strip AND the server `computeMatchPlayResults`, so they can't diverge.
    The margin string keeps X = weighted lead, Y = raw holes-to-play (so "4&2" is a
    legal, correct glorious margin — do not "fix" it).
12. **Panel navigation idiom (game surfaces open as client-overlay panels, not
    routes).** Each format view (`MatchGameView`, `RackGameView`, `StrokeGameView`,
    `NonGolfGameView`) is a standalone component that reads its own `tripId` +
    `?game=<id>` from `useSearchParams`. The `/games/.../` route is a THIN WRAPPER
    rendering the same component. The leaderboard (`CompetitionFace`) opens a game
    as a panel over the persistent, warm board via History API `pushState`
    (`?game=`) — no server round-trip, no Next.js parallel routes (the app has
    none). The `opensAsPanel` predicate (`gameRoutes.ts`) is an explicit format
    ALLOWLIST, not `!!id`, so unknown types never silently panel. `CompletedRow`
    routes through the panel too. Warm-cache seed = instant paint; never
    spinner-gate a panel open. **Reuse this idiom for any new game surface — do not
    add a new routing construct and do not reach for parallel routes** (that
    recommendation was made once and was wrong; Phase 0 caught it).
13. **GameChrome context-aware app bar.** Game views publish chrome up to `TopNav`
    via the `GameChrome` context (a two-context store, so the publisher's effect
    can't loop): `{ title, onSettings?, onScorecard?, hideBottomNav? }`, published
    via `usePublishGameChrome` gated on `useInGamePanel()`. Board mode =
    flag/wordmark left; chat + news + team-color avatar right. Game mode = back +
    single-line game title left (NO format subtitle — dropped as cruft);
    owner/delegate-only settings gear right; chat/news/avatar persist (chat is
    reachable inside games). The panel sits at `top-14 z-30`, BELOW the 56px bar.
    Header suppression is PROVIDER-AWARE: a game view keeps its own header on a
    standalone route (no `TopNav` there) and suppresses it only when a `GameChrome`
    provider is present. `hideBottomNav` is published only on focused entry surfaces
    (stroke entry / match score / rack entry group). A scorecard Sheet covers the
    app bar when open (a modal owns the screen). **Follow this for any game-surface
    chrome.**
14. **Bottom-control anchoring.** Bottom CTAs (next-hole, Finish, primary in-game
    actions) anchor to the VIEWPORT bottom — the way rack-n-stack's slide-up keypad
    does — NEVER placed at the end of the CONTENT. Content-anchored CTAs fall below
    the fold on tall holes and small viewports (the Pixel 7 Pro failure). **Reuse
    rack's anchored pattern for any new in-game bottom control.**
15. **Score durability — the outbox.** `useScoreSaver` is the single per-hole write
    path (stroke / rack / match). Advance and finish gate on SAVE CONFIRMATION, not
    local completeness — only `saving`/`error` cells block (`unconfirmedOnHole` /
    `unconfirmedCount`). A durable localStorage outbox (keyed
    `bt.scoreOutbox.v1:<gameId>` by `scoreCellKey(participantId, unitLabel)` — the
    same id the server upsert uses) persists each unconfirmed score BEFORE the
    mutation settles, clears it on server confirm, and recovers survivors on mount.
    A failed save keeps the value and flags the cell `error` — NEVER roll back to
    blank. **The active enterer's in-flight cells (saving / error / in-outbox) WIN
    over any remote update — never clobber them** (this is the contract sync depends
    on). Non-golf is the deliberate exception: it posts placement RESULTS via
    `games.finish`'s manual arm (`placements`), not per-hole `score_entries`.
16. **Game-state sync — config-hash cross-device reconcile.** Cross-device
    convergence with zero schema changes and no Realtime. Scores poll ~20s
    (`useConfigSync`, `GAME_SYNC_INTERVAL_MS`, no background refetch). Config
    (groupings / modifiers / rules / settings) is covered by `games.configHash`: an
    FNV-1a hash over sorted-key canonical JSON of the config columns + participants
    + play_groups + matches, computed ON READ (`configHash.ts`, client-safe 8-hex).
    **Score-derived fields are excluded from the hash on purpose** so entering
    scores never churns it. The client reads the hash on the SAME tick as the score
    poll (same TICK, but its OWN request — `games.configHash` is routed through an
    un-batched link in `providers.tsx`, because a batch resolves at the speed of its
    slowest member and a slow hash was holding up UI reads that merely shared its
    tick: measured 0.5s → 21s on a settings paint. Cadence is unchanged — the link
    changes transport, not scheduling); the full config refetches ONLY on
    hash-mismatch. Convergence is SILENT (chat/text are for human comms, not sync).
    Score reconcile (`scoreReconcile.reconcileScores`) overlays server values EXCEPT
    unconfirmed local cells (`protectedKeys`) — active enterer wins, dovetailing
    with the outbox (#15). **Any new config field must be included in the
    `configHash` input, or mid-round changes to it won't propagate to other
    devices.** This is now MECHANICAL, not remembered — TWO guards enforce it:
    (a) the **behavioural** hash-invariant guard (`games.saveConfig.p2.test.ts`,
    table-driven) asserts, per field the RPC writes, that the hash MOVES on a real
    change and does NOT churn on an idempotent re-write — **add a field to
    `save_game_config` → add a row to that table**; (b) the **observational**
    coverage guard (`configHash.coverage.test.ts`) reads each hashed table's live
    columns via `select('*')` and asserts every one is in `HASH_COLS ∪ NOT_HASHED`,
    so a brand-new column can't be silently omitted from the hash. **The invariant,
    plainly:** *everything the RPC writes must be hashed; every LIST read the hash
    folds in needs a total order — a column UNIQUE within the `game_id` filter — or
    two rows can swap and the hash miss it; hash semantic content ONLY, never
    re-minted provenance (`created_at`, `granted_by`) or an `id` re-minted by a
    clean-replace on an unchanged set.* Landmine of record: the hash's own read once
    queried `.from("matches")` — a relation that doesn't exist (match rows live in
    `game_matches`) — and only `gameRes.error` was checked, so the error was
    SWALLOWED and `matches: []` folded into every hash for six weeks, silently
    disabling this cross-device sync AND letting `saveConfig`'s concurrency check pass
    while pairings were clobbered. Four fields went silent this way before the guards
    existed (`.from("matches")`, `game_delegates`, `point_value`/`handicap_strokes`,
    `play_groups.tee_time`) — three caught only because someone thought to ask.
17. **Modifiers commit on Save (draft slice), NOT on row-collapse.** RETIRED the
    old "persist only on Game-Modifiers-row COLLAPSE" rule — persist-on-collapse is
    gone from all four formats (P2). `games.modifiers` is now a slice of the composite
    draft (`modifiersDraft`), committed atomically by `save_game_config` with the rest
    of the page; there is no collapse-timing window to lose an edit in. (The old rule's
    own failure mode — an edit lost because the row was left open — is fixed by this,
    not just documented.) Still true: Glorious Finishing Holes is the one modifier safe
    to flip mid-scoring under the #501 freeze — it's derived-at-read-time, never
    snapshotted, so a late write just changes what the next compute returns (see the
    design note in `DEFERRED.md` under "Glorious Finishing Holes — known limitations").
18. **Game settings = draft-then-save (one atomic RPC per page).** All four formats
    (match / non-golf / rack / stroke) commit their WHOLE settings page through ONE
    `save_game_config` call — nothing self-persists per row. The shape, per view:
    format-specific `*ConfigDraft` variants over a shared `BaseConfigDraft`
    (`src/lib/configDraft.ts`); null-per-slice state assembled OVER a `serverConfigDraft`
    mirror into one `configDraft` memo; a frozen `{ draft, hash }` baseline (the dirty
    reference AND the optimistic-concurrency base — ONE `serverHash` value feeds both the
    outbox `base` and Save's `baseHash`, frozen on the `anyTouched` transition so the
    ~20s poll can't refresh it mid-edit); `dirty = anyTouched && !<variant>DraftsEqual(...)`;
    a composite `useDraftOutbox` for hard-teardown durability; gear-path confirm-on-leave
    (`useGameSettingsOverlay` + shared `DiscardChangesPrompt`). The destroys-tier changes
    are refused SERVER-side (`HAS_SCORES` for match matchups / rack groupings; `COURSE_LOCKED`
    for a course change on a scored game) — the client no longer freezes settings by
    `scoring_enabled` (the "lie sweep" removed that). **THE RULE this produced —
    every server→draft repoint requires a sweep of everything downstream of it.** When a
    surface stops reading server state and starts reading the draft, EVERY other reader of
    that value must move too, or it lies: six lies surfaced on the match page alone (the
    Save bar said "All changes saved" after Cancel; the Setup/Scoring copy said "the game
    is live" on a merely-staged flip; `settingsEditable` read the server while the toggle
    read the draft; `chromeTitle` showed two names for one game at once; `ScoringLockBanner`;
    and rules-of-the-day's banner promised editability the RPC then refused) — **and the
    fifth was created by the fix for the fourth.** Enumerate the full downstream reader set
    before repointing; don't discover them one regression at a time.
19. **`useRealtimeGame` is wired into all four game views (Match/Rack/Stroke/Non-golf).**
    It pushes config changes (the five tables `games.configHash` fingerprints — `games`,
    `game_matches`, `game_participants`, `play_groups`, `game_delegates`, all published in
    migration 084) live via a `game:{gameId}` channel, pure-invalidating the game's read
    queries on any event. The `configHash` poll (#16, `useConfigSync`/`useConfigDraft`,
    ~20s) stays wired in **all four views too, deliberately** — it is the reconnect/
    dead-zone backstop for a socket drop, a backgrounded tab, or a network handoff (not an
    edge case on a golf course). **Do not remove the poll as "redundant" with Realtime —
    the redundancy is the point.** (Source: `DATA_FRESHNESS_AUDIT.md` §8-F5.)
20. **Score/lifecycle changes reach the board by DB BROADCAST — and the payload is a
    SIGNAL, never data.** A trigger (migration 096, `broadcast_score_event`) fires on
    `score_entries` / `match_hole_outcomes` / `game_results` (I/U/D) and on `games`
    UPDATEs **guarded by a `WHEN` clause on the three columns that move the board**
    (`status`, `corrections_open`, `scoring_enabled` — without that guard every settings
    save would broadcast). It sends `{gameId, competitionId}` on topic
    `competition_events:{competitionId}`; `useRealtimeScoreEvents` subscribes and
    invalidates. This replaced the 30s `competitions.leaderboard` poll, which cost
    ~1,900 req/hour at BBMI scale to mostly learn nothing had happened.
    - **Broadcast, NOT `postgres_changes`.** Migration 084's exclusion of the score
      tables from the Realtime publication **still stands** — broadcast needs no
      publication and lets the DB decide what subscribers are told instead of shipping
      whole rows over WAL. Do not add score tables to the publication.
    - **Never put scores, names, or standings in the payload.** The topic is public
      (`private => false`), so the payload is what an *unauthenticated* listener gets;
      the client's tRPC refetch is what re-applies auth/RLS. The tempting optimization
      ("we already have the score in the event, why refetch?") breaks security **and**
      #15 simultaneously — applying a payload value would clobber the active enterer's
      in-flight cell. Invalidate-and-refetch is what preserves both; they fail together.
    - **Invalidate `faceBootstrap` AND `competitions.leaderboard`** (#10 — the child
      alone is silently undone by the face's re-seed), plus `scores.listByGame`, which
      routes the change through the view's existing `reconcileScores(..., protectedKeys)`
      effect. **Alternate trigger, same reconcile — never write a second overlay path.**
    - **Subscribe on VIEW, not on membership**, and share the channel: the registry in
      `useRealtimeScoreEvents` is **ref-counted** because under #12 the board stays
      mounted beneath an open game panel, so two surfaces watch one topic and a naive
      unmount would `removeChannel` out from under the one still on screen.
    - **The 5-minute `LEADERBOARD_QUERY` interval is a dead-socket backstop, not the
      freshness mechanism.** Same reasoning as #19: do not remove it, and do not tune it
      back down to make the board feel live — if the board feels stale the subscription
      is broken, and shortening the poll hides that. The ~20s `configHash` poll is
      untouched by this.
    - **A broadcast failure must never roll back a write.** Two independent layers:
      `realtime.send` already swallows its own errors (`RAISE WARNING`), and the trigger
      body has its own `WHEN OTHERS` handler. Standalone games (~40% of prod) simply
      early-return — the null-competition path is the COMMON case, not an edge case.
    - **The topic string is a two-sided contract** between the SQL trigger and
      `scoreEventsTopic()`, and a mismatch fails SILENTLY — scores still save, the board
      still renders, live updates just stop. `broadcastScoreEvents.test.ts` imports the
      constants from the hook and subscribes with a real client to pin it end to end.
      (It caught exactly this during the build.) Note `competition:{tripId}` is a
      DIFFERENT, pre-existing topic owned by `useRealtimeCompetition` (competition ROW,
      keyed by trip) — keep the two prefixes distinct.

21. **Trip identity in a URL is the UUID. There is no second form.**
    `/trips/{uuid}` is the only shape the app produces — no slug, no `slug ?? id`
    fallback, no resolution step. Everything below the URL was already UUID-only
    (tRPC inputs, realtime channel names, React Query cache keys); now the URL
    layer is too, so there is nothing left to collapse. The param is still read in
    exactly ONE place — `TripIdProvider` (mounted by `/trips/[tripId]/layout.tsx`)
    — and every trip-scoped surface reads **`useTripId()`**. **Do NOT call
    `useParams().tripId` in trip-scoped code**: a source guard in
    `TripIdProvider.test.ts` fails the build if you do. A second guard asserts no
    call site builds a trip URL from anything but `.id`.

    **This REVERSES what this entry said before, and the reversal is the point.**
    The previous version described the URL as deliberately slug-OR-uuid and called
    that ambiguity "load-bearing." It was neither deliberate nor load-bearing: trip
    URLs originally used the UUID, slugs were added, then judged a poor
    implementation and removed — but the removal was incomplete, and the app drifted
    back onto the surviving machinery. #741 met that half-state while fixing a real
    bug (the Cup tab rendering "no competition yet" for any trip opened from a list,
    because `LiveFaceClient` handed a slug to a procedure matching
    `trip_members.trip_id` exactly) and wrote the observed behaviour down as
    architecture. **Recording an unfinished removal as an intended design is how it
    becomes permanent** — the next reader follows the doc and preserves it. The bug
    fix was right; the generalisation was not. Slugs are not wanted: the machinery,
    the generator (`src/lib/slug.ts`), and the resolver are gone, and `trips.slug`
    itself went in migration 097 (#743) — applied to production. The removal is
    complete; nothing in the stack writes or reads a second identifier form.

22. **A shared realtime topic is REF-COUNTED, and a shared query set has ONE
    invalidator.** Both halves generalise #20's score-event rules to every
    subscription, because chat broke on both and neither was enforced by anything
    but a comment.
    - **Ref-count the topic.** More than one mounted component may watch the same
      topic, and *which* components has changed with every shell restructure. Two
      `supabase.channel(sameTopic)` objects means two joins for one stream, and the
      first unmount `removeChannel`s a topic the other still needs — silently. So a
      hook that subscribes owns a module-level `Map<topic, {channel, handlers, refs}>`
      and hands back a release fn that tears down only on the LAST release (and is
      inert if called twice — StrictMode/fast refresh run cleanups twice).
      `useRealtimeScoreEvents` and `useRealtimeChat` both do this; `acquire` is
      exported from each for tests, since the suite is `environment: "node"` and the
      ref-count is the part with real failure modes. **Do NOT instead pick a
      "canonical" subscriber and document that nobody else may subscribe.** That was
      chat's design for three restructures, and the comment asserting it
      ("the open panel deliberately does NOT also subscribe") was FALSE by the end —
      #756 remounted `ChatToolButton` on the trip page and created the second
      subscriber the comment said couldn't exist. A comment cannot enforce an
      invariant across a shell that keeps changing what is always-mounted;
      ref-counting makes duplicate subscribers correct instead of forbidden.
    - **A dead subscription must SAY SO.** Handle `CHANNEL_ERROR` / `TIMED_OUT` /
      `CLOSED`, don't only branch on `SUBSCRIBED`. A subscription that never
      establishes is indistinguishable from a working one with nothing to report,
      which is precisely why chat presented as "barely working" rather than "broken"
      and cost three sessions to find.
    - **One invalidator, not two lists that happen to match.** When a realtime
      handler and a mutation refresh the same data, the delta between their key lists
      IS the bug: chat's `messages.send.onSuccess` invalidated `messages.list` (a
      refetch that incidentally healed what realtime missed) while the realtime
      handler only patched the cache and invalidated the counts — so POSTING worked
      and RECEIVING didn't ("you don't see it until you post something"). Both paths
      now call `invalidateChatQueries` (`src/lib/chatQueryInvalidation.ts`) and
      nothing else. Mirror this for any new realtime surface: a new query gets added
      to the shared helper once, so there is no second list to forget.
    - **Omit an optional key, never pass it as `undefined`.** React Query matches
      query keys by PARTIAL DEEP EQUALITY, so a filter carrying `visibility: undefined`
      does **not** match a cached key whose visibility is `"crew"` — the invalidation
      silently hits nothing. Build the input without the key when you mean "all".

23. **A declared return type is not a runtime guarantee across a library
    boundary.** `tsc` checks that your code agrees with a library's *declaration*.
    It cannot check that the library agrees with itself, so a wrong declaration
    type-checks perfectly and fails only at runtime — and if the consuming code
    silently tolerates the wrong shape, it fails **invisibly**.
    Established by #730: `createServerSideHelpers().dehydrate()` is typed
    `DehydratedState` and actually returns a superjson envelope (`{ json, meta }`),
    so `<HydrationBoundary state={...}>` read `state.queries`, found `undefined`,
    iterated nothing and returned. **No error, no warning, clean `tsc`.** Every
    prefetch in the trip layout was decorative from the layout's creation until
    someone measured it — and it had been WORKED AROUND TWICE (`TripBootSeed`,
    then the #751 role-flash seed) by people who correctly observed the symptom
    and reasonably assumed the framework mechanism was simply unreliable.
    **The tell:** a value crosses a library boundary, the type says it arrived,
    and the consumer's behaviour says it didn't. When those two disagree, believe
    the behaviour and go read the library's compiled source — `node_modules`
    is readable, and in this case the answer was one line
    (`const after = resolvedOpts.serialize(before); return after;`).
    **The guard:** any cross-library data contract that can fail silently gets a
    runtime test, because a type annotation is not one (`hydrationTransport.test.ts`
    pins this one, including the inverse — that "completing" the config with
    `hydrate.deserializeData` would double-deserialize and break it). Related but
    distinct from #16's landmine, where a swallowed `error` hid a missing relation:
    same *invisibility*, different source — that was our code ignoring a signal,
    this was a library declaring something untrue.

### Reuse targets (shared helpers — do not re-decide per site)

- **`teamTextColor`** (`src/lib/teamTextColor.ts`) — computed sRGB relative
  luminance picks dark/light text for any team-color background. ONE shared helper;
  do NOT hardcode a per-color choice and do NOT re-derive per site. Applied in
  `Avatar`, `MatchCard`, rack board.
- **Scorecard icon = lucide `Table2`** everywhere (leaderboard rows, entry pages,
  preview-scorecard buttons). Do not substitute another table/grid glyph.
- **Scorecard = a `Sheet` overlay** (`Sheet` primitive), not a full-page route —
  slides in over its caller (leaderboard / scoreboard / entry), dismisses back to
  the caller, and PRESERVES score state (the caller's `useScoreSaver` feeds both the
  base view and the sheet). Reuse the `Sheet` primitive for overlay surfaces; this
  is also the working reference for the someday unified `<Overlay>` primitive.
- **Game-type icon = `categoryIcon`/`CATEGORY_ICONS`** (`src/lib/gameCategoryIcon.ts`)
  — ONE shared category→icon map (golf/card/yard/bar/other), sourced from each
  game type's `category` field in `gameTypes.ts`. The add-game picker
  (`CompetitionGamesPanel.tsx`) and the leaderboard board (`GameRow.tsx`'s
  `formatIcon`) both resolve through it, so they can't drift. Key icons by
  CATEGORY, never by scoring format — a format-keyed map (swords for match play,
  layers for rack) reads as "combat/stack" on a board that's half non-golf.

## Guest → real-user conversion (auth)

Placeholders/invited crew are `users` rows with `is_guest = true`. When a real
account signs up, the DB does the conversion — there is no app-code path:

- `on_auth_user_created` (trigger on `auth.users`) → `handle_new_user()`.
- If a guest row matches the new email, `handle_new_user` nulls the guest's
  email, inserts the real `users` row, and calls
  `merge_guest_to_real_user(ghost_id, real_id)` to reassign **every** person
  reference, then delete the guest row. It then marks matching `invites`
  accepted. Don't maintain the table list here — it drifted once already
  (this doc still listed only the trip era long after the competition tables
  were added). **`\sf merge_guest_to_real_user` against the live DB is the
  source of truth**; as of migration 095 it spans the trip era, the
  competition/scoring era (incl. `game_delegates` and the `game_matches`
  side_a/side_b JSONB), and the authorship/audit columns.
- Signup is **not** the only caller. `ghostCrew.update`'s auto-link branch (an
  owner pasting an email onto an existing placeholder) merges too, via the
  `link_guest_to_account` wrapper — the core stays revoked from `authenticated`
  because it would otherwise be an account-takeover primitive. That branch used
  to repoint `trip_members` alone, which orphaned 123 competition rows in
  production (rosters read "Unknown"; scoring stayed gated on the ghost). If you
  add a third path that links a placeholder to an account, call the merge — do
  not hand-roll a subset of it.
- Brand-new emails (no matching guest) skip the merge entirely.
- Deleting a user is also DB-side: `on_auth_user_deleted` (trigger on
  `auth.users`) → `handle_user_delete()` deletes the matching `public.users`
  row (`id = OLD.id::text`); FKs into `public.users` cascade the rest. Added in
  migration 025 — without it, the Supabase dashboard "Delete user" left an
  orphaned `public.users` row and the email stayed blocked by `users_email_key`.

**Keep `merge_guest_to_real_user` in lockstep with the schema** — it runs inside
the signup trigger, so a reference to a dropped table/column makes the whole
signup fail (this exact bug was fixed in migration 023, and migration 024
dropped the `series.owner_id` reassignment in lockstep with `DROP TABLE series`).
When you drop a table or a `user_id`/`created_by` column, update this function in
the same migration.

**ADD a person-referencing table → add it to the merge, in the same migration.**
The drop rule above existed for years; the add rule didn't, which is exactly how
this drifted — the competition engine shipped whole eras of `user_id` columns
that the merge never learned about. This direction fails *silently*, which makes
it the more dangerous one: the merge ends by DELETEing the guest, so an
uncovered column is either **cascade-deleted** (`game_delegates`, `news_posts`,
`chat_reads`, … — data destroyed) or **null'd** (`schedule_items.created_by`,
`circles.created_by`, … — authorship lost). Nothing errors; you find out later.
Two specifics worth knowing:
- **A JSONB person reference needs `jsonb_set`, not `SET col = …`.**
  `game_matches.side_a/side_b` store `{type,id}` and were invisible to every
  `UPDATE … SET user_id` in the function.
- **Any table with a UNIQUE/PK containing `user_id` needs collision handling.**
  If the guest and the real account both hold that key, a plain UPDATE raises
  23505 *inside the signup trigger* and signup fails for that user. Migration
  095 deletes the guest's losing row first (the real account wins) for all nine
  such tables. Follow that pattern.

To check coverage, diff the function against the schema rather than trusting any
list: `SELECT table_name, column_name FROM information_schema.columns WHERE
column_name IN ('user_id','created_by','submitted_by','paid_by_user_id',
'entity_id','participant_id','granted_by','author_id','confirmed_by')` — plus a
scan of `jsonb` columns for embedded ids.

## Migration Workflow

Migrations are committed as files in `supabase/migrations/`. **CI does NOT apply them to any
remote DB** — each CI job runs `supabase start`, which boots a fresh LOCAL stack and applies
the ENTIRE migration history from scratch on every run (Step 0, #636 — the change that took
CI and local dev off the shared prod project). Two consequences follow:

- **Replay-from-zero is now an enforced gate.** A migration that isn't cleanly replayable on
  an empty DB fails CI immediately — this is what caught the `044` hardcoded-uuid delete
  (#636; it deleted rows by ids that only existed on the prod box, so a fresh replay missed
  them and a later migration collided on a UNIQUE key). Keep migrations additive and
  idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, guarded inserts) **and
  reproducible from zero** — no DELETE/UPDATE keyed on environment-specific ids; key on
  stable columns.
- **Prod is applied manually, separately from merging.** Merging a PR does NOT push its
  migration to prod. Apply it to the prod project by hand with `supabase db push --linked`
  (records the version under the filename timestamp), as its own step around the deploy.
  There is now one alternative *route* to the same manual act — a `workflow_dispatch`-only
  Action (`.github/workflows/prod-migrations.yml`, documented in `ENVIRONMENT_AUDIT.md`
  §1.2a) for when there is no laptop to run the CLI from. It changes nothing about this
  rule: still manual, still separate from merging, still never on a merge or a schedule.
  **`--linked` from a laptop stays the default path; the button is the exception.**

**Don't apply migrations via the Supabase MCP tool** (`apply_migration`, raw `execute_sql`
for DDL). It records the migration under the *apply timestamp*, which differs from the local
filename timestamp — so the next `supabase db push --linked` fails with "Remote migration
versions not found in local migrations directory." (If it happens: delete the
apply-timestamped row from `supabase_migrations.schema_migrations` — history table only; the
idempotent schema change stays — then re-push.)

**The flow:**

1. Write `supabase/migrations/YYYYMMDDHHMMSS_NNN_name.sql`. The `NNN` is cosmetic (ordering
   is by the timestamp prefix, not `NNN`); check `main` for the next free `NNN`, since two
   open branches can grab the same one.
2. It applies to your LOCAL stack automatically on the next `supabase start` / test run — no
   push needed to run or test it.
3. **Land a migration on `main` as its own PR, BEFORE the client code that depends on it, and
   `supabase db push --linked` it to prod before that code deploys.** The old shared-remote
   *deadlock* rationale is gone (CI no longer pushes to a shared DB, so a migration on one
   branch can't leave `main` "behind remote" for anyone else). But the ordering still matters
   for PROD: the schema must exist in prod before the deploy that reads it — 081 shipped ahead
   of its push once and produced the live "could not find function save_game_config in the
   schema cache." Migrations are additive/idempotent, which is what makes landing them early
   safe.
3b. **A REMOVAL inverts step 3 — same principle, opposite direction.** Step 3 is written for
   ADDITIVE schema, where the code needs the column to exist, so the migration goes first. A
   `DROP COLUMN` / `DROP FUNCTION` reverses the dependency: the code has to stop WRITING the
   thing before the thing can go, or the deploy boundary breaks in the other direction — drop
   `trips.slug` while `trips.create` still inserts it and every trip creation fails with
   "column does not exist" until the new code lands. So for a removal: **land and DEPLOY the
   code that stops using it FIRST, then the drop migration as its own follow-up PR.** Both
   halves of the rule are the same idea — the schema and the code must never be in a state
   where one references something the other hasn't provided — it just points the other way
   depending on whether you're adding or removing. (Established removing the trip-slug
   machinery: #742 shipped the no-slug code, then #743 dropped the column — the
   ordering this rule prescribes, carried out.)
4. **Never edit a migration after it's applied to prod — write a new one.** The one
   exception, set by the `044` fix (#636): a *body-only* change to make a historical migration
   replay cleanly on a fresh DB is safe — prod already recorded that version and won't re-run
   it, and a body edit (unlike a rename) doesn't break the filename-based history check. Use
   it ONLY to restore replayability, never to change what prod already has.
5. **A migration reversing an earlier decision cites what it reverses** —
   reference the earlier migration + its comment, and state why the reversal is
   correct now. The prior comment is evidence, not authority, but it deserves a reply.

## Index Creation

Plain `CREATE INDEX` is acceptable in migration files for tables that are
**small at the time of migration** (the lock is sub-millisecond). This is what
migration 023 did for `idx_messages_user_id`.

For **large live tables** (>100k rows, or high write volume during active use),
use `CREATE INDEX CONCURRENTLY` applied **out-of-band** via the Supabase CLI
(against the linked DB) or the dashboard SQL editor — **NOT in a migration
file**. Supabase wraps each migration in a transaction, and `CONCURRENTLY`
cannot run inside a transaction, so `supabase db push` errors on it.

> If you must keep the index in version control, put the `CONCURRENTLY`
> statement in a separate `.sql` note (or a comment in the migration) and apply
> it by hand — don't let `db push` execute it.

Anticipated tables that will need out-of-band `CONCURRENTLY` indexing once the
competition/gaming engine ships and they carry real volume (none exist yet — the
2026-06-06 reset left the DB near-empty, and the engine tables aren't built):
- `score_entries` (`game_id`, `user_id`)
- `game_results` (`game_id`, `entity_id`)
- `circle_bet_results` (`bet_id`)

Already indexed plainly and fine as-is: `messages` (`user_id`).

## Schema Cleanup Rule

Before any `DROP COLUMN` or `DROP FUNCTION` migration, grep current `main` for
every reference **and** verify against the live DB. **Audit-tool output is a
starting point, not a verdict** — it produces false positives that are dangerous
to act on. Three real examples from this codebase:

- `trips.comparison_mode` and `trips.itinerary_enabled` were flagged "dead" by
  the 2026-05-28 audit but are **load-bearing reads** — `comparison_mode` in
  `page.tsx` + `TripCard.tsx` (and written on trip create); `itinerary_enabled`
  in `HomeTab.tsx` → `ItineraryPanel`. Dropping either breaks the app.
- `merge_guest_to_real_user(text, text)` was flagged "broken / removable" but is
  the **live signup conversion path**, called by the `handle_new_user` signup
  trigger. Dropping it breaks every invited-user signup. (Nothing replaced it —
  it *is* the mechanism; it was fixed, not removed.)

Never drop a column or function without confirming **zero live reads in code**
AND that **nothing in the DB depends on it** (triggers, functions, views, FKs,
RLS policies, default expressions). When in doubt, comment it out / stop and
flag — don't drop.

## ID Type Convention

All primary keys and foreign keys use **`text`**, not `uuid`. This is app-wide —
`users.id`, `trips.id`, `circles.id` are all `text`. Any new FK column
referencing these tables **must be `text`**; a `uuid` FK → `text` PK errors at
migration time (type mismatch). This `text`-id choice is also why `public.users`
has no FK to `auth.users` (uuid) and why user-delete cleanup is a trigger, not a
cascade — see the auth section.

`circle_events` and `circle_courses` (migration 024) are intentionally **thin
anchor stubs** — `id, circle_id, name, created_at` only. Their full columns
(e.g. `thread_id`, `year`, `recap_text`, `video_url`) are deferred to the
competition/history build, when the real shapes are known. When those land,
`thread_id` and every other FK column must be `text` (e.g.
`thread_id text REFERENCES trips(id)`), per the rule above — never `uuid`.

**Course data is global, NOT circle-scoped** (revised in Slice C part 2). A
course's par, stroke index, and per-tee yards are global facts (Pebble Creek's
index is the same for everyone), so they live in a standalone global **`courses`**
table (migration 039) reached via **`CourseService`** (`src/lib/courseService.ts`)
— *not* `circle_courses`, and *not* the dead `golf_course_details` (archived only).
`circle_courses` stays the thin stub, now reserved for a later **Circle-Era join**
(`circle_id` → `course_id` into the global `courses`), never the course-data home.
Applying a course to a game **snapshots** its `par[]` + `handicap_index[]` into
`games.scorecard_schema.units.metadata` (the shape `strokeHoles` reads); the
snapshot freezes once scores exist, and `games.course_id` is kept as provenance.

## What "Done" Means for Any Task

1. Feature implemented
2. Tests written and passing
3. Committed with a clear message
4. No TypeScript errors (`npx tsc --noEmit` passes)
5. No console errors in the browser

## Local Dev Troubleshooting

**Confirm the working directory and branch of a dev server before trusting the
browser** — verify it's up to date with `origin`. An observation from the wrong
tree is worse than no observation: it already cost one long debugging session.

**Stale `.next` / Turbopack cache replays phantom parse errors — `rm -rf .next` and
restart the dev server.** After a heavy edit session on a large component (e.g.
`MatchGameView.tsx`), the dev server can surface persistent syntax/parse errors whose
line numbers are OFF (usually off-by-one, or pointing at code you already changed) while
`npx tsc --noEmit` and `eslint` are both CLEAN. That mismatch — the compiler is happy but
the dev overlay isn't — is the tell that the Turbopack/`.next` cache is stale, NOT that
your code is broken. Fix: stop the dev server, `rm -rf .next`, start it again. This has
recurred every heavy-edit session; treat it as a known cache-staleness quirk, not a real
error to chase. (Trust `tsc`/`eslint` over the dev overlay when they disagree.)

**The INVERSE symptom, same cause: the DOM is missing something you just added.** The
entry above covers phantom errors for code you already changed; this is the other
direction — you add an element, prop, or attribute, reload, and the page renders the
OLD behaviour with no error anywhere. `tsc` and `eslint` are clean, the file on disk is
correct, and the running page simply predates your edit. **Suspect the bundle before
the logic**, and prove it in one step: add a throwaway `data-*` attribute and look for
it in the DOM. If it isn't there, nothing about your logic is being tested — stop the
dev server, `rm -rf .next`, restart. This has now cost two debugging detours in a single
session (both times the tell was available immediately), which is why it's written down:
the instinct is to re-read your own logic, and the logic is fine.

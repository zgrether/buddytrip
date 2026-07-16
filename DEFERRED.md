# BBMI — Deferred Work

*Only genuinely open items. Ordered by when they need to happen.*
*Competition/gaming design detail lives in `COMPETITION_ENGINE.md` — this file
is the build backlog that points to it.*
*Last updated: 2026-07-11 (doc reconciliation pass)*

> Beta is effectively launched (bbmi.app live, wired up, not yet announced).
> Real users for the next ~3 months are the golf crew + occasional testers
> (e.g. Julie). "Before Launch" is closed. URL slugs + polling-data bugs are
> in-flight, not tracked here.

---

## Active — Competition & Gaming Engine

**Shipped: Slices A, B, D — end to end.** Design doc: `COMPETITION_ENGINE.md`.
Built **vertically** — one format fully working end-to-end, then widened — not
horizontally.

**Slice 0 (decisions, no code)** — resolved in `COMPETITION_ENGINE.md` (decisions
log): sides→`play_groups`, entry-vs-result separation, `game_matches`, universal
`game_results`, no conversion, drop `starting_score`, moving-tees-as-modifier,
Quick Game local storage, BBMI 2026 = two-team match play.

**Slice A — Stroke-entry spine.** Shipped: `games`/`game_participants`/
`score_entries`/`game_results` tables, the StandardGrid renderer, `stroke_total`
result computation, game completion flow, Quick Game ⚡.

**Slice B — Match play.** Shipped: `game_matches` + `match_play` result strategy,
the match-play strip over the grid (per-hole result, running "2 UP"/"3&2"),
multi-match cards, singles (1v1) and doubles (2v2).

**Slice D — Competition bolt-on.** Shipped: competition creation persists teams +
`team_assignments`; the Tier 1 competition leaderboard reads `game_results` ⨝
`games`; run/post/lock + score-correction model (`games.post`/`openCorrection`).
Competition close → `circle_events` entry is unconfirmed/likely still open —
verify before closing it out too.

### Leaderboard live-game projected-points pill (deferred — needs new server computation) — #576

*Captured 2026-07-11 during the leaderboard-grid pass (Phase 0 STOP condition).
The completed-game score grid (team columns, short-name header, winner chip)
shipped for match_play; the live-game "▲ projected points" pill from the same
spec did not — this is that gap, logged so it isn't lost.*

A per-game, per-team live projection already exists (`src/lib/gameProjection.ts`
`rollupMatchPlay`, `computeRack("projected", ...)`), but it's computed
**client-side, inside each individual game page**, from that page's own
already-fetched live scoring state (`GamePageHeader`'s `ProjectionRow`). It has
never been wired to the board. The board's server compute,
`computeCompetitionLeaderboard`, does not fetch live scores/matches for
in-progress games at all — only final `game_results` (populated on completion)
and a boolean "started" flag.

**To build this:** either (a) extend `computeCompetitionLeaderboard` to fetch
each live game's raw scores/matches and run the existing pure rollup functions
server-side, or (b) have the board client fire additional per-game queries for
just the LIVE-section games and compute client-side (reusing
`gameProjection.ts` as-is, no server change, but N extra queries + new poll
wiring — the board polls its own 30s interval, separate from `useConfigSync`'s
20s game-page interval). Until this lands, LIVE rows show today's existing
treatment (subtitle "Underway · scoring", `N PTS` outer column) rather than a
pill promising data that isn't there.

**Points cups already have the games×teams grid** — `PointsMatrix.tsx` (the
collapsible "Game by game" audit table below the standings glance) already
implements the same team-columns-per-game concept for points competitions.
The completed-grid work above deliberately did not duplicate it — only
match_play (which had no aligned-column treatment at all) got the new grid.

### Slice C — remaining formats (narrowed — most of this shipped)

Shipped: **Rack-n-stack** (`gtt_rack_n_stack`, `user_holes` entry, positional
result), the **GolfCard** renderer (par/handicap/± + course header, referenced
across `StandardGrid.tsx`/`golfScore.ts`/`handicap.ts`), and the **global course
picker** — reached via `CourseService` against the standalone global `courses`
table (migration 039), **not** `circle_courses` (that stays a thin unused stub,
reserved for a later Circle-era join; see CLAUDE.md's "ID Type Convention"
section).

Still genuinely open (no `gtt_*` id exists for either — confirmed against
`src/lib/gameTypes.ts`, which only defines stroke play, match play (singles/
doubles), rack-n-stack, and the generic/manual formats):

- **Foursomes / alt-shot** — `group_holes` entry (one ball per `play_group`),
  `match_play`
- **Four-ball** — `group_holes` entry, `match_play` (BBMI records one score per
  side, same shape as alt-shot); auto-best-ball compute deferred as optional

### Slice E — Games tab + scheduling (not blocking September)

- Games tab on the trip tab bar (no schedule required to add a game)
- Add-game wizard, **data-driven off `game_type_templates` flags**
  (`requires_sides`, `compatible_modifiers`, etc.) — the per-format branching
  lives in template config, not UI code
- Rename Agenda's "Competition Events" panel → "Games" (same drag-drop)
- Optional schedule/date + itinerary surfacing; Agenda ↔ game link

### Slice F — Modifiers (not blocking September)

- Glorious finishing holes — **point-valued formats only (skins, match play)**;
  multiplies hole value, not raw strokes
- Buddy Rules (highlight + auto-apply modes)
- `rules_for_today` → auto-post to Notes on game start
- Per-game config (`games.config`) — custom Stableford rubric and other
  within-format standards; template `config_schema` declares tunable keys
- Moving tee boxes — available to any stroke-input scorecard; pop-up +
  per-cell visual cue; `tee_box_change` `game_live_events` (no September format requires it)
  - **Tee-subset selection** (sub-note, captured 2026-06-20 during the
    golfcourseapi build): when moving tees is on, the owner/delegate picks WHICH
    of the course's stored tee sets rotate. Cannot be worked independently of
    moving tees — it's a configuration knob on this feature. All tee sets are
    already persisted (`courses.tee_sets`, mig 059), so the data is ready.

- **Reconcile modifier applicability to REAL (not testability) when this engine is
  built** (captured 2026-06-26, W-GAMEPAGE-01 Modifiers / #469). The config-only
  Modifiers panel shipped, but `gameTypes.ts` `compatibleModifiers` currently holds
  a **crossed test-matrix** (each golf format offers one render branch: rack=none /
  singles=`moving_tees` / doubles=`glorious_holes` / stroke=both) **flagged loudly
  in-file as NOT real applicability**. Real applicability differs: `glorious_holes`
  is point-valued/match formats only (it doubles a hole's *match* value, so it does
  NOT apply to raw stroke play); `moving_tees` is any stroke-input scorecard. When
  the scoring engine lands, set the real sets.
- **Generalize the per-modifier config (moving-scale)**: the shipped registry
  (`lib/modifiers.ts`) is presence-model with a per-key jsonb config — `glorious_holes`
  already carries a `{ holes: N }` param. Moving tees' tee-subset selection (sub-note
  above) is the next parameterized modifier; generalize `controlType` + the read/write
  helpers rather than special-casing each. (Spec note: "moving-tees moving-scale
  generalization.")

### Glorious Finishing Holes — known limitations (logged, not bugs)

*Captured this pass, from the PR 569/571 build.*

- **`18−N` round-length inertia.** The last-N-holes-worth-2× weighting
  (`holeWeight`/`remainingSwing` in `src/lib/gloriousHoles.ts`) is derived from
  hole number against the round's total hole count. On a round shorter than 18
  holes, if `N` ≥ the round length the modifier has nothing left to weight and
  reads as inert — deliberate (derived, not a special-cased error state), not a
  bug. No action needed; just not obvious from the UI alone.
- **Design note — why glorious is the one modifier safe to flip mid-scoring.**
  Issue #501 freezes modifier config once a competition goes live (mid-match
  config changes are usually unsafe — they'd retroactively rewrite an
  in-progress result). Glorious Finishing Holes is the deliberate exception: its
  weight is computed at read-time from the current hole/config
  (`holeWeight`/`remainingSwing`), never snapshotted onto a stored hole result,
  so flipping it or changing `N` mid-round just changes what the next compute
  returns — nothing to migrate, nothing stale to reconcile. That's what makes it
  architecturally safe to expose as a live Setup toggle even under the #501
  freeze, where every other modifier stays locked. See CLAUDE.md's "modifier
  config persistence" gotcha for the adjacent (and unrelated) collapse-persist
  behavior this is easy to conflate with.

### Per-setting freeze redesign — coming; do NOT harden the current freeze (Zach, blocking P2)

The current live-game freeze is COARSE: `settingsEditable = canEdit && !scoringEnabled`
locks the whole settings spine, with a hand-picked carve-out (name / delegate / rules,
via migration 083). A **per-setting freeze redesign is coming that changes the model** —
which settings are editable mid-round becomes a per-field decision, not one flag.

**Constraint for P2 (rack/stroke/non-golf onto draft-then-save):** do NOT replicate the
current coarse freeze into the three remaining formats, and do NOT treat
`entry_mode`/points as a "one-line loosen." They stay frozen because that's PART OF the
redesign, not an oversight — `entry_mode` orphans entered data if switched mid-round,
points shift standings. Converting the formats should carry the draft-then-save
plumbing but leave the freeze model as-is (or minimal) so the redesign has one place to
land, not four hardened copies.

### Game Settings draft-then-save — accepted divergences (logged, not bugs)

*Captured from the P1 flip. These are DELIBERATE. Each looks like a defect from one
angle, and "fixing" any of them re-opens something worse — the reasoning is here so
that case doesn't have to be re-derived from scratch.*

- **`save_game_config`'s lost-update window is accepted, not closed.** The
  optimistic-concurrency `baseHash` is validated in the tRPC front door, OUTSIDE the
  RPC's `FOR UPDATE` lock, so a true lost update — A checks, B checks, A writes, B
  clobbers — stays reachable in the sub-100ms gap. `FOR UPDATE` only removes the
  RPC-vs-RPC interleave. Human-timescale collisions (two people editing settings
  seconds apart) ARE caught. Closing it properly needs a stored version column bumped
  under the lock, which every other write path would then have to maintain and which
  false-rejects when stale. Documented in the migration itself; don't "tighten" the
  lock without reading that note.
- **The outbox `base` and Save's `baseHash` MUST stay ONE value.** Both read the
  single `serverHash` binding off `games.configHash`, frozen on the same
  `anyTouched` transition. They answer two halves of one question — recover-vs-discard
  and conflict-vs-allow — and keying them off different fingerprints makes them
  disagree about what the base was. This shipped wrong once: the outbox was keyed on a
  MATCHES fingerprint, so a remote COURSE change left it equal, the outbox restored,
  the baseline re-seeded to the newer server at mount, Save's check passed, and the
  recovered draft silently overwrote the other device. **The trap that invites the
  wrong fix:** the hash is async, and comparing a stored base against `""` while it
  loads deletes a good outbox entry. Gate on the hash (the outbox's `enabled` requires
  it; the seed effect waits for it) — never re-key the outbox off something
  synchronous.
- **"No handicap" persists as NULL, not 0.** `save_game_config` writes
  `NULLIF(strokes, 0)`, where the old per-row `setHandicap` wrote a literal `0`. Every
  reader normalises via `effectiveStrokes` (`?? 0`), so the two are behaviourally
  identical. Don't "fix" the encoding, and don't assert it in tests — assert the
  meaning (`hcap.get(id) ?? 0`).
- **The Danger zone reads the SERVER's `scoring_enabled` while everything above it
  reads the draft.** That asymmetry is deliberate: reset-scores / reset-settings /
  delete aren't drafted edits, they're immediate irreversible server surgery, so a
  game that is LIVE and being scored on right now must not have its scores wiped
  because someone staged a Setup toggle they never saved. Consequence worth knowing:
  the `HAS_SCORES` refusal points at the Danger zone, so on a live scored game the
  user Saves the disable first, THEN resets, then re-edits. Don't "fix" the asymmetry
  by repointing it at the draft.
- **A disable + a match change on a scored game is refused ATOMICALLY — the disable
  rolls back with it** (migration 082). Correct, not a gap: a disable keeps scores, so
  the `HAS_SCORES` guard fires, and a partial apply would be worse than an honest
  refusal. The old two-step couldn't have done it either — the second Save hit the
  same guard. The user resets the scores, or drops the match edits and saves the
  disable alone.

- **The warned-field recompute runs OUTSIDE the save transaction** (migration 084 /
  the `games.saveConfig` handler). A handicap or point-override edit on a scored game
  writes the field in the RPC, then the tRPC handler calls `computeMatchPlayResults`
  AFTER the RPC returns — because plpgsql can't call the shared JS engine
  (`buildDecided`/`matchState`/glorious) without reimplementing and drifting from it
  (Design A, parity with `matches.setHandicap`/`setPointValue`). Accepted: a crash
  between the field write and the recompute leaves `game_results` briefly stale, but
  it's DERIVED — the next save / finish / corrections edit re-derives, and the live
  client view recomputes from scores regardless. Recoverable, not a lost write.
- **REMOVE THE `matchesDirty` DUAL-READ once the app has shipped** (migration 084).
  084's RPC reads `COALESCE(matchesStructureDirty, matchesDirty, true)` so an old
  client (still emitting the pre-split `matchesDirty` key) keeps working during the
  window between the migration applying (PR-open) and the new app reaching prod. Once
  the app carrying the `matchesStructureDirty` payload is live everywhere, the
  `matchesDirty` fallback is dead and should be dropped in a follow-up migration —
  it's the ONLY thing keeping the retired key alive.

### 2v2 per-individual handicaps

The per-match handicap **side selector** (1v1 match play) assigns strokes to a *side*. In 2v2 best ball
you need to stroke a *specific person* (e.g. just Buddy so he's competitive vs Steve), which the side
selector can't express. **Deferred — not built.** Offline workaround is fine for now (BBMI Saturday is
1v1). Build when 2v2 scoring logic lands. (Visual vocabulary §9 / §14.)

### Desktop side-by-side tee display (someday nomination — not actionable now)

*Captured 2026-06-20 (golfcourseapi build).*

- A round uses one configured tee (snapshotted per game). On **desktop**, the
  same captured per-tee data (`courses.tee_sets`) could render multiple tees
  **side-by-side** rather than the single configured tee — same data, wider
  viewport. Deferred; navigation/desktop-experience adjacent, not launch-blocking.

### Competition-style chooser — style → format → points enforcement

*Before launch (footgun prevention), NOT BBMI-blocking. Captured 2026-06-14,
sharpened by the L2 triage audit.*

**The gap:** a competition has no declared *style*, so nothing constrains which
game formats are valid within it. This is what let rack-n-stack land on the wrong
points path (placement/total) inside a match-play cup — nothing enforced
compatibility.

**The insight:** points shape is **downstream** of competition style, not a
per-game free choice. The correct model is a dependency chain:

> **competition style → constrains valid game formats → format determines points shape**

- **2-team match-play cup (Ryder Cup):** every game must be match-play-friendly and
  produce **per-match points** (singles/doubles match play, rack-n-stack-as-matches,
  alternate-shot-as-match…). "First to 14½."
- **Normal-scoring competition (2 or N teams):** other formats valid; points may be
  placement/total or other shapes.

Today points-distribution is set per-game and independently — the bug's root: you
can put a placement game in a match-play cup.

**What to build:** (1) a competition-style choice at competition creation
(trip-planner / create-flow side — its own design conversation, "can get confusing
depending on presentation"; likely 2-team match-play cup · 2-team normal · N-team
normal); (2) add-game flow filters formats to those compatible with the style;
(3) the model enforces it — points shape derives from format-within-style, no
incompatible combos possible.

**Why deferred (not BBMI-blocking):** BBMI 2026 is a 2-team match-play cup and all
its games are match-play-friendly, so wiring everything to per-match (the
game-running build) makes the real event work without the enforcement layer. The
enforcement matters for *other users* and to prevent the footgun.

**Design conversation needed:** how to present the style choice without confusion
(2-team-match vs 2-team-normal vs N-team is subtle), where it lives in the create
flow, how it interacts with the trip-planner side.

**Effort:** medium-large. Touches competition creation, the add-game flow (format
filtering), and the points model (derive shape from format-within-style). No new
scoring engines — it constrains and routes existing ones.

**Update (2026-06-14) — the add-game format filter is PART of this chooser, not
pulled forward.** The L2 work surfaced that the add-game modal offers all three
built engines (Stroke Play, Alternate Shot, Rack-n-Stack) **unfiltered** — so you
can add a raw Stroke Play game to a match-play cup, where it **won't compute**
(placement/total, not per-match). Filtering the modal to style-compatible formats
is the "add-game flow filters formats" item above — deliberately NOT built as a
separate near-term patch.
- A raw Stroke Play game is **addable but non-computing in a competition** — a
  **known, accepted gap, not a bug** — until the chooser ships.
- Near-term cost is only test confusion, handled by a standing testing instruction
  (test competitions with match-play-friendly formats only; don't add raw stroke to
  a cup). No interim filter built.
- A stray non-computing stroke game already on a board gets removed once
  **delete-game (L3-b)** ships (queued).
- Reaffirmed framing: in a cup the valid formats are the match-play-friendly ones
  (Alternate Shot, Rack-n-Stack — the latter being stroke-play-wrapped-as-matches).
  Raw individual stroke play is a *normal-competition* format. "Stroke play in a
  cup" isn't a separate event to design — in a cup, stroke-the-activity is played
  as Rack-n-Stack.

### Post-BBMI engine work

- `multi_team` competitions (3+ teams, placement points roll-up)
- Bracket tournaments + **BracketRenderer** (single-elim; StandardGrid covers v1)
- Nassau / press / hammer game types; `game_live_events` press/hammer/dots
- `turn_append` entry (darts etc., unknown turn count)
- Chicago format (re-adds `game_participants.starting_score`)
- Full top-20 golf format matrix fill-out (validated against the taxonomy in
  `COMPETITION_ENGINE.md`, built on demand)

### Point value as competition-level weighting (+ defined/weighted readiness split)

*Captured 2026-06-14. Not launch-blocking — the current per-game point value is
functional; this is a model/UX improvement. When: after the competition face
ships and the add-game flow is stable.*

**Today:** a game's point value is set on the add-game flow's **Game tab (tab 1)**
— a per-game field, set when you create the game.

**The insight:** point value isn't really a property of the *game* — it's a
property of the game's *relationship to the other games*. "How much is Day 1
Scramble worth" only has a sensible answer once you know what it's worth
*relative to* Singles, Cornhole, Euchre. It's a **competition-level weighting
decision**, not a game-level fact like name/format/course. You can't sensibly
weight a game until the whole slate of games exists.

**The change:** move point value off the per-game tab and into a
**competition-level "balance the points" step** that shows **all games together**
— "Scramble 8 · Singles 8 · Cornhole 8 · Euchre 4 — 28 in play, feel right?" That's
the decision the owner is actually making (relative weighting), shown where it
makes sense (all games side by side, the balance visible). Much truer than poking
a number into each game's config in isolation.

**The consequence — "ready" splits into two readinesses:**

- **Defined** — per-game, set early, any order: type, format, name, course,
  pairings/handicaps. (Tab 1 + most of tab 2.)
- **Weighted** — competition-level, set late, all games at once: the point balance.

**Go-live requires both:** every game *defined* AND the points *balanced*. The
existing "Cornhole needs points" state becomes a **competition-level "you haven't
balanced the points yet"** rather than a per-game nag — more honest (points aren't
missing on Cornhole specifically; the cup's weighting isn't done).

**Forward-design discipline (cheap insurance, do now even though the build is
deferred):** point-value-on-tab-1 works for now and can stay. But **don't
hard-wire "ready = has points"** as load-bearing logic, in either the build or the
mocks — present/compute readiness so it survives the coming defined/weighted split.
Build nothing yet, but don't build something that *blocks* the split.

**Effort:** medium. Touches the add-game flow (remove point value from tab 1), a
new competition-level balance surface, and the readiness/go-live logic (split
defined vs. weighted). No schema change expected — point value already lives on the
game (`games.points_total`); this is where/when it's *edited* and how readiness is
*computed*.

### Competition header status strip (§2) — owed into Stage 4

*Captured 2026-06-14 during comp-face Stage 3. NOT a general defer — it's
explicitly folded into **Stage 4's scope** so it doesn't evaporate.*

Spec §2 calls for a **content-driven status strip** in the competition header's
lower region: priority ladder of today's lineup ("On tap: Cornhole, Singles") →
standing glance ("Blue 8½ – Red 7½") → **collapses entirely when empty** (no
fixed empty box, quiet not a live ticker). Stage 3 shipped the chrome-shrink
(compact header post-live) but deliberately left the strip out to keep Stage 3
focused on the escape/toggle/go-live. It's small chrome work that belongs with
the header, so it rides along with Stage 4 (roles on the board). The game-page
**live pulse** remains separately deferred (it's the ticker §2 explicitly
excludes).

### Dead-hole display on the result summary — points-board fast-follow

*Captured 2026-06-30 during the PR 2 board rewire (scoring_model axis + N-team
points board). Explicitly scoped OUT of that PR; logged so it isn't lost.*

When **all teams tie a hole** (no team takes it — a "dead hole"), the per-hole
result summary should say so ("Dead hole") rather than rendering an empty/ambiguous
cell. Only meaningful once N-team (3+) points play is exercised on real cards — a
2-team match already reads a tie as a halve. Small display-only change on the
result summary; no scoring/compute change (the points are already 0-to-each). Pick
it up when the N-team points board gets real on-course use.

---

## v2 / Circle Era

The architectural expansion: a Circle is a persistent group of users that owns
threads — trip planners with competition, trip planners without, competitions
only, and standalone games. **Today's hierarchy (trip-with-embedded-competition)
becomes one thread type among several.** Every decision today is made *toward*
this so the migration is painless; nothing here is built pre-launch.

- Circle Home dashboard
- Circle switcher (avatar clusters, long-press)
- Standalone thread types (Competition thread, Game thread) — `circle_id` on
  threads; v2 Quick Game becomes an invisible game-thread under a Circle
- Golf course as a Circle asset; destination ideas at Circle level
- **Circle Library** — courses, destinations, lodging as institutional memory
- **Circle History** — immutable event record; History tab migrates to Circle level
- Circle Stats / Hall of Fame
- Tiered membership UI; thread visibility model
- **Betting layer** — `circle_bets` / `circle_bet_results` / `circle_settlements`;
  social-first, public-by-default, Circle-scoped (per-hole, Nassau, longest-drive,
  sports, custom, skins-money)
- **Apple OAuth** (deprioritized from launch; Supabase-native, low effort)
- **Admin email-template UI** (`/admin/emails`; deprioritized from launch)

---

## Other Post-Launch (non-engine)

### Unify receipt opt-in / opt-out

Today opt-in/out only covers members already *in* a split. A member left off
entirely has no self-service path, and the row renders at full opacity (looks
like you're in it). Combine into one model: in-split → normal + "Opt out";
opted-out → dimmed + "Rejoin"; never-included → dimmed + "Add me" (creates a
split row). Backend: extend `expenses.optOut` (or add `optIn`) to *create* a
split when none exists. **Files:** `ExpensesSection.tsx`, `SplitPanel.tsx`,
`server/routers/expenses.ts`.

### Unified `<Overlay>` primitive

~30 overlays hand-roll the same four concerns (`useScrollLock` /
react-remove-scroll, `useModalBackButton`, backdrop scrim, `createPortal`). A
shared `<Overlay>` that always portals to `document.body` would absorb all four
and immunize every overlay against the `transform`/`filter`/`backdrop-filter`
containing-block bug that already forces AboutModal, FeedbackModal, UserMenu,
and TripSwitcher to portal out of `TopNav`. Keep the hooks as composable
primitives for anchored popovers. Migrate incrementally. Not blocking — every
overlay is correct today.

### Admin interface

No admin tooling; platform actions need the Supabase dashboard. Minimum:
user lookup by email, trip lookup by ID/slug, catalog idea management, basic
audit log. Admin-only `/admin` gated by `users.is_admin`.

### Catalog idea management UI

20 curated golf ideas were seeded via SQL; non-golf ideas need a SQL INSERT.
Build a form at `/admin/catalog`. `catalog_ideas` already has the filter columns
(`categories`, `group_types`, `region`, `trip_length`).

### "Frequently trips with" crew shortcut

Avatar chips on the Crew tab for users who recur across the current user's trips.
**Note:** the prior `useFrequentTripmates` hook + tRPC procedure were deleted in
pre-launch cleanup (never wired to UI). Rebuild from scratch if revived.

### Claude API destination suggestions

TripNew's "put it to a vote" path was designed to call Claude for 3 suggested
destinations. **Note:** the stub route + `lib/ai/suggestDestinations.ts` were
deleted in cleanup. Rebuild from spec. Low effort, nice-to-have.

### Game-panel cold-open fetch (superseded framing — was "Stage B server-render")

*Originally logged 2026-06-16 against the then-current architecture, where
`games/match/new`, `games/new`, `games/rack/new` were separate routes and
entering a game from the leaderboard meant a full client-rendered route mount
with a cold tRPC batch (the 2–3s wait reported on bbmi.app). That architecture
is gone: the persistent board game panel (PR 545–547) replaced the route-mount
model with a client-overlay panel (`?game=` + `history.pushState`) over the
already-warm leaderboard — see CLAUDE.md pattern #12. The original "server-render
the whole game page like `faceBootstrap`" prescription no longer fits: there's
no route to SSR, and the panel is deliberately client-only, warm-cache-seeded.*

**What's still a real, smaller version of the same problem:** the panel's own
`games.getById`/`matches.listByGame`/`scores.listByGame` data is still not in
the faceBootstrap snapshot, so the *first* time a given game's panel opens in a
session it still does a cold tRPC round-trip before it paints (subsequent opens
in the same session are warm from the query cache). Not confirmed whether this
residual cold-open is still perceptible on-device — worth a quick check before
prioritizing. If it is, the fix is scoped smaller than the original Stage B
ask: seed the panel's queries into `faceBootstrap` (or prefetch on
leaderboard-row mount) rather than building a server-component shell for a
route that no longer exists.

### Leaderboard double-compute — collapse via the seed, not the invalidations

*Logged 2026-07-01 as the Phase-0 finding of "Spec 1b" (the invalidation/poll
right-sizing from the data-layer diagnosis). Both tasks were **deferred by
decision** after Phase 0, because the "easy win" premise didn't hold.* The ~15
sites that mutate competition data invalidate BOTH `competitions.faceBootstrap`
AND `competitions.leaderboard`. On a board mount after such a mutation, that's
`computeCompetitionLeaderboard` run **twice** on the server (faceBootstrap
includes it; the standalone `leaderboard` query IS it) for identical data.

**Do NOT "fix" this by dropping the standalone `leaderboard.invalidate`.** The
two invalidations are **not** client-redundant — they feed different consumers:
faceBootstrap → the face *structure* (games/teams/assignments/header); the
standalone `leaderboard` query → the board (`CompetitionLeaderboard`, 30s poll),
`CompetitionHeader`, `GamePageHeader`. The board reads the standalone query, and
`LiveFaceClient` seeds it from `boot.leaderboard` **only-if-absent** (deliberate,
so a warm remount can't clobber fresher poll data). So faceBootstrap invalidation
alone does **not** refresh the board → dropping the leaderboard invalidate
**under-invalidates** (board stale until the 30s poll). This directly extends
CLAUDE.md pattern #10.

**The correct "compute once":** change the *seed* (one home) — re-seed the
board's `competitions.leaderboard` cache from `boot.leaderboard` whenever
faceBootstrap *genuinely refetched* (gate on `dataUpdatedAt` advancing so pure
remounts still don't clobber the poll), then drop the standalone
`leaderboard.invalidate` at the sites (keep faceBootstrap). Touches the
load-bearing structure/state seed seam — a stale-board risk during the event if
mis-done, which is why it's deferred, not shipped. Revisit only if the
double-compute is measurably slow at real event volume (today: 8 cheap queries
on a near-empty DB).

*Poll (the other half of Spec 1b) needs nothing:* `refetchIntervalInBackground`
defaults false (poll pauses on a hidden tab), Settings early-returns (board
unmounts), and game entry is a separate route (board unmounts). The only residual
is the poll running under the add-game/rosters overlays — negligible, left as-is.

### Human-friendly trip URL slugs

`/trips/<uuid>` → `/trips/bbmi-2027`. Add `slug text UNIQUE` to `trips`, generate
from title, backfill, accept slug or ID in route. *(In flight.)*

---

## UX Polish (logged, not urgent)

- **Member setup-surface consolidation (`SetupPlaceholder` vs `MemberNotReady`)** —
  two components render the same member-facing "game is being set up" surface: the
  golf match page uses `MemberNotReady`, everything else uses `SetupPlaceholder`'s
  member path. The game-format-explainer work (2026-07) made both render the same
  shared `MemberSetupView`, so the split is now a thin-wrapper duplication with no
  behavioral difference. Collapse to one entry component (or route the match page
  through `SetupPlaceholder`) and delete the redundant one. Deferred out of the
  explainer PR deliberately (drop-into-both was the pragmatic move; this is the
  cleanup).
- **Field Mode (outdoor scoring)** — larger tap targets + bumped fonts for
  bright sunlight. Relevant once scorecards exist; pairs naturally with Slice C.
- **Trip slug hex suffix** — the slug is `slugify(title)-<6hex>` (e.g.
  `bbmi-2027-a3f9c1`); the random hex tail reads as noise. Aesthetic only, **not
  a perf lever** — the slug resolves once on trip entry, and deep/game URLs use
  the UUID, so `resolveSlug` is skipped on game entry (confirmed 2026-06-16
  while diagnosing slow game entry). If revisited: drop the suffix with a
  collision check, or use a shorter/cleaner code.

---

## Token Migration Debt

Tracked in `STYLE_GUIDE.md` Section 7. Re-audit against current code (several
already fixed). Summary:

- 5 hardcoded `#00d4aa` → `var(--color-bt-accent)`
- 5 hardcoded `#f59e0b` → `var(--color-bt-warning)`
- 3 light-only warning-banner colors → semantic tokens
- 1 `#d1d5db` drag handle → `var(--color-bt-border)`
- 3 `rgba(0,0,0,0.4)` overlays → `var(--color-bt-overlay)`
- 6 `#fff`/white on colored buttons → consider `--color-bt-on-accent`
- 2 conditional title colors → `var(--color-bt-text)`

Fix incrementally; line-by-line locations in STYLE_GUIDE.md Section 7.

---

## Team trades / mid-competition roster moves (durable scoring attribution)

**Parked — not BBMI scope. Captured because it shapes the score-record schema the engine spec depends on.**

Moving a player between teams, or a player leaving mid-competition, must preserve scoring history
correctly. The core rule:

**A score carries two durable references — the person who earned it, and the team it counted for at the
moment it was earned.** Team totals roll up from the **recorded** team on each score, NOT from the
player's *current* team membership re-derived at calculation time.

Why both references, and why durable:
- **Person reference** — a score is a person's contribution; it stays attached to that person across any
  roster change. (A traded player's earned points are theirs; a slot's new occupant does not inherit
  them.)
- **Team reference (at time of scoring)** — scores still belong to a team for rollup; the competition is
  team-vs-team. But the team must be **recorded on the score when entered**, not looked up live. If team
  is re-derived from current membership at calc time (today's model), then:
  - trading a player **retroactively moves their historical points** to the new team (wrong), and
  - swapping a new person into a slot **hands them the departed player's history** (wrong).

So the schema-shaping decision for the engine: **score records must carry both `person` and the
`team` the score counted toward, captured at entry time** (a recorded attribution, not a live derivation).
Team rollup sums by the recorded team; per-person views read by person. This is what makes trades, swaps,
and departures behave correctly without rewriting history.

**Current state leans this way already** — `game_matches` store person/play_group refs (no team_id), and
scoring currently attributes by roster *at read time*. The change is to **capture** the team attribution at
score-entry (or first-score lock) so it stops being a live derivation that roster edits can retroactively
alter. The lock-on-first-score guard (team-identity PR 2) is the near-term protection; durable per-score
team attribution is the full long-term model this entry captures.

**Not built for BBMI** — teams are set and stay set for September, and the lock guard prevents the broken
state. This is the post-launch model for competitions where rosters genuinely change mid-event.

# BBMI — Deferred Work

*Only genuinely open items. Ordered by when they need to happen.*
*Competition/gaming design detail lives in `COMPETITION_ENGINE.md` — this file
is the build backlog that points to it.*
*Last updated: 2026-06-26*

> Beta is effectively launched (bbmi.app live, wired up, not yet announced).
> Real users for the next ~3 months are the golf crew + occasional testers
> (e.g. Julie). "Before Launch" is closed. URL slugs + polling-data bugs are
> in-flight, not tracked here.

---

## Active — Competition & Gaming Engine

**The current focus.** Design doc: `COMPETITION_ENGINE.md`. Built **vertically**
— one format fully working end-to-end, then widen — not horizontally. Each
slice is demoable on its own.

**September critical path = A → B → C → D.** E and F are quality, not blockers.

### Slice 0 — Decisions (no code) ✅ mostly resolved

Resolved in `COMPETITION_ENGINE.md` (decisions log): sides→`play_groups`,
entry-vs-result separation, `game_matches`, universal `game_results`, no
conversion, drop `starting_score`, moving-tees-as-modifier, Quick Game local
storage, BBMI 2026 = two-team match play.

### Slice A — Stroke-entry spine ⭐ critical path

The simplest case, hardened before sides/teams/modifiers complicate it. **Has
standalone value for testers in the lead-up** — a real, usable individual
stroke-play game.

- `games`, `game_participants`, `score_entries`, `game_results` tables
- **StandardGrid** renderer (Tier 3): editable cells, front/back-9 subtotals,
  low-wins direction
- `stroke_total` result computation → `game_results`
- Game completion flow
- **Quick Game ⚡** title-bar button as a context-free entry into this spine
  (local-storage state, "play again / discard" on finish) — not a placeholder

### Slice B — Match play ⭐ critical path

The heart of the event.

- `game_matches` table + `match_play` result strategy (W/H/L → match state →
  points)
- Match-play layer over the grid: per-hole result, running "2 UP" / "3&2" strip
- **One card can carry multiple match strips** (a singles foursome = 2 matches);
  `game_matches` is decoupled from `play_groups`
- **Singles first** (entity = user, 1v1) before pair formats

### Slice C — September's remaining formats ⭐ critical path

- **Foursomes / alt-shot** — `group_holes` entry (one ball per `play_group`),
  `match_play`
- **Four-ball** — `group_holes` entry, `match_play` (BBMI records one score per
  side, same shape as alt-shot); auto-best-ball compute deferred as optional
- **Rack-n-stack** — `user_holes` entry, `positional` result (sort each team's
  totals, compare by index; opponents shift live)
- **GolfCard** renderer (extends StandardGrid): par/handicap/±, color coding,
  course + date header
- **Golf course picker** → `circle_courses` lookup, add-new inline, optional
  tee-time link

### Slice D — Competition bolt-on ⭐ critical path (Ryder Cup needs it)

- Strip the current Competition tab; rebuild bottom-up
- Two-team setup → `competition_teams` + time-stamped `competition_team_members`
- `competition_games` + point distributions (`sides_are_teams=true`)
- **Tier 1 competition leaderboard** — reads `game_results` ⨝ `competition_games`
- Competition close → `circle_events` entry

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

### Desktop side-by-side tee display (someday nomination — not actionable now)

*Captured 2026-06-20 (golfcourseapi build). NOTE: CLAUDE.md references a
`TRACKER.md` "someday pile" that does not exist in the repo — parking this here
in DEFERRED.md until that doc is created or this is promoted.*

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

### Game-page server-render (Stage B pattern, applied to game pages)

*Logged 2026-06-16 as the consistent-architecture follow-on to the
leaderboard→game prefetch fix — the answer if prefetch proves a desktop-only
win.* The game pages (`games/match/new`, `games/new`, `games/rack/new`) are
fully client-rendered: their data (`games.getById` / `matches.listByGame` /
`scores.listByGame` / `games.listOrganizers` / `tripMembers.list`) is **not** in
the faceBootstrap snapshot, so entering a game from the leaderboard fetches cold
only after the route mounts — the 2–3s wait reported on bbmi.app. The build
confirms the JS is largely warm from the leaderboard (shared chunks parsed, the
~11 kB match route chunk prefetched by `<Link>`), so the bottleneck is the cold
tRPC batch + a possible Vercel function cold-start, not parse.

Prefetch-on-intent (shipped) warms that batch on hover / pointerdown — a solid
desktop win, but on touch the pre-navigation window is ~100 ms, so the gain is
partial: it overlaps the fetch with mount, it does **not** remove server time.

The real (mobile) fix is the **Stage B pattern** the competition face already
earned: a server-component shell that resolves the game's data in one bootstrap
round-trip (like `faceBootstrap`) and ships it as `initialData` in the
dehydrated cache, so the board/scorecard render populated in the server HTML —
no client round-trip for first paint. The game page is part of the same
engagement surface (on the course, on a phone); it deserves the same treatment.
Mirror `leaderboard/page.tsx` + `LiveFaceClient` (SSR helpers + `initialData` +
child-cache seeding).

### Human-friendly trip URL slugs

`/trips/<uuid>` → `/trips/bbmi-2027`. Add `slug text UNIQUE` to `trips`, generate
from title, backfill, accept slug or ID in route. *(In flight.)*

---

## UX Polish (logged, not urgent)

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

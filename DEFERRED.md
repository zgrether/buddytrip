# BBMI — Deferred Work

*Only genuinely open items. Ordered by when they need to happen.*
*Competition/gaming design detail lives in `COMPETITION_ENGINE.md` — this file
is the build backlog that points to it.*
*Last updated: 2026-06-08*

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

### Human-friendly trip URL slugs

`/trips/<uuid>` → `/trips/bbmi-2027`. Add `slug text UNIQUE` to `trips`, generate
from title, backfill, accept slug or ID in route. *(In flight.)*

---

## UX Polish (logged, not urgent)

- **Field Mode (outdoor scoring)** — larger tap targets + bumped fonts for
  bright sunlight. Relevant once scorecards exist; pairs naturally with Slice C.

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

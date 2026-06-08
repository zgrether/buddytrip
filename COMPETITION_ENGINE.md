# BBMI — Competition & Gaming Engine

*Authoritative design doc for the games + competition + scoring layer.*
*Data model, format taxonomy, scorecard schema, and resolved decisions.*
*`DEFERRED.md` carries the phased build backlog and points here.*
*Last updated: 2026-06-08*

---

## North Star

Games exist first, independently. **Competition is an optional aggregation
layer bolted on top of games** — never the other way around. The trip-planning
layer handles logistics; this engine handles scoring; in v2 the Circle owns it
all. Build toward Circles, but nothing here requires them to ship.

---

## The One Principle Everything Hangs On

**How a score is *entered* is independent of how entries *become points*.**
These are two orthogonal axes:

- **Entry schema** — what a scorer physically types. Per-user per-hole strokes,
  one ball for a pair, a final winner, a Yahtzee category. This is the
  **scorecard** (Tier 3 below).
- **Result strategy** — how raw entries are distilled into placement and points.
  Stroke total, Stableford, skins carry, match play, best-ball-then-match,
  positional (rack-n-stack), best-of-N, winner-only.

Singles and a plain stroke-play round **share the same entry schema** (per-user
per-hole strokes) and differ *only* in result strategy (match play vs stroke
total). Most golf formats we want to support are recombinations of ~3 entry
schemas × ~7 result strategies. Get this separation right and adding a format
later is a config row plus a result function — not a UI rewrite.

A **third** axis sits beside these: **configuration** — the tunable parameters
of a format where a real-world standard varies (see "Game Configuration").

> This is the same "scoring format definitions should be data-driven, not
> hardcoded" principle already in the project — applied to the *workflow*, the
> *result computation*, and the *rule parameters*, not just the labels.

---

## Three Rendering Tiers

Carried forward from the prototype's structure. Each tier reads different tables.

| Tier | What it shows | Scope | Reads | Varies by |
|------|---------------|-------|-------|-----------|
| **1 — Competition leaderboard** | Cumulative team points across all games | Whole competition | `game_results` ⨝ `competition_games` | Competition format |
| **2 — Game leaderboard** | Live results of every group/match in one game | One game | `game_matches` (match formats) or live `score_entries` → distilled (stroke formats) | Game format |
| **3 — Scorecard** | Actual score entry | One physical card (a `play_group`) | reads + writes `score_entries` | Entry schema |

Tier 1 exists only when a competition exists. Tier 2 is the main access point
into a single game. Tier 3 is where numbers get typed.

---

## Terminology

| Term | Meaning |
|------|---------|
| **Circle** (v2) | Persistent social group of users. Owns everything below. |
| **Thread** (v2) | Anything a Circle does together. |
| **Trip thread** | Logistics + optional embedded competition (today's whole app). |
| **Competition thread** (v2) | Scoring only, no trip scaffolding. |
| **Game thread** (v2) | A single standalone game, scorecard only. |
| **Game** | One event with one scoring model. Standalone or inside a competition. |
| **Competition** | Thin wrapper that aggregates games into team standings. |
| **Leaderboard** | Results *across* games (Tier 1) or across groups in a game (Tier 2). |
| **Scorecard** | Score entry for one physical card (Tier 3). Format-specific. |
| **Sides** | Game-level temporary grouping (cornhole 2v2, alt-shot pairs). Stored as `play_groups`. Die with the game. |
| **Teams** | Competition-level persistent grouping. Players represent a team in *every* game. |
| **Play group** | The physical scorecard grouping — who shares one card / one ball. Logistics. |
| **Buddy Rules** | Per-player handicap/stroke-adjustment system (a modifier). |
| **Modifier** | A flag layered over a game type that tweaks UI, instructions, and scoring without changing the fundamental format. |
| **Config** | Tunable parameters *of* a format (e.g. the Stableford point rubric). Not a modifier. |

---

## Play Groups, Sides, and Teams (resolved)

A `play_group` is the **physical scorecard grouping** — but what it contains
depends on whether the format uses one ball per player or one ball per side:

- **Individual-ball formats** (singles, stroke, Stableford, rack-n-stack):
  `play_group` = the **foursome / physical card** (2–4 players, each their own
  ball). Entries are **per user**.
- **Shared-ball / sided formats** (alt-shot foursomes, **BBMI four-ball**,
  scramble, cornhole and any `requires_sides` type): `play_group` = the **side
  that shares the recorded score** (a pair, a scramble team, a cornhole side).
  Entries are **per play_group**. BBMI records one score per side per hole — see
  the four-ball note below — so four-ball and alt-shot are the same shape here.

When are `play_groups` created at all?
- **Standalone golf** (Quick Game / Games tab, individual ball): **no
  play_groups** — flat `game_participants`, one card.
- **Competition foursomes**: the commissioner assigns who walks together.
- **`requires_sides` games**: the side *is* the scoring unit.

**Teams** exist only inside a competition. A player can be in Foursome 1 (walks
with Brad) **and** on Team A (scores for Team A) simultaneously and
independently.

---

## One Card, Multiple Matches (the singles catch)

A BBMI singles foursome is 4 players but **two** 1v1 matches (A1 v B1, A2 v B2)
— and historically both live on **one** physical scorecard. So:

- **`game_matches` is decoupled from `play_groups`.** A single physical card (one
  `play_group`) can host **multiple matches**. We do **not** need "multiple
  scorecards per foursome" — one card renders multiple match strips.
- **Singles:** play_group = foursome of 4, `game_participants` per user, **two**
  `game_matches` both anchored to that play_group. The card shows 4 stroke
  columns + 2 running match strips.
- **Four-ball (BBMI):** recorded as **one score per side per hole** — same as
  alt-shot — because a partner has usually picked up by the time it matters. So
  play_group = the pair (the side), entries per play_group, one match between the
  two pairs. *(The textbook variant — each player holes out, app auto-takes the
  better ball — is `best_ball_match`; deferred as optional, not how BBMI plays it.)*
- **Alt-shot:** play_group = the **pair** (shares one ball), entries per
  play_group, one match between the two pairs; the card is derived from the two
  play_groups named in the match.

---

## Match Play Needs a Pairings Table

The handoff's `scorecard_schema` was stroke-aggregation-shaped (`low_wins`,
`sum`). Match play is **not** an aggregation — it's a head-to-head comparison
producing a match state ("2 UP", closed out "3&2") and then points. Three of
BBMI's four formats are assigned pairings, and there was nowhere to store who
plays whom. New table:

```
game_matches
├── id text PRIMARY KEY
├── game_id text REFERENCES games(id)
├── play_group_id text REFERENCES play_groups(id)
│   -- the physical card a match is scored on (singles: shared by both matches;
│   --  four-ball: the foursome). null when the card is derived from the sides
│   --  (alt-shot) or there is no fixed pairing (rack-n-stack).
├── match_number integer
├── side_a jsonb
│   -- {"type":"user","id":"u1"}  | {"type":"play_group","id":"pg1"}
│   -- (alt-shot and BBMI four-ball both use a play_group side)
│   -- | {"type":"pair","members":["u1","u2"]}  only for optional auto best-ball
├── side_b jsonb
├── result text                           -- 'a_win'|'b_win'|'halve'|null (in progress)
├── margin text                           -- "3&2" | "2 UP" | null
├── points_a decimal
├── points_b decimal
└── status text DEFAULT 'pending'         -- pending|active|complete
```

- **Assigned** up front for singles / foursomes / four-ball (commish sets pairings).
- **Computed** at result time for rack-n-stack — sort each team's totals, compare
  by index, write one row per position. The shifting "who am I playing" during
  the round is the live Tier-2 view, derived from `score_entries`.
- Tier 2 reads `game_matches` for match formats; distilled points flow to
  `game_results`, which Tier 1 reads. **`game_results` stays the single
  universal read-model regardless of format.**

---

## Game Configuration (within-format standards)

Distinct from modifiers and from Buddy Rules: where a format has a real-world
standard that *varies by group*, we expose it as tunable config. The canonical
case is **Stableford** — standard PGA points assume scratch-ish play, but our
field shoots 80–130, so we award points on our own rubric.

Stableford behaves like handicap: **you enter the raw score and the app pushes
out a value, and it sits *after* the handicap step.** Get a handicap stroke on a
par 4 and card a raw 4 → net 3 (net birdie) → the rubric converts *that* to
points. So the rubric is keyed on **net result vs par**, not raw, and the result
function reads net (see "Computation Pipeline").

- The **template** (`game_type_templates`) defines the default config and which
  keys are tunable.
- **Per-game overrides** live in `games.config jsonb`.

```json
// games.config for a custom Stableford game — keyed on NET result vs par
{
  "stableford_rubric": {
    "net_double_bogey_or_worse": 1,
    "net_bogey": 2,
    "net_par": 3,
    "net_birdie": 4,
    "net_eagle_or_better": 5
  }
}
```

(Exact point values are the crew's to set — the structure is a per-net-result-vs-par
table.) Other config candidates: best-of count for `best_of` games, concession
rules for match play, section bonuses. Keep config to *parameters of a standard*
— anything that changes the fundamental format is a different game type, and
anything orthogonal layered on top is a modifier.

---

## Computation Pipeline (order of operations)

Scoring is **not** a single step. Raw entries pass through an ordered pipeline
before a result strategy ever runs, and getting the order wrong is the easiest
silent bug in the whole engine:

```
score_entries.value (RAW gross)       -- the truth from the course; never overwritten.
                                       --   Penalty strokes are part of the gross — there is
                                       --   NO separate stroke-adding "entry modifier" layer.
  → − handicap          (Buddy Rules auto-apply: subtract strokes per hole,
                          allocated by the hole's handicap_index → NET)
  → result strategy     (stroke_total / stableford rubric / match_play / ... on NET,
                          or on raw gross when no handicap is in play)
  → game_results / game_matches
```

Key consequences:
- **`score_entries.value` is always raw gross.** Net is *derived* in the pipeline
  from raw + `games.modifiers.buddy_rules`, never stored as the source of truth
  (cache it for display if useful, but raw is canonical).
- **Sabotage is plain stroke play** (`stroke_total`) with a themed UI and rules
  explainer. It takes handicap exactly like stroke play and adds **no** scoring
  layer — do not special-case it in the pipeline.
- **Stableford reads net**, so its `game_results.raw_score` is *computed points*,
  not strokes. The rubric maps net-result-vs-par → points.
- **Net applies to match play too** — net match play compares net scores per hole.
- **Buddy Rules has two modes:** *highlight* (display only, pipeline unchanged)
  vs *auto-apply* (actually produces the net the result strategy consumes).
- Handicap stroke **allocation** uses `units.metadata.handicap_index` (stroke
  index per hole) against each player's Buddy-Rules stroke count.

---

## Competition Formats

| Format | Shape | Result | BBMI use |
|--------|-------|--------|----------|
| `free_for_all` | Every player is their own team | Individual placement | Rare |
| `two_team` | Exactly 2 teams (Ryder Cup) | Match points: win=1, halve=0.5, loss=0; `sides_are_teams=true` | **BBMI 2026** |
| `multi_team` | 3+ teams | Per-game placement points roll up to team totals | Post-BBMI |

**BBMI 2026 is `two_team`** — 2 teams of 8, every game a match-play format.

---

## Format Taxonomy — Entry Schema × Result Strategy

Proves the model holds for the formats we know. **Filling out the full top-20 is
a backlog task — do not build them all.** This validates the schema; it does not
schedule anything.

### Entry schemas

| Key | Entry | Used by |
|-----|-------|---------|
| `user_holes` | Per-user, per-hole strokes | stroke play, Stableford, singles, four-ball, rack-n-stack |
| `group_holes` | One ball per side, per hole | scramble, alternate shot (foursomes) |
| `winner_only` | Pick the winner at the end | most bar/yard games (v1 floor) |
| `turn_append` | Append-as-you-go turns, unknown count | darts, cribbage (v1 optional) |
| `categories` | Fixed category slots | Yahtzee |

### Result strategies

| Key | How entries become points |
|-----|---------------------------|
| `stroke_total` | Sum strokes, low wins |
| `stableford` | Per-hole points vs par (rubric from `config`), high wins |
| `skins` | Per-hole pot with carry on halve |
| `match_play` | Hole-by-hole W/H/L between two sides → match state → match points |
| `best_ball_match` | *(optional/future)* Each player holes out, app auto-takes the better ball per hole, then match play. **BBMI records one score per side instead** (`group_holes` + `match_play`), so this isn't on the build path |
| `positional` | Sort each team's totals, compare by index (rack-n-stack) |
| `best_of` | Play a series of legs/games; side that wins X of Y takes it |
| `winner_only` | Recorded winner takes the points |

`best_of` covers the popular non-golf "best 3 of 5" pattern. If the crew would
rather keep score in their heads and just record the winner, that's `winner_only`
— both are first-class, neither forces phones-out scoring.

### The formats we actually know

| Format | Entry | Result | Assigned pairing? |
|--------|-------|--------|-------------------|
| Stroke play *(Slice A — build first)* | `user_holes` | `stroke_total` | No |
| Stableford | `user_holes` | `stableford` (config rubric) | No |
| Skins | `user_holes` | `skins` | No |
| **Singles (BBMI)** | `user_holes` | `match_play` | **Yes — 1v1, 2 per foursome card** |
| **Foursomes / alt-shot (BBMI)** | `group_holes` | `match_play` | **Yes — 2v2** |
| **Four-ball (BBMI)** | `group_holes` | `match_play` | **Yes — 2v2 (one score per side, like alt-shot)** |
| **Rack-n-stack (BBMI)** | `user_holes` | `positional` | **No — computed** |
| Scramble | `group_holes` | `stroke_total` | No |
| Sabotage | `user_holes` | `stroke_total` | No — plain stroke play + handicap; themed UI only |
| Cornhole | `group_holes` (sides) | `winner_only` / `best_of` | within-game |
| Yahtzee | `categories` | target/high | No |

**Rack-n-stack is the format that justifies the whole separation.** It enters
identically to ordinary stroke play (`user_holes`) but its result strategy sorts
each team's running totals and compares position-by-position — so a player's
"opponent" shifts hole to hole and is never assigned. The entry layer doesn't
know or care.

---

## Core Data Model (v1 / BBMI 2026)

```
-- Games: standalone (Games tab) or inside a competition
games
├── id text PRIMARY KEY
├── trip_id text REFERENCES trips(id)         -- nullable for v2; v1 always set
├── competition_id text REFERENCES competitions(id) -- null = standalone Games-tab game
├── game_type_id text REFERENCES game_type_templates(id)
├── name text
├── status text DEFAULT 'pending'             -- pending|active|complete
├── course_id text REFERENCES circle_courses(id) -- golf only, nullable
├── config jsonb DEFAULT '{}'                  -- tunable format params (e.g. stableford_rubric)
├── modifiers jsonb DEFAULT '{}'               -- orthogonal layers (glorious, buddy rules, tees)
├── rules_for_today text                       -- auto-posts to Notes on start
├── scheduled_at timestamptz                   -- nullable; set = shows in itinerary
└── created_at timestamptz DEFAULT now()

-- Flat participant list. play_group_id / team_id populated only in context.
game_participants
├── id text PRIMARY KEY
├── game_id text REFERENCES games(id)
├── user_id text REFERENCES users(id)
├── play_group_id text REFERENCES play_groups(id)   -- null for standalone individual-ball golf
├── team_id text REFERENCES competition_teams(id)   -- null for standalone games
└── created_at timestamptz DEFAULT now()
  -- (starting_score / Chicago dropped from v1 — additive migration when Chicago lands)

-- Physical card grouping (foursome) OR shared-ball side. Not created for standalone individual golf.
play_groups
├── id text PRIMARY KEY
├── game_id text REFERENCES games(id)
├── display_name text                          -- "Foursome 1" | "Brad / Zach"
└── created_at timestamptz DEFAULT now()

-- The atomic entry. Written by the scorecard (Tier 3).
score_entries
├── id text PRIMARY KEY
├── game_id text REFERENCES games(id)
├── participant_id text                        -- WHOSE score: user_id OR play_group_id (subject)
├── participant_type text                      -- 'user' | 'play_group'
├── unit_label text                            -- "1".."18" | "ones" | turn index
├── value integer
├── annotations jsonb DEFAULT '{}'            -- optional per-hole flags, e.g. {"sand_save": true}
│                                              --   display/metadata only — NOT a scoring input
├── submitted_by text REFERENCES users(id)     -- WHO TYPED IT — audit only, not a gate
├── submitted_at timestamptz
└── UNIQUE(game_id, participant_id, unit_label)

-- Head-to-head outcomes for match formats (assigned or computed). See above.
game_matches  (see dedicated section)

-- Distilled output. The ONLY thing the competition leaderboard reads. Every
-- game produces these rows regardless of format.
game_results
├── id text PRIMARY KEY
├── game_id text REFERENCES games(id)
├── entity_id text                             -- user_id | team_id | play_group_id
├── entity_type text                           -- 'user' | 'team' | 'play_group'
├── raw_score integer                          -- nullable (match play has none)
├── position integer                           -- placement; nullable
├── competition_points_earned decimal          -- null for standalone games
└── computed_at timestamptz DEFAULT now()

-- Competition: thin bolt-on wrapper
competitions
├── id text PRIMARY KEY
├── trip_id text REFERENCES trips(id)          -- nullable (v2 standalone)
├── name text
├── format text                                -- 'free_for_all'|'two_team'|'multi_team'
├── status text DEFAULT 'active'
└── created_at timestamptz DEFAULT now()

competition_teams
├── id text PRIMARY KEY
├── competition_id text REFERENCES competitions(id)
├── name text
├── color text
└── created_at timestamptz DEFAULT now()

-- Time-stamped membership so mid-competition trades don't rewrite history
competition_team_members
├── id text PRIMARY KEY
├── competition_id text REFERENCES competitions(id)
├── team_id text REFERENCES competition_teams(id)
├── user_id text REFERENCES users(id)
├── joined_at timestamptz DEFAULT now()
└── departed_at timestamptz                    -- nullable; set if traded

-- Which games count + their point values
competition_games
├── id text PRIMARY KEY
├── competition_id text REFERENCES competitions(id)
├── game_id text REFERENCES games(id)
├── points_distribution jsonb NOT NULL
│   -- {"win":1,"halve":0.5,"loss":0} or {"1":10,"2":7,"3":4,"4":2}
├── sides_are_teams boolean DEFAULT false      -- true for 2-team Ryder Cup
└── display_order integer DEFAULT 0
```

### Three IDs, three jobs — not duplicates

- `score_entries.participant_id` = **whose** score it is (the subject — a user,
  or a play_group for shared-ball formats).
- `score_entries.submitted_by` = **who typed** it. **Audit/informational only —
  never a permission gate.** Any participant in a game/foursome may enter scores
  for anyone in their group; we deliberately do not force everyone phones-out
  for a whole round.
- `game_results.entity_id` = the **result** entity (who placed / earned points:
  user, team, or play_group). In four-ball, entry is per-user but the result
  entity is the pair.

All polymorphic text IDs, no enforceable FK — acceptable under the all-text-ID
convention, named here as a deliberate tradeoff.

---

## Modifiers

Modifiers sit above game types and tweak UI, instructions, and scoring without
changing the fundamental format. Stored in `games.modifiers` jsonb.

| Modifier | What it does | Compatible with |
|----------|--------------|-----------------|
| `glorious_finishing_holes` | Multiplies the **points/value** of the closing holes (make up ground fast) | **point-valued formats only: skins, match play** |
| `moving_tee_boxes` | Per-hole result vs par shifts the next hole's tee box (built-in shifting handicap) | any stroke-input scorecard, incl. scramble |
| `buddy_rules` | Per-player stroke adjustments (highlight or auto-apply) | any golf format |
| `rules_for_today` | Free text; auto-posts to Notes when the game starts | any game |

**Glorious finishing holes (corrected):** it doubles the *value of a hole*, not
a raw stroke count — so it only makes sense where holes already carry point
value (**skins, match play**). It does **not** apply to stroke play, Stableford,
or scramble: you can't meaningfully "double a 5." If we ever want it there (e.g.
"a birdie counts as an eagle"), that's bespoke logic written outside this engine
— explicitly out of scope for now.

**Moving tee boxes:** beyond the `tee_box_change` `game_live_events` pop-up that
announces the shift, the **scorecard cell carries a visual cue** for the tee that
hole is played from (e.g. a colored tee dot / cell treatment). That's a Tier-3
renderer detail, noted here so the scorecard spec accounts for it. The result vs
par for a hole drives the next hole's tee; in scramble it's the team's single
result driving the team's next tee. Slice F — no September format requires it.

---

## Game Type Templates — compatibility flags

`game_type_templates` gains the flags + axes that make the add-game wizard
data-driven (the wizard *reads* these; it does not hardcode per-type branches):

```
game_type_templates (+ columns)
├── entry_schema text                  -- 'user_holes'|'group_holes'|'winner_only'|...
├── result_strategy text               -- 'stroke_total'|'match_play'|'positional'|'best_of'|...
├── supports_free_for_all boolean
├── supports_sides boolean
├── requires_sides boolean
├── max_players_per_side integer
├── compatible_competition_formats text[]
├── compatible_modifiers text[]
├── config_schema jsonb                -- which config keys are tunable + defaults
└── scorecard_schema jsonb
```

> **Currently seeded:** skins, scramble, match play, Stableford — placeholder
> names from our most-played games, not a curated v1 set. Re-seed against this
> taxonomy. BBMI 2026 needs: **singles, foursomes (alt-shot), four-ball
> (best-ball), rack-n-stack.**

---

## `scorecard_schema` jsonb

The template's machine description of one scorecard. `entry` block = entry
schema; `scoring` block = result strategy; `scoring.config` = tunable parameters.

```json
{
  "units": {
    "type": "holes|categories|turns|single",
    "count": 18,
    "ordered": true,
    "labels": ["1","...","18"],
    "metadata": { "par": [4,5,3], "handicap_index": [7,1,15] }
  },
  "entry": {
    "value_type": "integer|decimal|enum|boolean",
    "value_label": "Strokes",
    "min": 1, "max": null,
    "annotations": [{ "key": "sand_save", "type": "boolean", "label": "Sand save (flag only — not scored)" }]
  },
  "scoring": {
    "strategy": "stroke_total|match_play|best_ball_match|positional|stableford|skins|best_of|winner_only",
    "direction": "low_wins|high_wins|target",
    "aggregation": "sum|count|best_of|match|custom",
    "config": { "stableford_rubric": { "par": 3, "birdie": 4 } },
    "sections": [{ "name": "Front 9", "units": ["1","...","9"] }],
    "tiebreaker": "sudden_death|countback|shared|null"
  },
  "participants": {
    "min": 2, "max": 4,
    "participant_type": "individual|team|both",
    "assigned_pairings": false
  },
  "interaction": {
    "model": "simultaneous|turn_based|sequential|realtime",
    "entry_timing": "per_unit|end_of_game|per_section"
  }
}
```

`turn_append` formats set `units.type = "turns"` with no fixed count — the grid
appends columns as turns are entered (v1 optional). `winner_only` sets
`units.type = "single"`.

---

## Scorecard Renderers (Tier 3)

| Renderer | Build | Covers |
|----------|-------|--------|
| **StandardGrid** | First (Slice A) | Rows = participants, cols = units, editable cells, section subtotals, direction indicator, in-cell entry modifiers. Stroke play, Stableford, skins, sabotage, Yahtzee, winner-only, best-of. |
| **GolfCard** (extends StandardGrid) | Slice C | Par row, handicap-index row, +/− row, eagle/birdie/bogey color coding, course + date header, Buddy-Rules highlighted holes, moving-tee cell cue. |
| **Match-play layer** (over GolfCard) | Slice B | Per-hole W/H/L derived from strokes, running match-state strip ("2 UP" / "3&2"). **A card may carry multiple strips** (singles foursome = 2). For foursomes one ball per side. |
| **BracketRenderer** | Post-BBMI | Visual bracket tree. StandardGrid covers v1; defer. |

---

## Standalone Game Lifecycle (resolved)

- **Quick Game** (title-bar ⚡): the no-ceremony "easy button." Pick category →
  type → players → score. **v1: state lives in the browser (local storage) —
  no DB row.** Survives a refresh; "Finish" offers *play again* or discards and
  clears. No trip tie-back, no competition, nothing to migrate. (v2: the prompt
  becomes "log to Circle history?" and a game-thread row is created.)
- **Games-tab game:** belongs to the current **trip** (`trip_id` set,
  `competition_id` null). Optional schedule + Agenda link; scheduled games
  surface in the Home itinerary.
- **No converting standalone → competition.** Build the competition first, then
  add games to it. The old "Enable competition? when 2+ games exist" nudge is
  **cut** — it dangled a path that can't exist.

---

## v2 / Circle Era — designed-toward, not built

The model already leans this way: `trip_id` nullable on `games`/`competitions`,
time-stamped team membership, `game_results` as a portable record. v2 adds
`circle_id` to threads so the chain is Circle → thread → game. **Decision: a v2
Quick Game becomes an invisible game-thread under a Circle (pattern "b").**
Because v1 Quick Games never touch the DB, there is nothing to migrate.

Deferred to v2 / post-BBMI, documented so the model is forward-compatible:

```
game_live_events        -- press|hammer|tee_box_change|dots_awarded
                        -- only tee_box_change is used pre-BBMI (moving tees)
bracket_tournaments     -- single_elim v1; participant_type individual|pairs|teams
bracket_matches
circle_bets             -- social betting layer, Circle-scoped, public-by-default
circle_bet_results
circle_settlements
```

---

## Resolved Decisions Log

1. **Sides live in `play_groups`**, created only for competition foursomes or
   `requires_sides` games. Standalone individual golf is a flat list.
2. **`play_group` = the physical card**: foursome for individual-ball formats,
   the shared-ball side for one-ball/sided formats.
3. **Scoring participant type** is `'user' | 'play_group'` on entries;
   `'user' | 'team' | 'play_group'` on results.
4. **`game_matches` added** (jsonb sides + nullable `play_group_id`) for assigned
   (singles/foursomes/four-ball) and computed (rack-n-stack) outcomes. **One card
   can host multiple matches** (singles = 2) — no multiple-cards-per-foursome.
5. **Entry schema, result strategy, and config are three independent axes.**
6. **`game_results` is the single universal read-model** for Tier 1, every format.
7. **`participant_id` = whose score; `submitted_by` = who typed (audit only).**
   Any group member may enter for the group; entry is never identity-gated.
8. **Game configuration** (`games.config` + template `config_schema`) tunes
   within-format standards — canonical case the custom Stableford rubric.
9. **`best_of` result strategy** added for non-golf "best X of Y"; `winner_only`
   for keep-score-offline.
10. **Glorious finishing holes is point-valued formats only** (skins, match play);
    bespoke logic outside the engine if ever extended to stroke/Stableford.
11. **Moving tee boxes = a modifier for any stroke-input scorecard** with both a
    pop-up and a per-cell visual cue; not scramble-only.
12. **No standalone→competition conversion**; "Enable competition?" nudge cut.
13. **`starting_score` / Chicago dropped from v1** — additive migration later.
14. **Quick Game persists in local storage only** in v1; no DB row.
15. **BBMI 2026 is `two_team` Ryder Cup**, all match play: singles, foursomes
    (alt-shot), four-ball, rack-n-stack.
16. **Scoring is an ordered pipeline:** raw gross → handicap (net) → result
    strategy. `score_entries.value` is always raw; net is derived. There is **no
    separate entry-modifier stroke layer** — penalty strokes are part of the gross.
17. **Stableford operates on net result-vs-par** (sits after handicap, like a
    second handicap-style conversion); its `raw_score` is computed points.
18. **BBMI four-ball is recorded as one score per side** (`group_holes` +
    `match_play`, identical shape to alt-shot). The auto-best-ball variant
    (`best_ball_match`) is deferred as optional — not how the crew plays it.
19. **Sabotage is plain stroke play** (`user_holes` + `stroke_total`) with a
    themed UI / rules explainer; it takes handicap exactly like stroke play and
    adds no bespoke scoring. `score_entries.annotations` is metadata, not scoring.

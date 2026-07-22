# GAME_FORMATS.md — format intent (per-format design of record)

> **⚠️ REVIEW DRAFT — not yet canon.** CC authored this fresh from code-verified truths
> gathered during the game-setup regressions pass (Phase 0 + six clusters). It is
> **prescriptive** — it states what each format is *meant* to do, so intent and code can be
> reconciled. **Zach canonizes it.** Anything CC could not confirm against code this pass is
> marked `⚠️ [VERIFY]` rather than invented — resolve those before this becomes canon.
>
> **Ground truth = code.** Where this doc and the code disagree, code wins and the doc is
> flagged. Data shape is authoritative in `supabase/migrations/`; nomenclature is ratified in
> `CLAUDE.md` §Glossary + `TRACKER.md` §3 (this doc uses those terms, it does not redefine
> them).

---

## 1 · Glossary (the ratified terms, as they apply here)

The canonical terms live in `CLAUDE.md`; the ones that matter most for formats:

| Concept | Canonical | Note |
|---------|-----------|------|
| Unit of play | **game** (+ **match** = a pairing inside match play) | "**round**" = golf's 18 holes ONLY — never a game/match |
| Points pool | **`total_points`** ≡ **points-in-play** | **Same concept, kept merged** — the owner-set pool a game puts up. Confirmed one concept this pass; do not split. |
| Match per-match override | **`game_matches.point_value`** | `null` = the match uses the derived even share. Confirmed this pass (Cluster E). |
| Combatants | **team** (roster) / **side** (a match slot, may be solo) | preserve the split |
| A person | **member** (trip) / **participant** (game) / **guest** (placeholder) | |
| Container | **competition** (code) / **cup** (UI) | |

**`round` ↔ `game`.** A *game* is the unit of play a competition is built from (stroke,
match, rack, or a non-golf game). A *round* is specifically 18 (or 9) holes of golf — the
thing a stroke game scores over. A competition is many games; a game may be one round. Never
call a game a "round."

**Scoring model (competition-level, `competitions.scoring_model`).** Two axes, independent of
team count: **`match_play`** (a fixed points ceiling → clinch/"first to X" is calculable) and
**`points`** (points accrue open-endedly → no clinch ceiling, so first-to-X / pts-in-play /
clinch chrome is deliberately absent — type-gated off).

---

## 2 · The four families (code: `src/lib/gameTypes.ts`)

Format identity is a `game_type_id` (`gtt_*`) carrying a `result_strategy`, an `entry_schema`,
a `category`, and a `compatibleModifiers` set. **`result_strategy` is the dispatch key** for
finish/post compute — new strategies slot in there, never on a hardcoded id.

| Family | `game_type_id` | `result_strategy` | Entry | Category |
|--------|----------------|-------------------|-------|----------|
| **Stroke play** | `gtt_stroke_play` | `stroke_total` | per-player strokes | golf |
| **Match play** | `gtt_match_play` | `match_play` | per-hole, 1v1 / 2v2 | golf |
| **Rack-n-stack** | `gtt_rack_n_stack` | `rack_n_stack` | net-stroke, team settlement | golf |
| **Non-golf** (card / yard / bar / manual) | `gtt_generic_*`, `gtt_manual` | `null` | declared finishing order | card/yard/bar/other |

> `⚠️ [VERIFY]` **Someday golf formats** — foursomes/alt-shot, four-ball (`group_holes`
> entry, `match_play`) — have **no `gtt_*` id yet** (`DEFERRED.md` "Slice C"). Not documented
> here as live formats.

---

## 3 · Cross-cutting mechanics (shared by all golf formats)

- **Settings = draft-then-save.** Every format's whole settings page commits through ONE
  atomic `save_game_config` RPC — nothing self-persists per row. The Save bar gates on
  `dirty`; C1 additionally blocks an invalid placement split (below). (CLAUDE.md #18.)
- **Course / tee.** Selecting or adding a course writes into the game's config **draft**, so
  the inline picker reflects the pending pick immediately (all three golf formats compose a
  `draftGameRow` — Cluster A). Applying a course snapshots its `par[]` + `handicap_index[]`
  into `scorecard_schema`; the snapshot freezes once scores exist (`COURSE_LOCKED`).
- **Finalize = game-level, all-units-complete, `canEdit`.** Rack and stroke finalize from the
  **game scoreboard** (never a per-group entry page), enabled only when **every** unit of play
  is thru every hole — `allUnitsComplete(thrus, unitCount)` (`src/lib/gameCompleteness.ts`),
  derived live over the current group set so a mid-round-added group re-blocks it.
  `canEdit` = owner / organizer / game-**delegate**; hidden for others.
- **Handicaps (relative).** Per-player strokes allocate against the course's stroke index
  (hardest holes first). Course-gated (no course → the Handicaps row is disabled). The player
  chips render the shared `Avatar` (team-colored initial) + name.
- **Modifier compatibility** (`compatibleModifiers`, real applicability, not a test matrix):
  - `gtt_stroke_play` → `moving_tees`
  - `gtt_match_play` → `moving_tees`, `glorious_holes` *(glorious doubles a hole's **match**
    value — match formats only)*
  - `gtt_rack_n_stack` → `moving_tees`
  - non-golf → *(none)*

---

## 4 · Stroke play (`gtt_stroke_play`, `stroke_total`)

**What it is.** Add up every stroke over the round — lowest total wins. No hole-by-hole duel;
each player against the scorecard. The unit of play is the **individual player**.

- **Groupings are MANDATORY** (migration 089). Players enter the game *through* the grouping
  builder; anyone ungrouped is **not in the game**. There is no standalone "pick 2–4 players"
  pre-screen for a competition game (that fossil is retired).
- **Leaderboard aggregates the whole field** across every grouping — ranked by to-par computed
  over *scored* holes only; a not-yet-started player (thru 0) sorts to the bottom, never
  mis-ranked to the top.
- **Config surface** (GROUP SETTINGS order): **Groupings → Point Distribution → Handicaps**
  (inline accordions), plus the bare **Total Points** in GAME MANAGEMENT, Course, Modifiers.
- **Total / Distribution split.** The owner-set **Total** lives in GAME MANAGEMENT (no match
  dependency); the **placement distribution** lives in GROUP SETTINGS. Both read the SAME
  drafted total so they can't drift. Distribution default is **Winner-takes-all** (1st place
  holds the whole pool, derived live; "Add 2nd place" opts into a real split). Place fields use
  the app number picker (Stepper, decimal entry).
- **Handicaps roster = the LIVE grouping field.** The Handicaps panel lists every player across
  the current draft groups (`configDraft.groups`), with team-colored avatars — it populates the
  instant a group is built, no cap, no save-and-return (Cluster b2). It is **not** the old
  ≤4-player create-time roster.
- **Finalize** → the game scoreboard's "Finish round" (all groups complete, `canEdit`), then
  the whole-field `FinalStandings`.

> `⚠️ [VERIFY]` **N-team groupings — individual vs team-aggregate.** Stroke groupings can span
> teams, and the field is scored per-individual. Whether/how a competition **aggregates** stroke
> results to a team score (and the tiebreak when it does) was **not exercised this pass** —
> confirm the intended team-aggregation + tiebreak rule.

---

## 5 · Match play (`gtt_match_play`, `match_play`)

**What it is.** Head-to-head, hole by hole — low net score wins each hole, and winning more
holes wins the **match**. Each match is **1v1 or 2v2**, and one game can mix both.

- **Setup** = **matches** (the pairings) + **sides** (slots, `game_matches`). Roster/pairing is
  authored in the Matches row; reorder is via **up/down arrows** (ends disabled — Cluster F).
- **Total Points model** (Refactor A2b). The owner sets a **`total_points`**; the per-match
  value **derives** (`total ÷ matchCount` = the even share); individual matches can be
  **overridden** and the remainder redistributes to keep the total locked. "Counts double" is
  just an override — no separate multiplier.
  - **Override storage** = `game_matches.point_value` (`null` → even share). Edited via a
    **popup** holding the Total Points picker (tap the value → decimal entry, commits itself);
    `×` clears back to the derived default (Cluster E).
  - **Award** per match = `point_value ?? points_distribution.value`; **team total** =
    `points_total` (authoritative).
- **First-to-X / clinch.** Because a match cup has a fixed points ceiling, "first to X wins" is
  calculable and shown (the competition board's clinch chrome). Points-model cups omit it.
- **Handicaps** — relative, per **side** (1v1 → one chip; 2v2 → two stacked). Course-gated.
- **Glorious Finishing Holes** modifier is available here (doubles a hole's match value,
  derived at compute time — never snapshotted).

> `⚠️ [VERIFY]` **Settlement + tiebreak rules.** The per-hole → per-match → team rollup and the
> **halved-match / all-square** and **match-tie** settlement + tiebreak specifics were not
> re-derived this pass. Confirm the authoritative settlement rule (esp. halved holes/matches and
> any dormie/close-out interplay with glorious holes).

---

## 6 · Rack-n-stack (`gtt_rack_n_stack`, `rack_n_stack`)

**What it is.** Stroke-play *entry*, match-play *settlement*: everyone posts their best net
round, players are sorted low→high within their team, and each ranked slot is "matched" against
the same slot on the other team — every slot a separate match result at day's end.

- **Derived slots, not stored.** Matchups are computed fresh (`computeRack`) from the per-player
  net scores + team rosters; the per-slot divisor = **`min(grouped-A, grouped-B)`**. Scores key
  to `user_id`, never a slot id, so a re-grouping doesn't orphan scores (migration 089 precise
  guard: only a scored-player *removal* is refused).
- **Config surface**: **Groupings** (carts, shared `RackGroupBuilder` — 2-col grid; "+ Add
  group" hides once everyone's grouped, Cluster D) · **Handicaps** · **Total Points** ·
  **Course** · **Modifiers** (`moving_tees`).
- **Distribution** = owner sets the **total**; the per-slot value derives (`evenShare` over the
  slot count); overrides redistribute (same A2b model as match, `point_value`).
- **Finalize** = game-level, all-slots-complete, `canEdit` (shared `allUnitsComplete`).

> `⚠️ [VERIFY]` **Short-handed settlement.** When the two teams have uneven grouped counts the
> pairing is uneven — the missing-slot settlement rule is a genuine **rules decision** (logged
> under the player-withdrawals deferred in `DEFERRED.md`). Confirm before canon.

---

## 7 · Non-golf (`gtt_generic_{card,yard,bar}`, `gtt_manual`, `result_strategy = null`)

**What it is.** However the game is actually played (poker, cornhole, a bar game…), you settle
it and **enter the finishing order by hand** — the rules of the day spell out how it's won.

- **Declared-outcome control.** Scores are posted as a **placement** finishing order via
  `games.post` (not per-hole `score_entries`) — order the teams by finish; points come from the
  game's configured distribution (you set the order, not the points).
- **Competition Format** (`competitions … competition_format`, enum
  `head_to_head | bracket_se | bracket_de | best_of_n | live_results`): a dropdown where
  **Head-to-Head / Match is the only enabled option** (and the default,
  `value ?? "head_to_head"`); **Bracket — Single/Double Elimination, Best of N, Live Results**
  are visible-but-disabled **"Soon" placeholders** (no engine yet — confirmed inert).
- **Points**: an owner-set **Total** pool + a placement **distribution** (same placement editor
  + app number picker as stroke). Subject to the C1 save gate below.

> `⚠️ [VERIFY]` **Declared-outcome control — full visual refresh** is a tracked feature
> (issue #504); the current control is functional but pre-refresh.

---

## 8 · Points-distribution validity (C1 — applies to the placement formats)

For the **placement** formats (stroke placement, non-golf points), a **started** distribution
(1st place entered) must sum **exactly** to `total_points`. An **undistributed** shell (no
places entered) is a legal, saveable state; a **partial** split (entered but ≠ total) is
**blocked** — client-side (the Save bar disables + shows the shortfall) *and* server-side (a
`saveConfig` zod refine rejects it before the RPC). Validity is **re-derived at save** against
the current total, never snapshotted (so changing the total after distributing re-invalidates).
Match/rack are immune — they re-derive the per-slot share via `evenShare`, so there is no stored
placement array to fall out of sync.

---

*Living draft. CC-authored from verified code truths; `⚠️ [VERIFY]` items await Zach's
canonization. Update when format intent changes; code wins any conflict.*

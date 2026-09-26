/**
 * gameTypes — the format DEFINITIONS, in code (W-PERF-01).
 *
 * A game format's definition is "what that format IS" — its name, the engine that
 * scores it (`resultStrategy`), the scorecard shape it carries, the categories and
 * modifiers it offers. None of this varies per game or per trip; it is fixed by
 * the code that implements each format. So it lives HERE, read synchronously and
 * locally — NOT fetched from the DB at dialog-open (which blanked the add-game
 * dialog's top half for 20–30s on bad signal at the course).
 *
 * The rule (CLAUDE.md, the data-vs-code seam): data that CHANGES (per-user,
 * per-trip, over time) → database; data FIXED BY THE CODE → code. The DB keeps
 * only the per-game REFERENCE (`games.game_type_id`) + genuine per-instance config
 * (points, course snapshot, modifiers-enabled); the code stores what that
 * reference MEANS.
 *
 * CLIENT-SAFE: this module imports only pure types (`@/lib/courseIndex`,
 * `@/lib/broadcastTables`) and defines const data — no Supabase, no tRPC server,
 * no node deps. The add-game
 * dialog imports `GAME_TYPES` directly, so the format chips are present before the
 * component even mounts: no fetch, no loading state, offline-safe.
 *
 * This is the concrete precursor to R1's template registry — the clean code-home
 * now; R1 generalizes routing/grouping/handicap/readiness over it later. It is NOT
 * the full registry: it relocates the existing definitions, nothing more.
 *
 * SOURCE OF TRUTH: the values below are copied VERBATIM from the live
 * `game_type_templates` rows (incl. each `scorecard_schema`, which had drifted
 * from its seed migration — e.g. stroke play's live `handicap_index`). The
 * `game_type_templates` table is intentionally LEFT IN PLACE until every reader is
 * proven migrated (audit-before-delete); a later migration archives it.
 */

import type { ScorecardSchema } from "@/lib/courseIndex";
import type { BroadcastTable } from "@/lib/broadcastTables";

/** The scoring engines a format can dispatch to. `null` = manual / non-engine
 *  (finishing order entered by hand — cornhole, trivia, generic games). */
export type ResultStrategy = "stroke_total" | "match_play" | "rack_n_stack" | "pickem" | "skins";

/**
 * What a finished game's results ARE — the shape the award function reads.
 *
 * `head_to_head`: two sides meet and one wins or they halve. `ranked`: a field
 * finishes in an order and points fall by placement.
 *
 * A format declares the kinds it CAN produce, usually exactly one. Where it can
 * produce both, the GAME's own configuration pins which is in play — `roll_up`
 * for pick'em, `competition_format` for the manual types (a non-golf `matches`
 * game is head-to-head; the same type as a `bracket` is ranked). The format
 * says what is possible, the instance says what is actual.
 *
 * **Configuration AND container, not configuration alone** (PR 4). Simple
 * (`head_to_head` / null) is head to head in a head-to-head cup only because
 * that cup has exactly two teams; the same Simple setup in a three-team points
 * race pays by placement. So a game's kind is pinned by its configuration and by
 * the container it sits in — see `resultKindInHeadToHead`
 * (`src/lib/headToHeadResult.ts`), which answers for the head-to-head container
 * only and is named for it.
 *
 * NOT a direction. Which way a result RANKS is a property of the result ROW —
 * `position` is a rank, `raw_score` is points already decided — and it is
 * recorded there (PR 2), not here. Measured on main 2026-09-22: a bracket runs
 * `low_wins` over entrants and `high_wins` over teams IN ONE GAME, and pick'em
 * runs opposite directions in different cups. No per-format value can be true
 * for both, which is why direction was struck from this declaration.
 */
export type ResultKind = "head_to_head" | "ranked";

/**
 * Where a game may live. NOT the same axis as `ScoringModel`.
 *
 * `compatibleScoringModels` answers "which `competitions.scoring_model` can
 * score this", has two values, and cannot express a game with no competition at
 * all. This answers "what container may hold this", and `side_game` is the
 * absence of a container rather than a kind of one.
 *
 * The two are deliberately NOT merged. `games.create`'s server guard began
 * reading `compatibleScoringModels` on 2026-09-22 and PR 4 adds more refusals
 * over it; changing a value set under a live guard is how a format gets
 * silently admitted or refused. Reconciling them is filed, not done.
 */
export type GameContainer = "side_game" | "head_to_head" | "points_race";

/** Creation Type tier the dialog groups formats under. */
export type GameCategory = "golf" | "card" | "yard" | "bar" | "other";

/**
 * The full definition of one game format — the code home of record. Every field
 * is a property of the FORMAT, not of any particular game. Only a subset is read
 * today (resultStrategy, scorecardSchema, category, compatibleModifiers, the
 * display strings); the structural axes (`supportsSides` etc.) are carried for
 * faithfulness + future readers. The two reserved-empty jsonb columns
 * (`config`/`config_schema`, always `{}`/unused) are intentionally omitted.
 */
export interface GameTypeDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  category: GameCategory;
  /** How scores are entered. null for manual (no scorecard entry). */
  entrySchema: string | null;
  /** The scoring engine; null = manual (finalized by passing an entered finishing
   *  ORDER instead of computing from scores). THE axis `games.finish` — the one
   *  finalize for every format — dispatches on. */
  resultStrategy: ResultStrategy | null;
  /** The base scorecard the format carries; null = non-golf (no scorecard).
   *  applyCourse patches a COPY of this with the course's par/index. */
  scorecardSchema: ScorecardSchema | null;
  /** Special-rule keys this format offers (golf modifier toggles). */
  compatibleModifiers: string[];
  // ── Structural axes (definition, not read by any current reader) ──
  supportsFreeForAll: boolean | null;
  supportsSides: boolean | null;
  requiresSides: boolean | null;
  maxPlayersPerSide: number | null;
  /**
   * Which competition SCORING-MODELs (`match_play | points`) this format can be
   * scored in — the canonical competition axis (`competitions.scoring_model`,
   * W-NONGOLF-02), deliberately independent of team count. `null` = unconstrained
   * (the manual non-engine types fit any competition).
   *
   * Renamed from the old `compatibleCompetitionFormats` (values `ryder_cup` /
   * `free_for_all`): that was dead metadata — read by nothing — and named after
   * competition ARCHETYPES that fused scoring-model + team-shape. The shape axis
   * lives in supportsSides/requiresSides/maxPlayersPerSide, so this is purely the
   * scoring-model compatibility, re-tagged to the axis the W-TYPE-01 add-game
   * filter reads. NB rack-n-stack is `match_play` — its net-stroke ENTRY mechanics
   * are not the points SCORING-model; it produces per-slot win/halve like match
   * play and computes in a match-play cup (raw stroke does not).
   */
  compatibleScoringModels: ScoringModel[] | null;

  // ── Declared properties (PR 1 of the composable-competitions plan) ──────
  //
  // DECLARED HERE, READ NOWHERE YET — by design. PR 1 is inert: it states the
  // model, later PRs switch consumers onto it. Each property names its intended
  // consumer so a later audit can tell "not yet read" from "never read" — the
  // distinction `compatibleCompetitionFormats` did not survive (this file's
  // header: retired as "dead metadata — read by nothing").
  //
  // THE COMMITMENT: if a property still has no consumer when PR 9 merges it is
  // DELETED, not kept for future readers. That is what the four structural axes
  // above were kept for, and they are still unread.
  //
  // Deliberately NOT projected onto `GameType` — that shape is the add-game
  // dialog's contract and nothing in the dialog reads these. The PR that needs
  // one on the client adds it to the projection then.

  /**
   * The result kinds this format can produce. CONSUMER: **PR 3** (one award
   * function — it dispatches on kind rather than inferring from payout shape).
   *
   * Usually one entry. Two means the game's own configuration pins which is in
   * play; see `ResultKind`. A format declaring both is not vague — it is a
   * format whose instances genuinely differ, and the row is the checker.
   */
  resultKinds: ResultKind[];

  /**
   * Would a different roster have produced a different result?
   * CONSUMER: **PR 8** (ruling 18 — a correction re-attributes past results
   * only where the result did not depend on team composition).
   *
   * `true` for head-to-head formats (pairings depend on teams) and team formats
   * like scramble. `false` for individually scored ranked formats — stroke,
   * Stableford, skins — where the same scores would have been shot whoever was
   * on which team.
   *
   * READ `true` AS "MAY BE", NOT "IS". The manual types are head-to-head in a
   * `matches` game and ranked in a `placement` one, so the honest per-format
   * answer is conditional, and `true` is the SAFE direction for ruling 18: it
   * refuses a correction that might be team-dependent rather than
   * re-attributing one that is. If PR 8 needs the sharper per-instance answer
   * this becomes a per-kind value there — flagged now so it is a decision
   * rather than a surprise.
   */
  teamDependent: boolean;

  /**
   * Which containers may hold this format. CONSUMERS: **PR 5** (opens
   * head-to-head formats to points races) and **PR 6** (a side game has no
   * points row; rack is never offered as one).
   *
   * DECLARES THE TARGET, NOT TODAY'S CODE. PR 1 is inert, so nothing reads this
   * yet; `match_play` listing `points_race` is what PR 5 will open, and it
   * deliberately does NOT match `compatibleScoringModels` until then. A test
   * asserting the two agree would be asserting that PR 5 has not happened.
   *
   * Ruling 2 ("head to head: match formats and rack only") is enforced on the
   * GAME's `competition_format` by PR 4, not on the type — a `gtt_generic_card`
   * game configured as `matches` IS a match format.
   */
  allowedContainers: GameContainer[];

  /**
   * Every table this format's scores or results CAN land in (#1432) — a set,
   * because entry mode and configuration move where they land: match play
   * writes `score_entries` in score mode and `match_hole_outcomes` in outcome
   * mode; a non-golf game writes `game_results`, `game_matches` or
   * `bracket_matches` depending on its `competition_format`.
   *
   * NOT part of the inert PR 1 block above: its consumers exist on the day it
   * lands. Typed `BroadcastTable[]`, so `tsc` refuses a table that is not in
   * `BROADCAST_TABLES`; that list is held EQUAL to the tables that actually
   * broadcast in the migrated schema (`broadcastRegistry.schema.test.ts`); and
   * every broadcasting table has a reader in the client handler. So a new
   * format's new score table cannot ship without a trigger and a reader —
   * skins' `skins_hole_outcomes` did, and other devices saw its holes only on a
   * poll until migration 192. `gameTypeDeclarations.guard.test.ts` refuses the
   * values the type permits and the model does not (empty, duplicate, `games`).
   */
  scoreTables: BroadcastTable[];
}

/** The competition scoring-model axis (W-NONGOLF-02) — `competitions.scoring_model`. */
export type ScoringModel = "match_play" | "points";

// ── Shared golf scorecard schemas ────────────────────────────────────────────
// Copied verbatim from the live `game_type_templates.scorecard_schema`. The
// par-72 layout is the template DEFAULT; applyCourse overwrites par + index with
// the chosen course's real values (on a deep clone — buildScorecardSchema never
// mutates the input, so sharing these consts is safe).

const HOLE_LABELS = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"];
const PAR_72 = [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4];
const SECTIONS_18 = [
  { name: "Front 9", units: ["1","2","3","4","5","6","7","8","9"] },
  { name: "Back 9", units: ["10","11","12","13","14","15","16","17","18"] },
];

const STROKE_INDEX_DEFAULT = [7,3,15,1,11,5,17,9,13,8,4,16,2,12,6,18,10,14];

// Asserted `as ScorecardSchema`: these mirror the DB's untyped `jsonb` and carry
// fields beyond courseIndex's intentionally-minimal "shape we read/patch" type
// (entry/interaction/participants, scoring.aggregation/tiebreaker). The assertion
// preserves them verbatim without widening the shared contract.
const strokeSchema = {
  units: { type: "holes", count: 18, ordered: true, labels: HOLE_LABELS, metadata: { par: PAR_72, handicap_index: STROKE_INDEX_DEFAULT } },
  entry: { value_type: "integer", value_label: "Strokes", min: 1, max: null },
  scoring: { strategy: "stroke_total", direction: "low_wins", aggregation: "sum", sections: SECTIONS_18, tiebreaker: "shared" },
  interaction: { model: "simultaneous", entry_timing: "per_unit" },
  participants: { min: 2, max: 4, participant_type: "individual", assigned_pairings: false },
} as ScorecardSchema;

// Skins. Same holes, par and stroke index as stroke play — the card still shows
// the course — but the ENTRY block says what it actually takes: a participant,
// labelled Winner, not an integer count of strokes. `direction: "high_wins"`
// because skins are won and more is better.
//
// `handicap_index` is kept deliberately even though skins computes no handicaps.
// It is COURSE data, and the stroke index is precisely the reference the group
// applies in their heads before deciding who won the hole — the card showing it
// is the whole of how a handicap reaches this format.
const skinsSchema = {
  units: { type: "holes", count: 18, ordered: true, labels: HOLE_LABELS, metadata: { par: PAR_72, handicap_index: STROKE_INDEX_DEFAULT } },
  entry: { value_type: "participant", value_label: "Winner", min: null, max: null },
  scoring: { strategy: "skins", direction: "high_wins", aggregation: "sum", sections: SECTIONS_18, tiebreaker: "shared" },
  interaction: { model: "simultaneous", entry_timing: "per_unit" },
  participants: { min: 2, max: null, participant_type: "individual", assigned_pairings: false },
} as ScorecardSchema;

// Unified match-play scorecard (Refactor A1) — one schema for singles + doubles +
// mixed, since 1v1-vs-2v2 is a per-MATCH property (each `game_matches.side_a/b`
// carries its own `{type:"user"|"play_group"}`), not a game-level fact. Carries
// par + handicap_index (the former singles schema; the old doubles schema dropped
// handicap_index — incidental drift, corrected here). The participants block is
// display metadata only — the engine reads shape per-match from the side refs.
const matchPlaySchema = {
  units: { type: "holes", count: 18, ordered: true, labels: HOLE_LABELS, metadata: { par: PAR_72, handicap_index: STROKE_INDEX_DEFAULT } },
  entry: { value_type: "integer", value_label: "Strokes", min: 1, max: null },
  scoring: { strategy: "match_play", direction: "low_wins", aggregation: "match", sections: SECTIONS_18, tiebreaker: "shared" },
  interaction: { model: "simultaneous", entry_timing: "per_unit" },
  participants: { min: 2, max: 8, participant_type: "individual", assigned_pairings: true },
} as ScorecardSchema;

const rackSchema = {
  units: { type: "holes", count: 18, ordered: true, labels: HOLE_LABELS, metadata: { par: PAR_72, handicap_index: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18] } },
  entry: { value_type: "integer", value_label: "Strokes", min: 1, max: null },
  scoring: { strategy: "rack_n_stack", direction: "low_wins", aggregation: "net_to_par", sections: SECTIONS_18, tiebreaker: "shared" },
  interaction: { model: "simultaneous", entry_timing: "per_unit" },
  participants: { min: 2, max: null, participant_type: "individual", assigned_pairings: false },
} as ScorecardSchema;

// ── The format catalog ───────────────────────────────────────────────────────

/** Every game format, keyed by id (= `games.game_type_id`). The home of record. */
export const GAME_TYPE_DEFINITIONS: Record<string, GameTypeDefinition> = {
  gtt_stroke_play: {
    id: "gtt_stroke_play",
    key: "stroke_play",
    name: "Stroke Play",
    description: "Add up every stroke over the round — lowest total wins. No hole-by-hole duel, just you against the scorecard.",
    sortOrder: 0,
    category: "golf",
    entrySchema: "user_holes",
    resultStrategy: "stroke_total",
    scorecardSchema: strokeSchema,
    // No modifier applies to stroke play, so its Game Modifiers row is hidden-by-`[]`.
    // `glorious_holes` doubles a hole's MATCH value (match-play only). `moving_tees`
    // used to sit here, but it was never specified and never computed — a selectable
    // checkbox that only ever wrote a key nothing read — so it was removed rather
    // than left as UI with no backing (see DEFERRED.md, where the feature itself
    // still lives as a nomination). Skins/scramble take `glorious_holes` when built.
    compatibleModifiers: [],
    supportsFreeForAll: true,
    supportsSides: false,
    requiresSides: false,
    maxPlayersPerSide: null,
    compatibleScoringModels: ["points"],
    // Individually scored: the same strokes would have been shot whoever was on which team.
    resultKinds: ["ranked"],
    teamDependent: false,
    allowedContainers: ["side_game", "points_race"],
    scoreTables: ["score_entries", "game_results"],
  },
  gtt_scramble: {
    id: "gtt_scramble",
    key: "scramble",
    name: "Scramble",
    description:
      "Everyone tees off, the team plays the best ball each shot, and one score per team goes on the card. Lowest total wins.",
    sortOrder: 3,
    category: "golf",
    /**
     * SCRAMBLE IS STROKE PLAY WITH A DIFFERENT SCORER, and every field here says
     * so deliberately.
     *
     * `resultStrategy` is `stroke_total` — the SAME engine, so `games.finish`
     * dispatches to the shipped stroke arm with nothing added (CLAUDE.md #8: a
     * new procedure whose reason to exist is "this format is different" is a
     * hardcoded format name wearing a procedure's clothes). `scorecardSchema` is
     * stroke's, unchanged: 18 holes, par, strokes.
     *
     * What differs is the PARTICIPANT — the score belongs to a `play_group`
     * standing for a team rather than to a user — and that is not a property
     * `resultStrategy` names. `entrySchema` is the only field that records it,
     * and nothing in the app reads that column (one comment in `StrokeKeypad`
     * mentions it), so it is honest description rather than behaviour.
     *
     * `compatibleScoringModels: ["points"]` is what keeps it out of a team-based
     * cup's add-game menu, the same predicate stroke uses. A match-play
     * competition cannot hold it, which is the distinction that matters most
     * here: BBMI's "Day 1 Scramble" is a MATCH-PLAY game whose NAME is Scramble,
     * sides being play_groups, and it is a different thing entirely. Nothing
     * about this type touches it.
     *
     * `compatibleModifiers: []` — `glorious_holes` weights a MATCH's holes and
     * has nothing to say about a stroke total. (`moving_tees` is a real scramble
     * rule and is NOT here: it was once a checkbox that wrote a key nothing
     * read, and was removed rather than left hollow. See #1324 — it needs a
     * design, not a flag.)
     */
    entrySchema: "group_holes",
    resultStrategy: "stroke_total",
    scorecardSchema: strokeSchema,
    compatibleModifiers: [],
    supportsFreeForAll: true,
    supportsSides: false,
    requiresSides: false,
    maxPlayersPerSide: null,
    compatibleScoringModels: ["points"],
    // A TEAM format — the team plays one ball, so the roster IS the result.
    resultKinds: ["ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "points_race"],
    scoreTables: ["score_entries", "game_results"],
  },
  gtt_skins: {
    id: "gtt_skins",
    key: "skins",
    name: "Skins",
    description:
      "Every hole is worth a skin. Win it outright and it is yours; tie it and the pot carries into the next hole. Record who won each hole — no scores, no handicaps. Most skins wins.",
    sortOrder: 4,
    category: "golf",
    /**
     * ENTRY IS BY OUTCOME, and every field here follows from that.
     *
     * Players pick up once they are out of a hole, so there is very often no
     * score to enter — the group applies strokes in their heads and says who
     * won. So nothing is stored in `score_entries`, nothing is allotted, and
     * there is no handicap roster. `entrySchema` is `hole_winner` to say so;
     * nothing in the app reads that column (migration 181 established the same
     * for scramble), so it is honest description rather than behaviour.
     *
     * `resultStrategy` is a NEW `skins` rather than a reuse, and the two
     * candidates each fail for their own reason. `stroke_total` sums a number
     * nobody entered. `match_play` is two-sided at every level —
     * `HoleOutcomeResult`, `DecidedHole`'s W/L/H, `matchState`'s A/B leader —
     * and this is up to four players plus Tied. The carryover fold is genuinely
     * new arithmetic on top of both.
     *
     * `compatibleModifiers: ["glorious_holes"]` — the SECOND format to take it,
     * and the half of stroke play's long-standing "Skins/scramble take
     * `glorious_holes` when built" that survived contact with the code. Glorious
     * doubles a HOLE'S VALUE, which is exactly what a skins hole has and exactly
     * what a stroke total does not (see scramble's note above).
     *
     * `compatibleScoringModels: ["points"]` — skins belongs to a POINTS cup, the
     * same as stroke and scramble. It produces a per-player COUNT, not the
     * per-slot win/halve a match-play competition scores.
     */
    entrySchema: "hole_winner",
    resultStrategy: "skins",
    scorecardSchema: skinsSchema,
    compatibleModifiers: ["glorious_holes"],
    supportsFreeForAll: true,
    supportsSides: false,
    requiresSides: false,
    maxPlayersPerSide: null,
    compatibleScoringModels: ["points"],
    // Individually scored per hole; team membership changes nothing about who won a skin.
    resultKinds: ["ranked"],
    teamDependent: false,
    allowedContainers: ["side_game", "points_race"],
    // Its own outcome table, and no stroke scores at all (games.skins.test.ts).
    scoreTables: ["skins_hole_outcomes", "game_results"],
  },
  gtt_match_play: {
    // Refactor A1 — the unified match-play type (was gtt_match_play_singles +
    // gtt_match_play_doubles). 1v1-vs-2v2 is a per-MATCH property (each match's
    // side type), so a game can be all-singles, all-doubles, or a mix. The engine
    // was already shape-agnostic (reads side type per row); this collapses the
    // game-level fork. A migration re-tags existing singles/doubles rows to this id.
    id: "gtt_match_play",
    key: "match_play",
    name: "Match Play",
    description: "Head-to-head, hole by hole — low net score wins each hole, and winning more holes wins the match. Each match is 1v1 or 2v2, and one game can mix both.",
    sortOrder: 1,
    category: "golf",
    // entrySchema is inert metadata (no runtime reader) — per-match entry
    // granularity (per-user 1v1 vs per-side 2v2) is derived from each match's side
    // type, not this field.
    entrySchema: "user_holes",
    resultStrategy: "match_play",
    scorecardSchema: matchPlaySchema,
    // `glorious_holes` applies to match play (it doubles a hole's match value) and is
    // the ONLY modifier left after `moving_tees` was removed — the one format whose
    // Modifiers row still renders. (Skins, when built, takes glorious too.)
    compatibleModifiers: ["glorious_holes"],
    supportsFreeForAll: false,
    supportsSides: true,
    requiresSides: true,
    // Per-match now — inert metadata (no runtime reader); kept as the max any
    // single match supports.
    maxPlayersPerSide: 2,
    // PR 5 (ruling 5): match play is allowed in a points race too, so this now
    // agrees with `allowedContainers` for this format. A head-to-head game in a
    // three-team race credits only its two sides (`teamsInGame`); a side must be
    // one unit (`splitSideRefusal`). Rack stays head to head only.
    compatibleScoringModels: ["match_play", "points"],
    resultKinds: ["head_to_head"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // score_entries in score mode, match_hole_outcomes in outcome mode (all four
    // BBMI 2026 rounds); a decided match's result on game_matches.
    scoreTables: ["score_entries", "match_hole_outcomes", "game_matches", "game_results"],
  },
  gtt_rack_n_stack: {
    id: "gtt_rack_n_stack",
    key: "rack_n_stack",
    name: "Rack-n-Stack",
    description: "You can't play stroke play in a match play format, you say? We say you can. Go out and post your best round and we'll sort you and your teammates from low to high. Throughout the day you'll be 'matched' with the same slot on the other team, and at the end of the round, every slot is a different match result.",
    sortOrder: 2,
    category: "golf",
    entrySchema: "user_holes",
    resultStrategy: "rack_n_stack",
    scorecardSchema: rackSchema,
    // Back to hidden-by-`[]`: `moving_tees` (the one modifier rack ever offered) was
    // removed as unbacked UI, and glorious is match-play hole-win only. Rack's
    // Modifiers row therefore doesn't render — the state it was in before the matrix
    // reconcile briefly made it live.
    compatibleModifiers: [],
    supportsFreeForAll: false,
    supportsSides: true,
    requiresSides: true,
    maxPlayersPerSide: null,
    compatibleScoringModels: ["match_play"],
    // The ONLY format with no `side_game`: ruling 12 makes it a head-to-head fixture whose two sides ARE the competition's two teams, and ruling 27 says it is never offered as a side game. PR 5 keeps it head-to-head only.
    resultKinds: ["head_to_head"],
    teamDependent: true,
    allowedContainers: ["head_to_head"],
    scoreTables: ["score_entries", "game_results"],
  },
  gtt_generic_card: {
    id: "gtt_generic_card",
    key: "generic_card",
    name: "Generic Card Game",
    description: "However this one's played, you'll settle it and enter the finishing order by hand. The rules below spell out how it's won.",
    sortOrder: 90,
    category: "card",
    entrySchema: null,
    resultStrategy: null,
    scorecardSchema: null,
    compatibleModifiers: [],
    supportsFreeForAll: null,
    supportsSides: null,
    requiresSides: null,
    maxPlayersPerSide: null,
    compatibleScoringModels: null,
    // A manual type is head-to-head as a `matches` game and ranked as a `placement` one — the instance pins it.
    resultKinds: ["head_to_head", "ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // By competition_format: placement → game_results; matches → game_matches.result;
    // bracket → bracket_matches. The finalize writes game_results in every case.
    scoreTables: ["game_results", "game_matches", "bracket_matches"],
  },
  gtt_generic_yard: {
    id: "gtt_generic_yard",
    key: "generic_yard",
    name: "Generic Yard Game",
    description: "However this one's played, you'll settle it and enter the finishing order by hand. The rules below spell out how it's won.",
    sortOrder: 91,
    category: "yard",
    entrySchema: null,
    resultStrategy: null,
    scorecardSchema: null,
    compatibleModifiers: [],
    supportsFreeForAll: null,
    supportsSides: null,
    requiresSides: null,
    maxPlayersPerSide: null,
    compatibleScoringModels: null,
    // As `gtt_generic_card` — Cornhole is the worked example, and it was a `matches` game.
    resultKinds: ["head_to_head", "ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // By competition_format: placement → game_results; matches → game_matches.result;
    // bracket → bracket_matches. The finalize writes game_results in every case.
    scoreTables: ["game_results", "game_matches", "bracket_matches"],
  },
  gtt_pickem: {
    id: "gtt_pickem",
    key: "pickem",
    name: "Pick'em",
    // The "how you compete" copy the catalog carries for every format. The
    // load-bearing sentence is the last one: being right is not enough.
    description:
      "Everyone picks winners from a slate of real-world games, then ranks how sure they are. A correct pick scores what you ranked it; a wrong one scores nothing. So you have to be right where the other guy is wrong, or more certain than he is.",
    sortOrder: 95,
    // "other", not a golf/card/yard/bar category: pick'em is a PREDICTION
    // structure and the category drives the shared `categoryIcon` map, which is
    // keyed by category and never by scoring format.
    category: "other",
    // Picks are not scores. They live in `pickem_picks` behind their own
    // owner-only policy (migration 146), never in `score_entries`, so there is
    // no hole-shaped entry schema and no scorecard to carry.
    entrySchema: null,
    // An ENGINE, not a manual format — the server computes from picks and
    // results rather than accepting an entered finishing order. The engine
    // itself lands in Phase 6; until then `games.finish` refuses this strategy
    // through its exhaustive else, which is the loud failure rather than the
    // silent one.
    resultStrategy: "pickem",
    scorecardSchema: null,
    // Pick'em's weighting is the per-slate-game MULTIPLIER, a property of one
    // contest on the slate — not a `games.modifiers` flag. Hence [], which the
    // format-surface registry's `modifiers: false` is pinned to.
    compatibleModifiers: [],
    supportsFreeForAll: null,
    supportsSides: null,
    requiresSides: null,
    maxPlayersPerSide: null,
    // Both models: match_play rolls up as team totals or individual matches
    // (`pickem_games.roll_up`), points rolls up as an ordering of N teams.
    // Phase 2 builds the match_play path; the points path is Phase 7 and is
    // the same sheet with different copy.
    compatibleScoringModels: ["match_play", "points"],
    // BOTH, genuinely: sheet-versus-sheet matches and a points total, switched by `roll_up`. The case that made `resultKinds` a set rather than a value.
    resultKinds: ["head_to_head", "ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // A runner's slate result. Sheets (pickem_picks) are inputs, hidden until the
    // reveal; pairings (game_matches) never carry a pick'em result.
    scoreTables: ["pickem_slate_games", "game_results"],
  },
  gtt_generic_bar: {
    id: "gtt_generic_bar",
    key: "generic_bar",
    name: "Generic Bar Game",
    description: "However this one's played, you'll settle it and enter the finishing order by hand. The rules below spell out how it's won.",
    sortOrder: 92,
    category: "bar",
    entrySchema: null,
    resultStrategy: null,
    scorecardSchema: null,
    compatibleModifiers: [],
    supportsFreeForAll: null,
    supportsSides: null,
    requiresSides: null,
    maxPlayersPerSide: null,
    compatibleScoringModels: null,
    // As `gtt_generic_card`.
    resultKinds: ["head_to_head", "ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // By competition_format: placement → game_results; matches → game_matches.result;
    // bracket → bracket_matches. The finalize writes game_results in every case.
    scoreTables: ["game_results", "game_matches", "bracket_matches"],
  },
  gtt_manual: {
    id: "gtt_manual",
    key: "manual",
    name: "Generic Game",
    description: "However this one's played, you'll settle it and enter the finishing order by hand. The rules below spell out how it's won.",
    sortOrder: 99,
    category: "other",
    entrySchema: null,
    resultStrategy: null,
    scorecardSchema: null,
    compatibleModifiers: [],
    supportsFreeForAll: true,
    supportsSides: true,
    requiresSides: false,
    maxPlayersPerSide: null,
    compatibleScoringModels: null,
    // As `gtt_generic_card`.
    resultKinds: ["head_to_head", "ranked"],
    teamDependent: true,
    allowedContainers: ["side_game", "head_to_head", "points_race"],
    // By competition_format: placement → game_results; matches → game_matches.result;
    // bracket → bracket_matches. The finalize writes game_results in every case.
    scoreTables: ["game_results", "game_matches", "bracket_matches"],
  },
};

/** All definitions, sorted by sortOrder then id (stable) — the catalog order. */
export const GAME_TYPE_LIST: GameTypeDefinition[] = Object.values(GAME_TYPE_DEFINITIONS).sort(
  (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
);

// ── Client-facing shape ──────────────────────────────────────────────────────

/**
 * The shape the creation UI consumes — the format catalog as the add-game dialog
 * needs it. `isEngine`/`isGolf` are DERIVED (an engine computes results; a golf
 * type carries a scorecard), so the two booleans can't drift from the strategy /
 * schema they're derived from.
 */
export interface GameType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isEngine: boolean;
  isGolf: boolean;
  resultStrategy: string | null;
  category: string;
  compatibleModifiers: string[];
  /** Scoring-models this format can be scored in; `null` = any (manual types).
   *  The W-TYPE-01 add-game filter reads this against `competitions.scoring_model`. */
  compatibleScoringModels: ScoringModel[] | null;
}

/** Project a definition to the client `GameType` shape. */
export function toGameType(d: GameTypeDefinition): GameType {
  return {
    id: d.id,
    key: d.key,
    name: d.name,
    description: d.description,
    isEngine: d.resultStrategy != null,
    isGolf: d.scorecardSchema != null,
    resultStrategy: d.resultStrategy,
    category: d.category,
    compatibleModifiers: d.compatibleModifiers,
    compatibleScoringModels: d.compatibleScoringModels,
  };
}

/** The client format catalog — import this directly; never fetch it. */
export const GAME_TYPES: GameType[] = GAME_TYPE_LIST.map(toGameType);

// ── W-TYPE-01 — the add-game compatibility filter (data here, called by the modal) ──

/**
 * Is this format offerable in a competition of the given scoring-model? A format
 * with `null` compatibility (the manual types) fits any competition; otherwise it
 * must list the model. A `null`/absent scoring-model (a not-yet-classified comp)
 * is permissive — show everything rather than an empty menu.
 */
export function isGameTypeForScoringModel(
  type: Pick<GameType, "compatibleScoringModels">,
  scoringModel: ScoringModel | null | undefined,
): boolean {
  if (!scoringModel) return true;
  if (type.compatibleScoringModels == null) return true;
  return type.compatibleScoringModels.includes(scoringModel);
}

/** The catalog filtered to a competition's scoring-model — what the add-game
 *  modal offers. Derived from each format's `compatibleScoringModels`, so a list
 *  here would only go stale (it did: it still said "points → Stroke + manual"
 *  after scramble and skins landed). Match play joined points in PR 5; rack is
 *  the one match format that stays Match Play only. */
export function gameTypesForScoringModel(
  scoringModel: ScoringModel | null | undefined,
  catalog: GameType[] = GAME_TYPES,
): GameType[] {
  return catalog.filter((t) => isGameTypeForScoringModel(t, scoringModel));
}

const SCORING_MODEL_LABEL: Record<ScoringModel, string> = {
  match_play: "Match Play",
  points: "Points",
};

/**
 * Why a competition of this scoring-model cannot hold this format, or null when
 * it can (#1304). The SAME predicate the add-game menu filters with — so the
 * server refuses exactly what the menu never offers, and the two cannot drift.
 *
 * The sentence names what the cup DOES take, derived from the catalog, because
 * the only reader who can reach it is one whose menu disagreed with the server —
 * an API caller, or a stale client — and "not allowed" alone leaves them nowhere.
 *
 * An unregistered id returns null: it is not a compatibility question, and the
 * insert's foreign key reports it in its own terms.
 */
export function formatRefusalForScoringModel(
  gameTypeId: string,
  scoringModel: ScoringModel | null | undefined,
  catalog: GameType[] = GAME_TYPES,
): string | null {
  const type = catalog.find((t) => t.id === gameTypeId);
  if (!type || isGameTypeForScoringModel(type, scoringModel)) return null;
  const model = scoringModel as ScoringModel;
  const takes = gameTypesForScoringModel(model, catalog).map((t) => t.name).join(", ");
  return `A ${SCORING_MODEL_LABEL[model]} cup can't hold ${type.name}. It takes: ${takes}.`;
}

// ── Lookups (the server readers' synchronous replacement for the DB query) ────

/** The definition for a game type id, or undefined if the id is unregistered. */
export function getGameTypeDefinition(id: string | null | undefined): GameTypeDefinition | undefined {
  return id ? GAME_TYPE_DEFINITIONS[id] : undefined;
}

/** A type is "manual" (non-engine, finishing order entered by hand) when it is a
 *  KNOWN format whose resultStrategy is null. An unregistered id is NOT manual —
 *  it's unknown (the caller decides how to fail). Mirrors the old leaderboard
 *  `isManualType` (known AND null), now sourced from code. */
export function isManualGameType(id: string | null | undefined): boolean {
  const def = getGameTypeDefinition(id);
  return def != null && def.resultStrategy == null;
}

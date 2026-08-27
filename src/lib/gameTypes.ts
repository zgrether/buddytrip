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
 * CLIENT-SAFE: this module imports only a pure type from `@/lib/courseIndex` and
 * defines const data — no Supabase, no tRPC server, no node deps. The add-game
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

/** The scoring engines a format can dispatch to. `null` = manual / non-engine
 *  (finishing order entered by hand — cornhole, trivia, generic games). */
export type ResultStrategy = "stroke_total" | "match_play" | "rack_n_stack" | "pickem";

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
    compatibleScoringModels: ["match_play"],
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
 *  modal offers (only WIRED types: match_play → 1v1/2v2/rack + manual; points →
 *  Stroke + manual, until stableford/sabotage/skins are built). */
export function gameTypesForScoringModel(
  scoringModel: ScoringModel | null | undefined,
  catalog: GameType[] = GAME_TYPES,
): GameType[] {
  return catalog.filter((t) => isGameTypeForScoringModel(t, scoringModel));
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

import {
  computeStrokePlayStandings,
  netStrokeEntries,
  type RawStrokeEntry,
  type StrokeStanding,
} from "@/lib/strokePlay";
import {
  strokeHoles,
  buildDecided,
  buildDecidedFromOutcomes,
  matchState,
  type DecidedHole,
  type HoleOutcomeResult,
  type MatchState,
} from "@/lib/matchPlay";
import { clampStrokes, effectiveStrokes } from "@/lib/handicap";
import { fmtToPar, playerStats, computeRack, type RackPlayer, type RackResult, type Team } from "@/lib/rackNStack";
import { gloriousConfig } from "@/lib/gloriousHoles";
import { type ModifiersMap } from "@/lib/modifiers";
import { unitsFromSchema, strokeIndexOf, PLAYER_COLORS } from "@/lib/strokePlayConfig";
import type { ScorecardSchema } from "@/lib/courseIndex";
import { migrateSideBetsState, type SideBetsState } from "@/lib/sideBets";
import type { Participant, ScoreUnit, ScoreValues } from "@/components/games/types";

/**
 * Quick Games' local-storage state + the read/derive helpers shared by the page
 * (`app/quick-game/page.tsx`), the dashboard card, and the context rail — all of
 * which need the state type and its derived summaries without importing a page
 * component. Split out for that reason (#879); course selection + handicaps
 * extended it (#1049); match play + rack-n-stack made it a discriminated union.
 *
 * The page remains the only WRITER (via `localStorage.setItem`); this module
 * only reads and derives — including all the netting/match math, so a handicap
 * game can't disagree between the dashboard card, the entry screen, and the
 * final standings (CLAUDE.md #8, the same discipline the trip-side views use).
 */
/**
 * The pre-slots key: ONE game, any format, discriminated by the `format` field
 * inside it. Read-only now — `ensureLegacyMigrated` moves whatever it holds
 * into the matching per-format key below (once) and deletes it, so nothing
 * ever reads it again after that. Kept only so the migration has something to
 * migrate FROM; never write to it.
 */
const QUICK_GAME_LEGACY_STORAGE_KEY = "bt-quick-game";

/**
 * Bump when the persisted shape changes. `migrateQuickGameState` is the ONE
 * place that reads an on-disk payload of any past version and normalizes it —
 * crew have in-progress rounds in local storage across a deploy, so a bare
 * `JSON.parse(raw) as QuickGameState` is not safe once the shape grows.
 *
 * v2 added `course`/`strokes`/`version` (#1049). v3 added `format` (#1050).
 * The per-format storage keys were the same STATE shape and needed no bump.
 * v4 added `bets` — side bets, which every round saved before them lacks
 * entirely, so the migrator supplies the empty state rather than failing.
 */
export const QUICK_GAME_STATE_VERSION = 4;

/** Which game a saved round is. Each format gets its OWN storage key
 *  (`quickGameStorageKey`) — the dashboard's two tiles and the rail's list can
 *  hold a stroke round and a match round at once, which is the entire point of
 *  this being tiles instead of one slot behind a picker. */
export type QuickGameFormat = "stroke" | "match" | "rack";

/** Every format the dashboard actually offers a tile for. `rack`'s state/
 *  migration/setup UI exist (from #1050) but it has no tile yet — no board was
 *  built — so it's deliberately excluded here rather than shown half-finished.
 *  A rack payload under its own key still round-trips correctly if one exists
 *  from earlier testing; it's just never reachable from a tile. */
export const QUICK_GAME_TILE_FORMATS = ["stroke", "match"] as const;

/** This format's own storage key. `stroke`'s key intentionally reuses the
 *  legacy name (`bt-quick-game:stroke`, not a bare `bt-quick-game`) — a real
 *  key per format, none of them ambiguous with the pre-slots single key, so
 *  `ensureLegacyMigrated` can tell "already migrated" from "never had one"
 *  without a separate marker. */
export function quickGameStorageKey(format: QuickGameFormat): string {
  return `bt-quick-game:${format}`;
}

/** A course applied to the round — captured, not referenced (#1049 T0.3):
 *  the par/index/tee facts are fetched once at selection and frozen into
 *  `schema` via the shared `buildCourseSnapshot`, so the scorecard renders
 *  with no further network — a round survives losing signal mid-course. */
export interface QuickGameCourse {
  id: string;
  name: string;
  teeName?: string;
  schema: ScorecardSchema;
}

interface QuickGameCommon {
  version: number;
  players: Participant[];
  /** Per-SCORING-ENTITY gross, `{ [entityId]: { [unitLabel]: gross } }`.
   *  stroke/rack key it by PLAYER id; match keys it by SIDE id (a 2v2 side is
   *  one score column — one ball, one score), mirroring how `MatchEntryView`
   *  keys `values` off `m.a.id`. */
  values: ScoreValues;
  finished: boolean;
  currentHole: number;
  /** null = no course selected — the default 18-hole par-72 layout. */
  course: QuickGameCourse | null;
  /**
   * Side bets — the RECORDED half only (the bets, and the tracker's two
   * preferences). Every figure the tracker shows derives from these plus the
   * scores, per `sideBets.ts`; nothing about the tally is stored.
   *
   * Empty for a round nobody bet on, which is the case that must change
   * nothing: no strip, no tracker, the scorecard identical to before (§7).
   */
  bets: SideBetsState;
}

/** Quick Stroke Play — per-player ABSOLUTE handicaps (0–18 each). */
export interface QuickStrokeState extends QuickGameCommon {
  format: "stroke";
  /** { [playerId]: handicapStrokes }. Absent player ⇒ 0 (scratch). Per-round,
   *  per-player — there is no user record to hang it on (typed names). */
  strokes: Record<string, number>;
}

/** Quick Rack n Stack — per-player ABSOLUTE handicaps (net stroke play, same
 *  model as stroke), plus the A/B team each player racks for. */
export interface QuickRackState extends QuickGameCommon {
  format: "rack";
  strokes: Record<string, number>;
  /** { [playerId]: "A" | "B" }. `computeRack` racks the two teams slot-by-slot. */
  teams: Record<string, Team>;
}

/**
 * One side of a quick match. `playerIds` is 1 (a 1v1) or 2 (a 2v2) — the count
 * IS the shape, never a setting (trip-side's `MatchSides.playersPerSide: 1 | 2`).
 * `id` is the side's own minted key into `values`; a quick match has no
 * `play_group`, and the scoring core never wanted one (Phase 0 T0.3 — a side is
 * never an id in `buildDecided`/`HoleOutcomeRow`).
 */
export interface QuickMatchSide {
  id: string;
  playerIds: string[];
  /**
   * RELATIVE handicap strokes this side RECEIVES. Match play gives strokes to
   * exactly ONE side — never split, never both (`RelHandicapControl`: "one
   * signed value, strokes to exactly ONE side"). So at most one of the two
   * sides is non-zero. This is NOT the per-player absolute model stroke/rack
   * use: absolute would allocate A's 10 and B's 4 against the same hardest
   * holes and cancel on the overlap, landing strokes on index 5–10; relative
   * gives A six strokes on index 1–6. Different holes, different result — and
   * relative is what trip-side scores, so it is what Quick matches.
   */
  strokes: number;
}

/** Quick Match Play — one match per round (a foursome having a match), either
 *  entry mode, optionally with Glorious Finishing Holes. */
export interface QuickMatchState extends QuickGameCommon {
  format: "match";
  /**
   * PICKED AT SETUP, never inferred. `score` = enter each side's gross per hole
   * (one ball: alternate shot / scramble); `outcome` = record who won the hole
   * (the only way to score a format with no per-side stroke, and what makes
   * best-ball expressible).
   */
  entryMode: "score" | "outcome";
  sideA: QuickMatchSide;
  sideB: QuickMatchSide;
  /** `{ [unitLabel]: result }` — outcome mode's storage. Empty in score mode. */
  outcomes: Record<string, HoleOutcomeResult>;
  /** `games.modifiers`'s local twin. Only `glorious_holes` exists today. */
  modifiers: ModifiersMap;
}

export type QuickGameState = QuickStrokeState | QuickRackState | QuickMatchState;

/** Narrowing helpers — used at every reader so nothing branches on shape. */
export const isStrokeGame = (s: QuickGameState): s is QuickStrokeState => s.format === "stroke";
export const isRackGame = (s: QuickGameState): s is QuickRackState => s.format === "rack";
export const isMatchGame = (s: QuickGameState): s is QuickMatchState => s.format === "match";

/** The user-facing name of each format — the ONE place these strings live, so a
 *  new reader can't hardcode "Quick Stroke Play" the way the dashboard card, the
 *  rail, the setup `<h1>`, the app-bar `gameName` and the settings title each
 *  did before the T0.4 sweep. */
export const QUICK_GAME_LABEL: Record<QuickGameFormat, string> = {
  stroke: "Quick Stroke Play",
  match: "Quick Match Play",
  rack: "Quick Rack n Stack",
};

/** The `game_type_id` each quick format scores as. Load-bearing, not cosmetic:
 *  `gloriousConfig` guards on `isMatchPlayFormat(gameTypeId)`, so a quick match
 *  must present as `gtt_match_play` for the modifier to apply at all — and rack
 *  must NOT, which is exactly why glorious stays inert there (by design). */
export const QUICK_GAME_TYPE_ID: Record<QuickGameFormat, string> = {
  stroke: "gtt_stroke_play",
  match: "gtt_match_play",
  rack: "gtt_rack_n_stack",
};

/** One editable roster row — the shared shape for both the pre-start setup
 *  screen and the post-start roster editor (§1/§2), so "start a game" and
 *  "save an edited roster" build a `{players, strokes}` pair the identical way
 *  and can't drift into two floor/cap rules. */
export interface DraftPlayerRow {
  id: string;
  name: string;
  strokes: number;
  /** Which side this row plays for — MATCH only, and the reason the Partners
   *  section is gone (§6). The row's own side makes partnering structural: two
   *  lists with a `vs` between them say who is with whom without a second
   *  control to explain it. Absent for stroke/rack, which have no sides. */
  side?: "A" | "B";
}

/** Draft rows for the roster editor, format-aware. Stroke/rack carry each
 *  player's own absolute handicap; a MATCH's strokes are per-SIDE and relative,
 *  owned by the relative control rather than the per-player rows, so its rows
 *  read 0 — the one place that asymmetry is expressed. */
export function draftRowsFrom(state: QuickGameState): DraftPlayerRow[] {
  const sideOf = (id: string): "A" | "B" | undefined =>
    isMatchGame(state) ? (state.sideA.playerIds.includes(id) ? "A" : "B") : undefined;
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    strokes: isMatchGame(state) ? 0 : state.strokes[p.id] ?? 0,
    side: sideOf(p.id),
  }));
}

/**
 * Build `{players, strokes}` from editable draft rows — the ONE roster-build
 * path (start a new game, or save an edited one). Floor of 1 (#954/#955): a
 * solo round is real. Cap of 4: the entry grid shows one card's players on one
 * screen. Returns null when no row has a non-blank name (nothing to start).
 */
export function buildRosterFromDrafts(
  rows: DraftPlayerRow[]
): { players: Participant[]; strokes: Record<string, number> } | null {
  const valid = rows
    .map((r) => ({ ...r, name: r.name.trim() }))
    .filter((r) => r.name.length > 0)
    .slice(0, 4);
  if (valid.length < 1) return null;
  const players: Participant[] = valid.map((r, i) => ({
    id: r.id,
    name: r.name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
  }));
  const strokes: Record<string, number> = {};
  for (const r of valid) strokes[r.id] = clampStrokes(r.strokes);
  return { players, strokes };
}

/**
 * Normalize a raw local-storage payload of ANY past shape into the current
 * `QuickGameState`. A pre-course-selection save (no `version`/`course`/
 * `strokes`) and a pre-`format` save (v2, always stroke play) are the cases
 * this guards — both must load as a playable round rather than fail or
 * half-populate. Returns null for anything that isn't recognizably a Quick Game
 * state (corrupt JSON is already caught by the caller's try/catch; this catches
 * a wrong SHAPE).
 *
 * **The format is READ, never INFERRED.** A missing `format` means v2, which
 * was always stroke play — that default is a fact about the old writer, not a
 * guess from the payload's shape. Inferring would be the dangerous kind of
 * wrong: a match payload carries `players` and `values` too, so a shape-sniffing
 * validator would accept it and render a match as stroke standings — no crash,
 * just a plausible-looking wrong answer. An UNRECOGNIZED format string is
 * rejected outright rather than coerced to stroke, for the same reason: a
 * format this build doesn't know is not a stroke round.
 */
export function migrateQuickGameState(raw: unknown): QuickGameState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.players)) return null;
  if (typeof r.values !== "object" || r.values === null) return null;

  // Read the discriminator. Absent ⇒ v2 ⇒ stroke (what the old writer wrote).
  const rawFormat = r.format === undefined ? "stroke" : r.format;
  if (rawFormat !== "stroke" && rawFormat !== "match" && rawFormat !== "rack") return null;

  const course = r.course && typeof r.course === "object" ? (r.course as QuickGameCourse) : null;
  const currentHole = typeof r.currentHole === "number" && r.currentHole > 0 ? r.currentHole : 1;
  const common = {
    version: QUICK_GAME_STATE_VERSION,
    players: r.players as Participant[],
    values: r.values as ScoreValues,
    finished: r.finished === true,
    currentHole,
    course,
    // Absent on every round saved before v4 — `migrateSideBetsState` returns
    // the empty state for that, so a pre-bets round resumes unbetted rather
    // than failing shape validation.
    bets: migrateSideBetsState(r.bets),
  };
  const strokesOf = (v: unknown): Record<string, number> =>
    v && typeof v === "object" ? (v as Record<string, number>) : {};

  if (rawFormat === "match") {
    // A match needs BOTH sides to be meaningful — a half-written match is not a
    // playable round, so it is rejected rather than half-populated.
    const side = (v: unknown): QuickMatchSide | null => {
      if (!v || typeof v !== "object") return null;
      const s = v as Record<string, unknown>;
      if (typeof s.id !== "string" || !Array.isArray(s.playerIds) || s.playerIds.length < 1) return null;
      return {
        id: s.id,
        playerIds: s.playerIds as string[],
        strokes: typeof s.strokes === "number" ? clampStrokes(s.strokes) : 0,
      };
    };
    const sideA = side(r.sideA);
    const sideB = side(r.sideB);
    if (!sideA || !sideB) return null;
    return {
      ...common,
      format: "match",
      entryMode: r.entryMode === "outcome" ? "outcome" : "score",
      sideA,
      sideB,
      outcomes:
        r.outcomes && typeof r.outcomes === "object"
          ? (r.outcomes as Record<string, HoleOutcomeResult>)
          : {},
      modifiers: r.modifiers && typeof r.modifiers === "object" ? (r.modifiers as ModifiersMap) : {},
    };
  }

  if (rawFormat === "rack") {
    return {
      ...common,
      format: "rack",
      strokes: strokesOf(r.strokes),
      teams: r.teams && typeof r.teams === "object" ? (r.teams as Record<string, Team>) : {},
    };
  }

  return { ...common, format: "stroke", strokes: strokesOf(r.strokes) };
}

/**
 * One-time move of the legacy single key into its matching per-format key.
 * Idempotent and safe to call from every mount site (dashboard, rail, the page
 * itself) with no ordering dependency: JS is single-threaded within a tab, so
 * "read legacy → if present, write it under `format`, delete legacy" either
 * runs once and does the move, or finds nothing and no-ops — there is no
 * window where two callers both see the legacy key and double-write.
 *
 * Never overwrites an existing per-format round. If that format's own key is
 * already occupied (this build made no promise about how that could happen,
 * but a defensive check costs nothing here and losing an in-progress round to
 * a migration bug is exactly the failure mode this function exists to avoid),
 * the legacy payload is left in place rather than discarded — better a
 * duplicate to notice than data silently dropped.
 */
function ensureLegacyMigrated(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(QUICK_GAME_LEGACY_STORAGE_KEY);
    if (!raw) return;
    const migrated = migrateQuickGameState(JSON.parse(raw));
    if (!migrated) {
      // Unreadable even by the tolerant migrator — nothing to carry forward.
      localStorage.removeItem(QUICK_GAME_LEGACY_STORAGE_KEY);
      return;
    }
    const targetKey = quickGameStorageKey(migrated.format);
    if (localStorage.getItem(targetKey) != null) return; // don't clobber — see doc above
    localStorage.setItem(targetKey, JSON.stringify(migrated));
    localStorage.removeItem(QUICK_GAME_LEGACY_STORAGE_KEY);
  } catch {
    /* ignore corrupt storage — leaves the legacy key in place to retry later */
  }
}

/** Client-only. Returns null on no saved round for this FORMAT, corrupt JSON,
 *  an unrecognized shape, or SSR. Migrates the legacy single key first (a
 *  no-op after the first call in any tab), so a round saved before #1051
 *  resumes under its own format's key without the caller doing anything. */
export function readQuickGameState(format: QuickGameFormat): QuickGameState | null {
  if (typeof window === "undefined") return null;
  ensureLegacyMigrated();
  try {
    const raw = localStorage.getItem(quickGameStorageKey(format));
    if (!raw) return null;
    const migrated = migrateQuickGameState(JSON.parse(raw));
    // A format's own key holding a DIFFERENT format's state would mean a
    // write went to the wrong key — never trust the key over the payload.
    return migrated && migrated.format === format ? migrated : null;
  } catch {
    return null;
  }
}

/** Every format with an in-progress or finished round saved, keyed by format —
 *  what the dashboard's tiles and the rail's list both render from, so neither
 *  can enumerate "what's in progress" a second, driftable way. Only checks
 *  `QUICK_GAME_TILE_FORMATS` — a saved rack round (from earlier #1050 testing)
 *  exists on disk but isn't surfaced here, matching it having no tile. */
export function readAllQuickGames(): Partial<Record<QuickGameFormat, QuickGameState>> {
  const out: Partial<Record<QuickGameFormat, QuickGameState>> = {};
  for (const format of QUICK_GAME_TILE_FORMATS) {
    const s = readQuickGameState(format);
    if (s) out[format] = s;
  }
  return out;
}

/** Write this round to ITS OWN format's key. The one place `page.tsx`'s
 *  persist effect writes, so a caller can never accidentally write a match
 *  under the stroke key by passing the wrong constant. */
export function writeQuickGameState(state: QuickGameState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(quickGameStorageKey(state.format), JSON.stringify(state));
  } catch {
    /* ignore (e.g. storage quota) — the in-memory round is unaffected */
  }
}

/** Clear this format's saved round (Discard, Play Again, or Reset-to-null). */
export function clearQuickGameState(format: QuickGameFormat): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(quickGameStorageKey(format));
  } catch {
    /* ignore */
  }
}

/**
 * The round's scorecard units — course-driven when a course is applied (par +
 * stroke index + tee yardage from the snapshot, and a 9-hole course really is
 * 9 holes), else the default 18-hole par-72 layout `unitsFromSchema` falls
 * back to on a null/absent schema. The ONE place Quick Game derives its unit
 * list — every reader (entry, grid, standings, subtitle) goes through this so
 * none of them can disagree about how many holes the round is.
 */
export function quickGameUnits(state: QuickGameState | null): ScoreUnit[] {
  return unitsFromSchema(state?.course?.schema);
}

/**
 * Stroked-hole sets (`pips`) — the shape `ScoreEntryView` / `StandardGrid` /
 * `MatchEntryView` take, computed the way the trip-side views do
 * (`strokeHoles(strokes, strokeIndexOf(units))`).
 *
 * Keyed by whatever the format SCORES as: player id for stroke/rack, side id
 * for match. No course applied ⇒ sequential index; no handicaps ⇒ every set is
 * empty ⇒ net ≡ gross.
 *
 * **Outcome mode still gets pips.** There is no stroke to net there — the
 * outcome IS the decision — but the pip is exactly how players know who is
 * getting a shot on this hole so they can settle it themselves. Computing
 * nothing from it is the point, not a reason to hide it.
 */
export function quickGamePips(state: QuickGameState): Record<string, Set<string>> {
  const scIndex = strokeIndexOf(quickGameUnits(state));
  const m: Record<string, Set<string>> = {};
  const put = (id: string, n: number) => {
    m[id] = new Set([...strokeHoles(effectiveStrokes({ handicap_strokes: n }), scIndex)].map(String));
  };
  if (isMatchGame(state)) {
    put(state.sideA.id, state.sideA.strokes);
    put(state.sideB.id, state.sideB.strokes);
  } else {
    for (const p of state.players) put(p.id, state.strokes[p.id]);
  }
  return m;
}

/** The ids this format scores as — player ids for stroke/rack, side ids for
 *  match. The ONE place that mapping lives, so `scoredParticipantIds`, the pips
 *  and the standings can't disagree about what a "scoring entity" is. */
export function scoringEntityIds(state: QuickGameState): string[] {
  return isMatchGame(state) ? [state.sideA.id, state.sideB.id] : state.players.map((p) => p.id);
}

/** Scoring entities with at least one scored cell — the ONE "has this round
 *  started" predicate. Shared by the subtitle, the roster-edit guard, and
 *  their tests, so none of them derives "started" a second, driftable way
 *  (CLAUDE.md #27's local-storage-scale sibling: there's no DB here, but the
 *  same "don't re-derive it" discipline applies). */
export function scoredParticipantIds(state: QuickGameState): string[] {
  return scoringEntityIds(state).filter((id) => Object.keys(state.values[id] ?? {}).length > 0);
}

/**
 * Whether the round has started — the roster-edit / reset-vs-refuse gate and
 * the "replacing an in-progress round" confirm.
 *
 * **Outcome mode has no `score_entries` twin here, and asking the wrong
 * question would answer no for a match's entire life.** That is CLAUDE.md #27's
 * exact failure ("a score has TWO storage shapes"), reproduced at
 * local-storage scale: an outcome match writes `outcomes`, never `values`, so a
 * `values`-only predicate reports "not started" seventeen holes in. Both
 * sources are folded in here, once.
 */
export function hasAnyScore(state: QuickGameState): boolean {
  if (isMatchGame(state) && Object.keys(state.outcomes).length > 0) return true;
  return scoredParticipantIds(state).length > 0;
}

/**
 * NET standings for the final screen — the fix for the reported bug's shape:
 * before this, the final screen summed raw `values` directly (gross) while
 * the entry screen's running total nets via `pips` (CLAUDE.md #8's exact
 * failure mode — the same divergence #825 fixed on the trip side). Runs the
 * SAME `netStrokeEntries` → `computeStrokePlayStandings` pair every other
 * stroke-play surface in the app runs, over course-aware units so a 9-hole
 * round doesn't look for scores on holes 10–18.
 */
export function quickGameStandings(state: QuickGameState): StrokeStanding[] {
  const units = quickGameUnits(state);
  const pips = quickGamePips(state);
  const rawEntries: RawStrokeEntry[] = [];
  for (const p of state.players) {
    for (const u of units) {
      const v = state.values[p.id]?.[u.label];
      if (v != null) rawEntries.push({ participant_id: p.id, unit_label: u.label, value: v });
    }
  }
  const entries = netStrokeEntries(rawEntries, pips);
  return computeStrokePlayStandings(
    state.players.map((p) => p.id),
    entries
  );
}

// ── Starting a round ─────────────────────────────────────────────────────────

/**
 * Legal player counts per format. Match play is the constrained one: a side
 * holds exactly 1 or 2 players (trip-side `MatchSides.playersPerSide: 1 | 2`),
 * so a match is 2 players or 4 — never 3.
 *
 * THREE PLAYERS IS REFUSED, not benched. Trip-side leaves an unpaired member
 * out of the match, but there you picked them off a roster; here you TYPED
 * their name, so silently dropping them is a worse answer than saying so. And
 * a 3-way match does not exist anywhere in this codebase — inventing one for
 * the local-storage surface is precisely the "two implementations of one idea"
 * this project keeps paying for.
 */
export function quickFormatPlayerCountError(format: QuickGameFormat, count: number): string | null {
  if (format === "match") {
    // §6 REVERSES the earlier refusal ("match play needs 2 or 4"). 1v2 is a
    // real thing people play, and the scorecard concatenates names on a side,
    // so an uneven split needs nothing the even one did not already have. Two
    // players is the floor because a match needs an opponent.
    return count >= 2 ? null : "Match play needs someone to play against.";
  }
  if (format === "rack") {
    return count >= 2 ? null : "Rack n Stack needs at least 2 players.";
  }
  // No message (§4). With one field on screen and Start disabled until it has
  // a name, "add at least one player" told the user what the form already
  // showed them — a warning for a state they cannot help being in on arrival.
  return null;
}

/**
 * Build the two sides from the roster order. 1v1 pairs [0] vs [1]; a 2v2 pairs
 * by the caller's `partnerOf` choice — which of the other three is with player
 * one — and the remaining two become the opposing side. One tap, no matrix.
 */
/**
 * Build the two sides from rows that already CARRY their side (§6).
 *
 * Replaces the partner-picker model, which could only express 1v1 and 2v2 —
 * the same limitation the "match play needs 2 or 4 players" refusal was
 * enforcing. Any split works now, 1v2 included: a side is a slot holding one
 * or more players, which is what the glossary always said, and the scorecard
 * already concatenates names on a side.
 *
 * Null when either side is empty — a match needs an opponent, and that is the
 * only count rule left.
 */
export function buildQuickMatchSides(
  rows: { id: string; side?: "A" | "B" }[]
): { sideA: QuickMatchSide; sideB: QuickMatchSide } | null {
  const mk = (ids: string[]): QuickMatchSide => ({ id: crypto.randomUUID(), playerIds: ids, strokes: 0 });
  const a = rows.filter((r) => r.side !== "B").map((r) => r.id);
  const b = rows.filter((r) => r.side === "B").map((r) => r.id);
  if (a.length === 0 || b.length === 0) return null;
  return { sideA: mk(a), sideB: mk(b) };
}

/** Everything the setup screen collects, in one object — the input to
 *  `buildQuickGameFromDrafts`. */
export interface QuickGameDrafts {
  format: QuickGameFormat;
  players: DraftPlayerRow[];
  course: QuickGameCourse | null;
  bets: SideBetsState;
  /** Match only. */
  entryMode: "score" | "outcome";
  /** Signed relative handicap: <0 → side A receives, >0 → side B. */
  relStrokes: number;
  glorious: boolean;
  gloriousHoles: number;
  gloriousAvailable: boolean;
  /** Rack only. */
  teams: Record<string, Team>;
}

/**
 * Build a playable round from the setup drafts, or null if they do not make
 * one (no named players; a match with an empty side).
 *
 * PURE, and extracted from `buildAndStart` because two surfaces now start a
 * round — the quick-game page and the add sheet the dashboard tile opens
 * (device pass §3). The alternative was the same twenty lines in both, which
 * is how one of them ends up not carrying the bets, or defaulting a modifier
 * the other refuses. Being pure, it is also the half that can be tested
 * without rendering anything.
 */
export function buildQuickGameFromDrafts(d: QuickGameDrafts): QuickGameState | null {
  const roster = buildRosterFromDrafts(d.players);
  if (!roster) return null;
  const common = {
    version: QUICK_GAME_STATE_VERSION,
    players: roster.players,
    course: d.course,
    values: {},
    finished: false,
    currentHole: 1,
    // Bets staged before the round begins come through as-is; the perspective
    // defaults to the first player entered when nothing chose one.
    bets: { ...d.bets, perspectivePlayerId: d.bets.perspectivePlayerId ?? roster.players[0]?.id ?? null },
  };

  if (d.format === "match") {
    // Rows carry their side; `buildRosterFromDrafts` preserves row ids, so the
    // named rows and the built players line up one to one.
    const named = d.players.filter((r) => r.name.trim().length > 0).slice(0, 4);
    const sides = buildQuickMatchSides(named);
    if (!sides) return null;
    // The signed relative value resolves to strokes on exactly ONE side.
    const n = Math.abs(d.relStrokes);
    sides.sideA.strokes = d.relStrokes < 0 ? n : 0;
    sides.sideB.strokes = d.relStrokes > 0 ? n : 0;
    return {
      ...common,
      format: "match",
      entryMode: d.entryMode,
      sideA: sides.sideA,
      sideB: sides.sideB,
      outcomes: {},
      // Only persist the modifier when it can actually apply — `gloriousConfig`
      // would ignore it otherwise, and a stored-but-inert key is the kind of
      // "on but does nothing" state this build is trying not to create.
      modifiers: d.glorious && d.gloriousAvailable ? { glorious_holes: { holes: d.gloriousHoles } } : {},
    };
  }
  if (d.format === "rack") {
    const teams: Record<string, Team> = {};
    for (const p of roster.players) teams[p.id] = d.teams[p.id] ?? "A";
    return { ...common, format: "rack", strokes: roster.strokes, teams };
  }
  return { ...common, format: "stroke", strokes: roster.strokes };
}

// ── Match play ───────────────────────────────────────────────────────────────

/**
 * The LIVE glorious config for a quick match, through the SHARED
 * `gloriousConfig` — which applies both guards for us:
 *   - format: only `gtt_match_play`, so rack/stroke are inert by construction;
 *   - entry mode: `score` returns `NO_GLORIOUS` (you cannot double the value of
 *     a hole whose outcome you never recorded — a measured bug, `75c95f02`).
 * Calling the shared fn rather than reading `modifiers` directly is what stops
 * Quick Play from becoming a second, more permissive implementation of the
 * mechanic.
 */
export function quickMatchGlorious(state: QuickMatchState) {
  return gloriousConfig(QUICK_GAME_TYPE_ID.match, state.modifiers, state.entryMode);
}

/**
 * Whether the Glorious Finishing Holes modifier can be OFFERED at all.
 *
 * Hidden (not disabled) in two cases, both because the mechanic genuinely
 * cannot apply and an inert-but-visible toggle is the silent-wrong failure this
 * codebase keeps finding:
 *   - **score entry** — `gloriousConfig` refuses it (see above);
 *   - **a 9-hole round** — `holeWeight` is `hole > 18 − n` against a hardcoded
 *     `ROUND_HOLES = 18`, so on nine holes NO hole ever clears the bar and the
 *     modifier does exactly nothing. That 18 is deliberate and frozen on the
 *     trip side; making Quick Play's copy relative to round length would fork a
 *     scoring mechanic that has a measured bug behind it, so the honest move is
 *     to not offer what can't work.
 */
export function quickMatchGloriousAvailable(state: {
  entryMode: "score" | "outcome";
  course: QuickGameCourse | null;
}): boolean {
  if (state.entryMode === "score") return false;
  return unitsFromSchema(state.course?.schema).length >= 18;
}

/** The decided holes for a quick match, from WHICHEVER source its entry mode
 *  uses — the two converge on one `DecidedHole[]` exactly as the trip side's do
 *  (Phase 0: nothing downstream can tell them apart). */
export function quickMatchDecided(state: QuickMatchState): DecidedHole[] {
  const units = quickGameUnits(state);
  if (state.entryMode === "outcome") {
    return buildDecidedFromOutcomes(
      Object.entries(state.outcomes)
        .map(([label, result]) => ({ hole: Number(label), result }))
        .filter((r) => Number.isFinite(r.hole) && r.hole >= 1 && r.hole <= units.length)
    );
  }
  const scIndex = strokeIndexOf(units);
  return buildDecided(
    state.values[state.sideA.id] ?? {},
    state.values[state.sideB.id] ?? {},
    state.sideA.strokes,
    state.sideB.strokes,
    scIndex,
    units.length
  );
}

/** The live match state — the ONE frozen `matchState`, weighted by the shared
 *  glorious config. Everything that reports on a quick match (the strip, the
 *  dashboard card, the rail, the final screen) reads THIS, so they cannot
 *  disagree about who is up. */
export function quickMatchState(state: QuickMatchState): MatchState {
  const units = quickGameUnits(state);
  return matchState(quickMatchDecided(state), units.length, quickMatchGlorious(state));
}

/** A side's display name — the players' first names, joined. "Zach" for a 1v1,
 *  "Zach & Brad" for a 2v2. */
export function quickSideName(state: QuickMatchState, side: QuickMatchSide): string {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const names = side.playerIds.map((id) => byId.get(id)?.name.split(/\s+/)[0] ?? "Player");
  return names.join(" & ") || "Side";
}

/** The ONE match id a quick round has. Stable (derived from the side ids, which
 *  are minted once at setup) so `OutcomeValues`' match-keyed map survives a
 *  reload without storing a redundant field. */
export const quickMatchId = (state: QuickMatchState) => `${state.sideA.id}:${state.sideB.id}`;

/**
 * The quick match as the `MatchGroupData` the SHARED entry views take — the
 * adapter, and the only place Quick Play's state shape meets the trip-side
 * component contract. Both `MatchEntryView` (score) and `MatchOutcomeEntryView`
 * (outcome) consume this, so neither view learns anything about Quick Play
 * (the don't-couple constraint) and neither mode gets its own second adapter.
 *
 * `aPlayers`/`bPlayers` is what makes a 2v2 render as two stacked chips rather
 * than a collapsed single name — the field that already existed for exactly
 * this (Phase 0 T0.3) and needs no play_group to populate.
 */
export function quickMatchGroupData(state: QuickMatchState): {
  matchId: string;
  label: string;
  a: Participant;
  b: Participant;
  aPlayers: { id: string; name: string }[];
  bPlayers: { id: string; name: string }[];
  strokesA: number;
  strokesB: number;
} {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const chips = (side: QuickMatchSide) =>
    side.playerIds.map((id) => ({ id, name: byId.get(id)?.name ?? "Player" }));
  const asParticipant = (side: QuickMatchSide, i: number): Participant => ({
    id: side.id,
    name: quickSideName(state, side),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
  });
  return {
    matchId: quickMatchId(state),
    label: "Match",
    a: asParticipant(state.sideA, 0),
    b: asParticipant(state.sideB, 1),
    aPlayers: chips(state.sideA),
    bPlayers: chips(state.sideB),
    strokesA: state.sideA.strokes,
    strokesB: state.sideB.strokes,
  };
}

// ── Rack n Stack ─────────────────────────────────────────────────────────────

/**
 * The racked slots + team points, through the SHARED `computeRack`.
 *
 * Always `"current"` mode, never `"projected"`: `projectedNetToPar` normalizes
 * with a hardcoded `× 18`, so on a 9-hole quick round the projection would be
 * silently doubled. Current mode has no such term. (The trip-side board offers
 * the toggle because its rounds are 18.)
 */
export function quickRackResult(state: QuickRackState): RackResult {
  const units = quickGameUnits(state);
  const scIndex = strokeIndexOf(units);
  const par = units.map((u) => u.par ?? 0);
  const coursePar = par.reduce((a, b) => a + b, 0);
  const players: RackPlayer[] = state.players.map((p) => ({
    id: p.id,
    team: state.teams[p.id] ?? "A",
    stats: playerStats(state.values[p.id] ?? {}, effectiveStrokes({ handicap_strokes: state.strokes[p.id] }), par, scIndex),
  }));
  return computeRack(players, "current", coursePar);
}

const DEFAULT_SUBTITLE = "Keep score right now — no trip needed";

/** The saved round's display TITLE — the ONE place this string is decided.
 *  Before the T0.4 sweep, five separate sites hardcoded "Quick Stroke Play":
 *  the dashboard card, the rail's summary, the setup `<h1>`, the in-game app-bar
 *  `gameName` and the settings-panel title. Each would have announced a match as
 *  stroke play. They all read this now. */
export function quickGameTitle(state: QuickGameState | null): string {
  return QUICK_GAME_LABEL[state?.format ?? "stroke"];
}

/**
 * The dashboard card / rail subtitle for the current quick round.
 *
 * FORMAT-AWARE — this is the reader Phase 0 named as lying: it computed stroke
 * standings ("Zach leading at −1 thru 2") for whatever was saved, so a match
 * would have been described in a vocabulary that cannot express it. A match
 * wants "2 UP thru 5"; a rack wants the team score.
 *
 * Shared shape across all three: no saved game → the pitch line; saved but
 * unscored → "Hole N of {units.length} · no scores yet" (in progress starts at
 * CREATION, not at first score — a round with players and no scores must not
 * name a leader), unit count COURSE-driven so a 9-hole round reads "of 9".
 */
export function quickGameSubtitle(state: QuickGameState | null): string {
  if (!state) return DEFAULT_SUBTITLE;

  const units = quickGameUnits(state);
  if (!hasAnyScore(state)) {
    return `Hole ${state.currentHole} of ${units.length} · no scores yet`;
  }
  if (isMatchGame(state)) return quickMatchSubtitle(state);
  if (isRackGame(state)) return quickRackSubtitle(state);
  return quickStrokeSubtitle(state, units);
}

/**
 * Match: the running state in match-play vocabulary — "2 UP thru 5", "AS thru
 * 5", or the closing margin ("3&2") once decided. Reads the SHARED
 * `quickMatchState`, so the card, the rail and the in-game strip cannot
 * disagree about who is up.
 */
function quickMatchSubtitle(state: QuickMatchState): string {
  const st = quickMatchState(state);
  if (st.over && st.margin) {
    const winner = st.leader === "A" ? state.sideA : st.leader === "B" ? state.sideB : null;
    return winner ? `${quickSideName(state, winner)} won ${st.margin}` : `Halved after ${st.thru}`;
  }
  if (st.diff === 0) return `All square thru ${st.thru}`;
  const leadSide = st.leader === "A" ? state.sideA : state.sideB;
  const dormie = st.dormie ? " · dormie" : "";
  return `${quickSideName(state, leadSide)} ${st.up} up thru ${st.thru}${dormie}`;
}

/** Rack: the team score from the SHARED `computeRack` — "Team A leads 3–2". */
function quickRackSubtitle(state: QuickRackState): string {
  const { points } = quickRackResult(state);
  const thru = Math.max(
    0,
    ...state.players.map((p) => Object.keys(state.values[p.id] ?? {}).length)
  );
  if (points.A === points.B) return `Tied ${fmtPointsPair(points.A, points.B)} thru ${thru}`;
  const lead = points.A > points.B ? "Team A" : "Team B";
  const hi = Math.max(points.A, points.B);
  const lo = Math.min(points.A, points.B);
  return `${lead} leads ${fmtPointsPair(hi, lo)} thru ${thru}`;
}

/** Rack points are half-points on a halved slot, so 2.5 must not render "2.5–1"
 *  as "2.5-1" in one place and "2½" in another. One formatter, both numbers. */
function fmtPointsPair(x: number, y: number): string {
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return `${f(x)}–${f(y)}`;
}

/**
 * Stroke: "Zach leading at +7 thru 8" / "Tied at +7 thru 8".
 *
 * The "who's leading" determination reuses `computeStrokePlayStandings` fed by
 * `netStrokeEntries` over `quickGamePips` — the SAME two calls `ScoreEntryView`'s
 * running total and "Leading" badge run (#825, so a handicap game's total can't
 * crown a different player than the standings).
 *
 * `toPar` / `thru` are DISPLAY figures computed on top of whichever entityId the
 * shared call already named the leader — they don't participate in deciding WHO
 * leads, only in describing them, so they can't be the source of a disagreement
 * with the entry screen's own badge.
 */
function quickStrokeSubtitle(state: QuickStrokeState, units: ScoreUnit[]): string {
  const scoredIds = scoredParticipantIds(state);
  const pips = quickGamePips(state);
  const rawEntries: RawStrokeEntry[] = [];
  for (const p of state.players) {
    for (const u of units) {
      const v = state.values[p.id]?.[u.label];
      if (v != null) rawEntries.push({ participant_id: p.id, unit_label: u.label, value: v });
    }
  }
  const entries = netStrokeEntries(rawEntries, pips);
  const standings = computeStrokePlayStandings(scoredIds, entries);
  const leaders = standings.filter((s) => s.position === 1);
  if (leaders.length === 0) return DEFAULT_SUBTITLE; // unreached — scoredIds.length > 0 guarantees a position 1

  const parByLabel = new Map(units.map((u) => [u.label, u.par ?? 0]));
  const leaderId = leaders[0].entityId;
  const leaderScoredLabels = Object.keys(state.values[leaderId] ?? {});
  const thru = leaderScoredLabels.length;
  const parSum = leaderScoredLabels.reduce((sum, label) => sum + (parByLabel.get(label) ?? 0), 0);
  const toPar = fmtToPar(leaders[0].rawScore - parSum);

  if (leaders.length > 1) {
    return `Tied at ${toPar} thru ${thru}`;
  }
  const name = state.players.find((p) => p.id === leaderId)?.name.split(/\s+/)[0] ?? "Leader";
  return `${name} leading at ${toPar} thru ${thru}`;
}

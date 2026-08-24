import {
  computeStrokePlayStandings,
  netStrokeEntries,
  type RawStrokeEntry,
  type StrokeStanding,
} from "@/lib/strokePlay";
import { strokeHoles } from "@/lib/matchPlay";
import { clampStrokes, effectiveStrokes } from "@/lib/handicap";
import { fmtToPar } from "@/lib/rackNStack";
import { unitsFromSchema, strokeIndexOf, PLAYER_COLORS } from "@/lib/strokePlayConfig";
import type { ScorecardSchema } from "@/lib/courseIndex";
import type { Participant, ScoreUnit, ScoreValues } from "@/components/games/types";

/**
 * Quick Stroke Play's local-storage state shape + the read/derive helpers
 * shared by the page (`app/quick-game/page.tsx`) and the dashboard card, which
 * needed `QuickGameState` + the subtitle deriver without importing a page
 * component. Split out of the page originally for that reason (#879); course
 * selection + handicaps (Phase 0/1) extended it in place.
 *
 * The page remains the only WRITER (via `localStorage.setItem`); this module
 * only reads and derives — including the netting math, so a handicap game
 * can't disagree between the dashboard card, the entry screen, and the final
 * standings (CLAUDE.md #8, the same discipline the trip-side game views use).
 */
export const QUICK_GAME_STORAGE_KEY = "bt-quick-game";

/**
 * Bump when `QuickGameState`'s shape changes. `migrateQuickGameState` is the
 * ONE place that reads an on-disk payload of any past version and normalizes
 * it — crew have in-progress rounds in local storage across a deploy, so a
 * bare `JSON.parse(raw) as QuickGameState` is not safe once the shape grows
 * (course/strokes below were added after ship; the next addition gets the
 * same treatment here, not a second ad-hoc reader).
 */
export const QUICK_GAME_STATE_VERSION = 2;

/** A course applied to the round — captured, not referenced (Phase 0 T0.3):
 *  the par/index/tee facts are fetched once at selection and frozen into
 *  `schema` via the shared `buildCourseSnapshot`, so the scorecard renders
 *  with no further network — a round survives losing signal mid-course. */
export interface QuickGameCourse {
  id: string;
  name: string;
  teeName?: string;
  schema: ScorecardSchema;
}

export interface QuickGameState {
  version: number;
  players: Participant[];
  values: ScoreValues;
  finished: boolean;
  currentHole: number;
  /** null = no course selected — the default 18-hole par-72 layout. */
  course: QuickGameCourse | null;
  /** { [playerId]: handicapStrokes }. Absent player ⇒ 0 (scratch). Per-round,
   *  per-player — there is no user record to hang it on (typed names). */
  strokes: Record<string, number>;
}

/** One editable roster row — the shared shape for both the pre-start setup
 *  screen and the post-start roster editor (§1/§2), so "start a game" and
 *  "save an edited roster" build a `{players, strokes}` pair the identical way
 *  and can't drift into two floor/cap rules. */
export interface DraftPlayerRow {
  id: string;
  name: string;
  strokes: number;
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
 * `strokes` fields) is the common case this guards — it must load as a
 * scratch, no-course round rather than fail or half-populate. Returns null for
 * anything that isn't recognizably a Quick Game state at all (corrupt JSON is
 * already caught by the caller's try/catch; this catches a wrong SHAPE).
 */
export function migrateQuickGameState(raw: unknown): QuickGameState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.players)) return null;
  if (typeof r.values !== "object" || r.values === null) return null;
  const course =
    r.course && typeof r.course === "object" ? (r.course as QuickGameCourse) : null;
  const strokes =
    r.strokes && typeof r.strokes === "object" && r.strokes !== null
      ? (r.strokes as Record<string, number>)
      : {};
  const currentHole =
    typeof r.currentHole === "number" && r.currentHole > 0 ? r.currentHole : 1;
  return {
    version: QUICK_GAME_STATE_VERSION,
    players: r.players as Participant[],
    values: r.values as ScoreValues,
    finished: r.finished === true,
    currentHole,
    course,
    strokes,
  };
}

/** Client-only. Returns null on no saved game, corrupt JSON, an unrecognized
 *  shape, or SSR. */
export function readQuickGameState(): QuickGameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUICK_GAME_STORAGE_KEY);
    if (!raw) return null;
    return migrateQuickGameState(JSON.parse(raw));
  } catch {
    return null;
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
 * Per-player stroked-hole sets (`pips`) — the same shape `ScoreEntryView` /
 * `StandardGrid` take, computed the same way the trip-side stroke game does
 * (`strokeHoles(effectiveStrokes(p), strokeIndexOf(units))`). Quick Game has
 * no course applied ⇒ every set is empty ⇒ net ≡ gross, unchanged from before
 * handicaps existed.
 */
export function quickGamePips(state: QuickGameState): Record<string, Set<string>> {
  const scIndex = strokeIndexOf(quickGameUnits(state));
  const m: Record<string, Set<string>> = {};
  for (const p of state.players) {
    const n = effectiveStrokes({ handicap_strokes: state.strokes[p.id] });
    m[p.id] = new Set([...strokeHoles(n, scIndex)].map(String));
  }
  return m;
}

/** Participant ids with at least one scored cell — the ONE "has this round
 *  started" predicate. Shared by the subtitle, the roster-edit guard, and
 *  their tests, so none of them derives "started" a second, driftable way
 *  (CLAUDE.md #27's local-storage-scale sibling: there's no DB here, but the
 *  same "don't re-derive it" discipline applies). */
export function scoredParticipantIds(state: QuickGameState): string[] {
  return state.players
    .filter((p) => Object.keys(state.values[p.id] ?? {}).length > 0)
    .map((p) => p.id);
}

/** Whether ANY player has a scored cell — the roster-edit / reset-vs-refuse
 *  gate. False the whole time a round is set up but unscored, true the moment
 *  the first cell is tapped (mirrors "Live" elsewhere in the glossary: first
 *  score flips it). */
export function hasAnyScore(state: QuickGameState): boolean {
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

const DEFAULT_SUBTITLE = "Keep score right now — no trip needed";

/**
 * The dashboard card's subtitle for the current Quick Stroke Play state.
 *
 * Four states (in order of precedence):
 *   1. No saved game               → the always-available pitch line.
 *   2. Game exists, no scores yet  → "Hole N of {units.length} · no scores
 *      yet". "In progress" starts at CREATION, not at first score — a game
 *      with players and no scores must not name a leader. Unit count is
 *      COURSE-driven (`quickGameUnits`), so a 9-hole round reads "Hole N of 9"
 *      rather than always "of 18".
 *   3. Someone leading             → "Zach leading at +7 thru 8".
 *   4. Tied                        → "Tied at +7 thru 8" (no name — more than
 *      one player shares position 1).
 *
 * The "who's leading" determination reuses `computeStrokePlayStandings` fed by
 * `netStrokeEntries` over `quickGamePips` — the SAME two calls `ScoreEntryView`'s
 * running total and "Leading" badge run (#825, so a handicap game's total can't
 * crown a different player than the standings), now genuinely netting a
 * handicap round instead of always calling `netStrokeEntries(raw, {})`
 * (the second reader Phase 0 found already computing gross).
 *
 * `toPar` / `thru` are DISPLAY figures computed on top of whichever entityId the
 * shared call already named the leader — they don't participate in deciding WHO
 * leads, only in describing them, so they can't be the source of a disagreement
 * with the entry screen's own badge.
 */
export function quickGameSubtitle(state: QuickGameState | null): string {
  if (!state) return DEFAULT_SUBTITLE;

  const scoredIds = scoredParticipantIds(state);
  const units = quickGameUnits(state);

  if (scoredIds.length === 0) {
    return `Hole ${state.currentHole} of ${units.length} · no scores yet`;
  }

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

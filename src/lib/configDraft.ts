/**
 * Pure, client-safe game-config draft helpers (Game Settings: Draft-Then-Save, P1).
 *
 * The settings page becomes ONE composite client draft covering the WHOLE page —
 * matches, modifiers, points, course, entry mode, name, rules, delegates, and the
 * `scoring_enabled` flag. Nothing commits to the server until Save. This module is
 * the pure core of that model (no React / tRPC / DB), mirroring `travelForm.ts`'s
 * trio shape so the draft logic is unit-testable and shared:
 *
 *   - `configToDraft`        server snapshot → editable draft (the baseline)
 *   - `configDraftToPayload` draft → the atomic `save_game_config` RPC payload
 *   - `configDraftsEqual`    pure equality (drives the dirty / Save-enabled gate)
 *
 * Why it matters (the two-store hazard, spec §1): today six settings rows derive
 * from TWO backing stores (local draft + `serverMatches`) and it only works
 * because the single-open accordion force-commits between rows. Under multi-open +
 * draft-then-save, EVERY cross-row derivation must read the draft. This module is
 * the one draft those derivations read.
 *
 * The per-match point-value override lives ON the match (`pointValue`), not in a
 * separate map keyed by server match id — a not-yet-saved match has no server id,
 * and co-locating the override with its match keeps it correct across reorder /
 * add / remove. The even-share `points_distribution.value` is DERIVED at payload
 * time from `{ total, overrides, matchCount }` via the shared `evenShare` (never
 * snapshotted), so entering a match can't leave a stale share behind.
 */

import { evenShare, type PointsDistribution } from "./pointsDistribution";
import { isMatchPlayFormat } from "./gameRoutes";
import type { ModifiersMap } from "./modifiers";

/** A match inside the composite draft. Extends the pairing shape (`DraftMatch`)
 *  with the per-match point-value override (A2b) so Points derives from the draft,
 *  not `serverMatches`. `handicap` is signed: <0 → side A gets |n| strokes, >0 →
 *  side B gets n, 0 → even. */
export interface DraftMatchConfig {
  matchNumber: number;
  /** Per-match shape (A2a): 1 = 1v1, 2 = 2v2. FILLED ⟺ both sides carry exactly
   *  this many members. */
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  handicap: number;
  /** Per-match points override (`game_matches.point_value`); null = take the even
   *  share. Keyed to the match itself, NOT a server id (draft matches have none). */
  pointValue: number | null;
}

/** The whole settings page as one editable object. Every settings row reads and
 *  writes THIS — no row reads `serverMatches` directly (spec §1). */
export interface ConfigDraft {
  /** The game's format id — READ-ONLY context, never edited (so it's excluded from
   *  the dirty check). Drives the points model: a match-play draft derives a
   *  `per_match` even share from the total. */
  gameTypeId: string | null;
  name: string;
  rulesForToday: string | null;
  /** A draft FIELD (spec §2.7-2): Save commits the config AND goes live / disables
   *  in one action. Not a separate transaction. */
  scoringEnabled: boolean;
  /** `games.entry_mode` — "score" (gross entry) vs "outcome" (hole winner). */
  entryMode: string;
  modifiers: ModifiersMap;
  matches: DraftMatchConfig[];
  /** `points_total` — the owner-set pool; the per-match even share is derived. */
  pointsTotal: number | null;
  /** The persisted distribution shape (its `.value` is recomputed on Save for
   *  match play; a `placement` array is authored as-is). Null before any points
   *  are set. */
  pointsDistribution: PointsDistribution | null;
  course: {
    id: string | null;
    /** `games.back_course_id` — the composed two-nines 18's BACK course (W-9HOLE-01);
     *  null for a real 18 or a lone 9-hole front. Drafted alongside `id` because the
     *  row's front/back/needs-a-back state reads it: persisting the composed schema
     *  without it would strand the back-nine identity (and a stale ref would render a
     *  phantom back nine against an unrelated course). */
    backId: string | null;
    /** Snapshotted `scorecard_schema` (par[] / handicap_index[] frozen in
     *  `units.metadata`). Recomputed by the UI when the course changes; this
     *  module only carries it through. */
    scorecardSchema: unknown | null;
  };
  /** `game_delegates` user ids (per-game organizers). */
  delegates: string[];
}

/** The pre-resolved match shape `configToDraft` consumes — the caller
 *  (MatchGameView) resolves play-group sides → member-id lists and the signed
 *  handicap before handing them here, so this module stays free of play-group
 *  plumbing. */
export interface DraftMatchInput {
  matchNumber: number;
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  handicap: number;
  pointValue: number | null;
}

/** The `games`-row fields the draft baseline reads (a subset of `getById`). */
export interface ConfigGameSnapshot {
  game_type_id?: string | null;
  name?: string | null;
  rules_for_today?: string | null;
  scoring_enabled?: boolean | null;
  entry_mode?: string | null;
  modifiers?: ModifiersMap | null;
  points_total?: number | null;
  points_distribution?: PointsDistribution | null;
  course_id?: string | null;
  back_course_id?: string | null;
  scorecard_schema?: unknown | null;
}

/**
 * Build the editable draft (and the dirty-check BASELINE) from the server
 * snapshot. A wholly-unset field takes its neutral default (empty name, no rules,
 * not scoring, gross entry, no modifiers, no points). Deterministic and total so
 * `configDraftsEqual(configToDraft(x), configToDraft(x))` is always true.
 */
export function configToDraft(
  game: ConfigGameSnapshot,
  matches: DraftMatchInput[],
  delegates: string[]
): ConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    scoringEnabled: game.scoring_enabled ?? false,
    entryMode: game.entry_mode ?? "score",
    modifiers: game.modifiers ?? {},
    matches: matches.map((m) => ({
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      handicap: m.handicap,
      pointValue: m.pointValue,
    })),
    pointsTotal: game.points_total ?? null,
    pointsDistribution: game.points_distribution ?? null,
    course: {
      id: game.course_id ?? null,
      backId: game.back_course_id ?? null,
      scorecardSchema: game.scorecard_schema ?? null,
    },
    delegates: [...delegates].sort(),
  };
}

/** True when both sides carry exactly the match's own `playersPerSide` players —
 *  the only matches that get written on Save (an unfilled slot is an unfinished
 *  add, never persisted). */
export function isDraftMatchFilled(m: DraftMatchConfig): boolean {
  return m.a.length === m.playersPerSide && m.b.length === m.playersPerSide;
}

// ── Payload (the `save_game_config` RPC contract) ────────────────────────────

/** One match row the RPC writes. Sides are member-id lists (a 2v2 side becomes a
 *  play_group of those members); the signed draft handicap is pre-distributed into
 *  per-side stroke counts so the plpgsql writer stays a dumb transactional writer
 *  (spec §2.2 Design A — no derivation in SQL). */
export interface SaveMatchRow {
  matchNumber: number;
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  /** Strokes GIVEN to side A / side B (exactly one is non-zero, or both 0). */
  strokesA: number;
  strokesB: number;
  /** `game_matches.point_value` — the resolved override, or null for even share. */
  pointValue: number | null;
}

/** The atomic-Save payload (design A). The client pre-computes everything derived
 *  — filled-match filter, handicap distribution, the even-share
 *  `points_distribution.value` — so the RPC only does the all-or-nothing multi-
 *  table write. */
export interface SaveConfigPayload {
  name: string;
  rulesForToday: string | null;
  scoringEnabled: boolean;
  entryMode: string;
  modifiers: ModifiersMap;
  pointsTotal: number | null;
  pointsDistribution: PointsDistribution | null;
  courseId: string | null;
  /** `games.back_course_id` — written in lockstep with `courseId`/`scorecardSchema`
   *  so a composed two-nines 18 round-trips (and clearing the course clears it). */
  backCourseId: string | null;
  scorecardSchema: unknown | null;
  delegates: string[];
  matches: SaveMatchRow[];
  /**
   * Did the match SET (structure: which matches, each side's roster, the shape)
   * change vs the state the draft was seeded from? — NOT whether a per-match FIELD
   * (handicap / pointValue) changed.
   *
   * True  → the RPC clean-replaces matches/participants/play_groups (mints fresh
   *         UUIDs). REFUSED once scores exist (`HAS_SCORES`) — the new ids would
   *         orphan the score rows.
   * False → the RPC does NOT clean-replace. It instead writes the per-match FIELDS
   *         in place (game_matches.point_value + side handicap_strokes), keyed to the
   *         surviving rows by match_number — allowed WITH scores (the warned tier).
   *
   * So a handicap or point-override edit on a scored game (same set, field differs)
   * reports False here and persists in place; adding/removing a player or a match
   * reports True and is refused with scores. A client that under-reports gets its
   * structural edits silently written in-place-only (safe-ish); over-reports gets
   * refused (safe). Was `matchesDirty` — renamed when the structure/field split
   * landed (migration 084).
   */
  matchesStructureDirty: boolean;
}

/** Split a signed handicap into per-side stroke counts (<0 → A gets |n|; >0 → B
 *  gets n; 0 → even). Mirrors `setHandicap`'s recipient resolution. */
export function splitHandicap(signed: number): { strokesA: number; strokesB: number } {
  if (signed < 0) return { strokesA: -signed, strokesB: 0 };
  if (signed > 0) return { strokesA: 0, strokesB: signed };
  return { strokesA: 0, strokesB: 0 };
}

/**
 * Convert the draft into the atomic RPC payload. ONLY fully-filled matches are
 * written (an unfinished add never persists — same rule the setup gate enforces).
 *
 * The match-play even share is recomputed here from the FINAL draft
 * (`evenShare(total, overrides, filledCount)`) and folded into
 * `points_distribution.value`, so the persisted fallback award can't lag a match
 * add/remove. It is ESTABLISHED here too, not just refreshed: a first-setup game
 * has `points_distribution = null`, and the reconcile effect that used to seed it
 * is gone — without this, a first Save would write a total with nothing to award
 * against (`point_value ?? points_distribution.value` → null). A `placement`
 * distribution is authored explicitly and passed through untouched.
 *
 * Pass `baseline` (the draft as seeded from the server) to report `matchesDirty`
 * honestly; omit it and the payload conservatively claims the matches changed.
 */
export function configDraftToPayload(draft: ConfigDraft, baseline?: ConfigDraft): SaveConfigPayload {
  const filled = draft.matches.filter(isDraftMatchFilled);
  const matches: SaveMatchRow[] = filled.map((m) => {
    const { strokesA, strokesB } = splitHandicap(m.handicap);
    return {
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      strokesA,
      strokesB,
      pointValue: m.pointValue,
    };
  });

  // Match play derives its per_match share from the total — establish it when it's
  // absent (first setup) as well as refresh it. Anything else (a placement payout)
  // is authored, so leave it alone.
  let distribution = draft.pointsDistribution;
  if (
    draft.pointsTotal != null &&
    isMatchPlayFormat(draft.gameTypeId) &&
    (distribution == null || distribution.type === "per_match")
  ) {
    const overrides = filled.map((m) => m.pointValue).filter((v): v is number => v != null);
    distribution = { type: "per_match", value: evenShare(draft.pointsTotal, overrides, filled.length) };
  }

  return {
    name: draft.name.trim(),
    rulesForToday: draft.rulesForToday?.trim() || null,
    scoringEnabled: draft.scoringEnabled,
    entryMode: draft.entryMode,
    modifiers: draft.modifiers,
    pointsTotal: draft.pointsTotal,
    pointsDistribution: distribution,
    courseId: draft.course.id,
    backCourseId: draft.course.backId,
    scorecardSchema: draft.course.scorecardSchema,
    delegates: [...draft.delegates].sort(),
    matches,
    // ONLY structure gates the clean-replace now — a field-only edit (handicap /
    // point override) reports false and the RPC writes it in place.
    matchesStructureDirty: baseline ? !matchesStructureEqual(draft.matches, baseline.matches) : true,
  };
}

// ── Dirty check ──────────────────────────────────────────────────────────────

/**
 * A match row splits into TWO kinds of change, and they persist completely
 * differently — `matchesDirty` used to conflate them, which is why editing a
 * handicap or a point override on a scored game was wrongly refused:
 *
 *  - STRUCTURE (`matchesStructureEqual`) = the SET: which matches exist, each side's
 *    roster, the shape. A change here has no stable row identity to update, so the
 *    RPC clean-replaces (mints fresh UUIDs) — which orphans score rows. Correctly
 *    REFUSED once scores exist (`HAS_SCORES`).
 *  - FIELDS (`matchFieldsEqual`) = values on rows that AREN'T going anywhere: the
 *    per-side `handicap` and the per-match `pointValue`. The set is identical, so
 *    these persist via an in-place `UPDATE` — allowed with scores (the WARNED tier:
 *    results recalculate, nothing is orphaned). Only meaningful when structure is
 *    equal (same rows to update); it's not a substitute for upsert-by-identity,
 *    which handles "set changed but some rows survive" — this is "set is identical."
 */
function matchesStructureEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i];
    return (
      m.matchNumber === n.matchNumber &&
      m.playersPerSide === n.playersPerSide &&
      arraysEqual(m.a, n.a) &&
      arraysEqual(m.b, n.b)
    );
  });
}

/** FIELDS equality — assumes structure already matches (compares position-wise). */
function matchFieldsEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.handicap === b[i].handicap && m.pointValue === b[i].pointValue);
}

/** The whole-match dirty check (drives the Save-enabled gate) — dirty if EITHER
 *  structure or fields differ. */
function matchesEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  return matchesStructureEqual(a, b) && matchFieldsEqual(a, b);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Pure whole-page equality — drives the Save-enabled / dirty indicator (mirrors
 * `travelFormsEqual`). Compares the semantic content of every drafted field.
 * `name`/`rules` compare trimmed (trailing whitespace isn't a change); modifiers
 * and the distribution compare via canonical JSON (key-order-independent);
 * delegates compare order-independently (sorted at both build sites).
 */
export function configDraftsEqual(a: ConfigDraft, b: ConfigDraft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    (a.rulesForToday?.trim() || "") === (b.rulesForToday?.trim() || "") &&
    a.scoringEnabled === b.scoringEnabled &&
    a.entryMode === b.entryMode &&
    a.pointsTotal === b.pointsTotal &&
    a.course.id === b.course.id &&
    a.course.backId === b.course.backId &&
    canonical(a.modifiers) === canonical(b.modifiers) &&
    canonical(a.pointsDistribution) === canonical(b.pointsDistribution) &&
    canonical(a.course.scorecardSchema) === canonical(b.course.scorecardSchema) &&
    arraysEqual(a.delegates, b.delegates) &&
    matchesEqual(a.matches, b.matches)
  );
}

/** Stable, key-order-independent JSON (same idea as `configHash.ts`'s
 *  `canonicalize`) so `{a:1,b:2}` and `{b:2,a:1}` compare equal. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

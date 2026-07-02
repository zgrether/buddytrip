/**
 * Shared types for the gaming-engine scorecard UI (Slice A).
 *
 * These are persistence-agnostic — the same shapes feed a DB-backed trip game
 * (tRPC) and, later (Slice A2), a local-storage Quick Game. Components take data
 * via props and emit changes via callbacks; they never touch the DB themselves.
 */

export interface ScoreUnit {
  /** "1".."18" for golf holes — comes from `scorecard_schema.units.labels`. */
  label: string;
  /** Section bucket from `scorecard_schema.scoring.sections` (front/back-9). */
  section?: "front" | "back";
  /** Par for this hole — drives GolfCard par-relative coloring (Slice C). */
  par?: number;
  /** Stroke (handicap) index, 1 = hardest. From `metadata.handicap_index[]`;
   *  shown in the GolfCard INDEX row and (with a course) allocates strokes. */
  strokeIndex?: number;
  /** Yardage for the configured tee on this hole — from `metadata.tee.yards[]`.
   *  Informational only (display); does not affect scoring. */
  yardage?: number | null;
}

export interface Participant {
  /** participantId used as the key in ScoreValues (a user_id in Slice A). */
  id: string;
  name: string;
  /** Player/team identity color (any CSS color). */
  color: string;
  /** Tabler icon id from the user's profile (optional; falls back to initials). */
  avatarIcon?: string | null;
}

/** { [participantId]: { [unitLabel]: value } } */
export type ScoreValues = Record<string, Record<string, number>>;

/** Slice A is always low_wins; typed so later strategies can extend. */
export type ScoreDirection = "low_wins";

/**
 * Per-cell save lifecycle (Connectivity Layer 1). A score lives optimistically
 * in local state the instant it's tapped; this tracks whether the WRITE behind
 * it landed, so a failed save is VISIBLE on the cell instead of silently
 * vanishing. `error` cells keep their entered value — flagged, retryable, never
 * rolled back to blank.
 */
export type CellSaveState = "saving" | "saved" | "error";

/** { [scoreCellKey]: state } — keyed by `${participantId}:${unitLabel}`. */
export type SaveStatusMap = Record<string, CellSaveState>;

/** Cell key for SaveStatusMap. participantIds are uuids and unit labels never
 *  contain a colon, so a colon join is unambiguous and round-trips. */
export function scoreCellKey(participantId: string, unitLabel: string): string {
  return `${participantId}:${unitLabel}`;
}

/** Inverse of {@link scoreCellKey} — split on the FIRST colon (the uuid side
 *  has none, so this is safe). */
export function parseScoreCellKey(key: string): {
  participantId: string;
  unitLabel: string;
} {
  const i = key.indexOf(":");
  return { participantId: key.slice(0, i), unitLabel: key.slice(i + 1) };
}

/**
 * Confirmation gate (Spec 1a — honest advance). A hole is safe to advance/finish
 * PAST only when none of its cells is mid-save (`saving`) or failed (`error`) —
 * i.e. every entered value is CONFIRMED on the server, not merely optimistic in
 * local state. A cell with NO status entry is a server-loaded / already-confirmed
 * value (seeded via `setValues` without a status), so it does NOT block — only
 * `saving` and `error` block. Pure + unit-tested; both entry views gate on it.
 */
export function unconfirmedOnHole(
  saveStatus: SaveStatusMap,
  participantIds: string[],
  unitLabel: string,
): { blocked: boolean; saving: number; errored: number } {
  let saving = 0;
  let errored = 0;
  for (const pid of participantIds) {
    const s = saveStatus[scoreCellKey(pid, unitLabel)];
    if (s === "saving") saving++;
    else if (s === "error") errored++;
  }
  return { blocked: saving > 0 || errored > 0, saving, errored };
}

/**
 * Game-wide unconfirmed tally (Spec 1a) — the pre-Finish gate. `finish` computes
 * results from server `score_entries`, so ANY cell still `saving`/`error` would be
 * silently omitted from standings — block Finish until all are confirmed.
 */
export function unconfirmedCount(saveStatus: SaveStatusMap): {
  saving: number;
  errored: number;
  total: number;
} {
  let saving = 0;
  let errored = 0;
  for (const s of Object.values(saveStatus)) {
    if (s === "saving") saving++;
    else if (s === "error") errored++;
  }
  return { saving, errored, total: saving + errored };
}

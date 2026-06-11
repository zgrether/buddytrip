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
}

export interface Participant {
  /** participantId used as the key in ScoreValues (a user_id in Slice A). */
  id: string;
  name: string;
  /** 1–2 chars for the avatar circle. */
  initials: string;
  /** Player/team identity color (any CSS color). */
  color: string;
  /** Tabler icon id from the user's profile (optional; falls back to initials). */
  avatarIcon?: string | null;
}

/** { [participantId]: { [unitLabel]: value } } */
export type ScoreValues = Record<string, Record<string, number>>;

/** Slice A is always low_wins; typed so later strategies can extend. */
export type ScoreDirection = "low_wins";

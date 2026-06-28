/**
 * Course provenance read layer (W-GAMEPAGE P-F0) — PURE, client-safe.
 *
 * The per-game snapshot (`scorecard_schema…metadata.tee`) is flattened to ONE tee,
 * but the global `courses` table keeps everything (`name`, `tee_sets` = all tees
 * with per-hole `yards[]`) and the game stores `course_id` + `back_course_id`. So
 * the data P-F's split-band header + multi-tee rows need is RECOVERABLE by ID — these
 * pure fns do the recovery/derivation, given the fetched course records as input (no
 * DB deps → testable). NOTHING here is persisted back into the snapshot (P-F0 is a
 * read-side derivation: derive-don't-snapshot).
 *
 * Back-compat is load-bearing: a game composed before P-F0a has NO `backTeeName` —
 * the back tee name falls back to the composed/front tee name; never undefined/crash.
 */

import type { TeeSetRecord } from "@/lib/courseService";

/** A course record as far as provenance needs it (subset of `courses.getById`). */
export interface ProvenanceCourse {
  name: string;
  teeSets: TeeSetRecord[];
}

/** The snapshot bits provenance reads (subset of `scorecard_schema.units.metadata`). */
export interface ProvenanceSnapshot {
  /** The composed/chosen tee name (the FRONT's, on a two-nines 18). */
  teeName: string | null;
  /** The back nine's chosen tee name (P-F0a) — absent on pre-P-F0 composes. */
  backTeeName: string | null;
}

export interface NineProvenance {
  courseName: string;
  /** Null only when no tee was ever snapshotted (index-/tee-less course). */
  teeName: string | null;
}

/** A composed tee for the §16 multi-tee rows: one name, 18 (or N) per-hole yards. */
export interface ComposedTee {
  name: string;
  yards: (number | null)[];
}

export interface CourseProvenance {
  composed: boolean;
  front: NineProvenance;
  /** Null for a single course. */
  back: NineProvenance | null;
  /** The chosen tee name (snapshot) — drives the §16 chosen-tee-row highlight. */
  chosenTeeName: string | null;
  /** Every tee for this 18, composed across both nines (or the single course's
   *  tees as-is). For P-F's multi-tee yardage rows. */
  tees: ComposedTee[];
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const first9 = <T>(a: T[] | null | undefined): T[] => (a ?? []).slice(0, 9);

/**
 * Recover full course provenance for a game from the fetched course record(s).
 * `back` null ⇒ single course (its tee sets pass through as-is). Composed ⇒ each
 * FRONT tee is paired with the same-named BACK tee (else the back's first tee, the
 * same name-match-else-first rule `setBackNine` uses for the chosen tee) and their
 * yards concatenated front-9 + back-9.
 */
export function composeProvenance(
  snapshot: ProvenanceSnapshot,
  front: ProvenanceCourse,
  back: ProvenanceCourse | null,
): CourseProvenance {
  const chosenTeeName = snapshot.teeName ?? null;
  const composed = !!back;

  if (!composed) {
    return {
      composed: false,
      front: { courseName: front.name, teeName: chosenTeeName },
      back: null,
      chosenTeeName,
      tees: front.teeSets.map((t) => ({ name: t.name, yards: t.yards })),
    };
  }

  const backCourse = back as ProvenanceCourse;
  // Per-nine tee name: front's is the composed/chosen name; the back's is the
  // captured P-F0a value, falling back to the composed name on pre-P-F0 games.
  const backTeeName = (snapshot.backTeeName ?? "").trim() || chosenTeeName;

  const pickBackTee = (frontTeeName: string): TeeSetRecord | null =>
    backCourse.teeSets.find((t) => norm(t.name) === norm(frontTeeName)) ??
    backCourse.teeSets[0] ??
    null;

  const tees: ComposedTee[] = front.teeSets.map((ft) => {
    const bt = pickBackTee(ft.name);
    return { name: ft.name, yards: [...first9(ft.yards), ...first9(bt?.yards ?? null)] };
  });

  return {
    composed: true,
    front: { courseName: front.name, teeName: chosenTeeName },
    back: { courseName: backCourse.name, teeName: backTeeName },
    chosenTeeName,
    tees,
  };
}

// ── §5a composed-name Course title (P-F0c) ──────────────────────────────────────

/** The one tap-nudge title (§5a) — two unrelated names can't self-describe collapsed. */
export const TITLE_FALLBACK = "Golf Course Selected — Tap to View";

/** Split a course name into segments on a SPACED separator (em/en-dash, hyphen,
 *  middle dot). Spaced-only so hyphenated words ("Winged-Foot") stay one segment —
 *  the separator is a real delimiter, not a substring. */
function splitSegments(name: string): string[] {
  return name.split(/\s+[—–·-]\s+/).map((s) => s.trim()).filter(Boolean);
}

/** A base too short/generic to stand alone as a title (§5a): a lone char or "The". */
function isTrivialBase(base: string): boolean {
  const t = base.trim();
  return t.length <= 1 || /^the$/i.test(t);
}

/**
 * The §5a collapsed-Course-row title. ONE name → that name. TWO names → the shared
 * WHOLE leading segment(s) (separator-delimited, compared segment-by-segment — NOT
 * raw substring, so "Pebble Beach" + "Pebble Creek" do NOT false-merge to "Pebble").
 * No shared base, or a trivially-short/generic one → the tap-nudge fallback.
 */
export function composedCourseTitle(names: (string | null | undefined)[]): string {
  const clean = names.map((n) => (n ?? "").trim()).filter(Boolean);
  if (clean.length === 0) return TITLE_FALLBACK;
  if (clean.length === 1) return clean[0];
  // Identical names (e.g. both nines from one club's single name) → that name.
  if (new Set(clean.map((s) => s.toLowerCase())).size === 1) return clean[0];

  const segLists = clean.map(splitSegments);
  const minLen = Math.min(...segLists.map((s) => s.length));
  const shared: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const seg = segLists[0][i];
    if (segLists.every((s) => norm(s[i]) === norm(seg))) shared.push(seg);
    else break;
  }
  const base = shared.join(" — ").trim();
  if (!base || isTrivialBase(base)) return TITLE_FALLBACK;
  return base;
}

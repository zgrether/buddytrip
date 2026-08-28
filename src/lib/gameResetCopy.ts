import { surfaceForGameType, FORMAT_SURFACE, type GameSurfaceId } from "@/lib/formatSurface";

/**
 * What "Reset scores" clears, and what survives it — said per FORMAT.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * One hardcoded sentence served every format:
 *
 *   "Clears every score, result, and bracket pick. Pairings, course,
 *    handicaps, and points stay."
 *
 * On a pick'em game that names FOUR things the format does not have — bracket
 * picks, a course, handicaps, and (until Phase 5) results of that shape. It was
 * the fourth instance in this feature of copy naming something the format
 * lacks, which is what makes it worth a derivation rather than a fifth edit.
 *
 * ── Derived from the registry, not from a format name ──────────────────────
 *
 * The "stays" list is assembled per surface. A format-name branch
 * (`if (gameTypeId === "gtt_pickem")`) would be the thing CLAUDE.md warns about
 * — a hardcoded format name wearing a helper's clothes — and it would need
 * editing again for the sixth format. This is keyed on `GameSurfaceId`, so a
 * new surface is a compile error here rather than a wrong sentence on screen.
 *
 * `course` is read straight off `FORMAT_SURFACE` rather than repeated, because
 * that flag already exists and a second copy of it is a second thing to keep
 * true.
 */

/** What a reset LEAVES ALONE, per surface. Ordered as the sentence reads. */
const PRESERVED: Record<GameSurfaceId, string[]> = {
  // Golf match play: pairings, the course it is played on, and strokes given.
  match: ["Pairings", "course", "handicaps", "points"],
  rack: ["Groupings", "course", "handicaps", "points"],
  stroke: ["Groupings", "course", "handicaps", "points"],
  // Non-golf covers the bracket, whose field and draw survive a score reset.
  nongolf: ["The field", "draw", "points"],
  // Pick'em: no course and no handicaps. It DOES have pairings — one person
  // from each side — and a points total, and both survive.
  pickem: ["The slate", "pairings", "points"],
};

/** What a reset CLEARS, per surface. "Bracket pick" belongs only to the surface
 *  that can have one. */
const CLEARED: Record<GameSurfaceId, string> = {
  match: "every score and result",
  rack: "every score and result",
  stroke: "every score and result",
  nongolf: "every score, result, and bracket pick",
  // Picks are not scores — they are what gets SCORED. A reset removes the
  // results computed from them, and says so, because "clears every pick" would
  // read as sixteen people losing their sheets.
  pickem: "every recorded result",
};

/** Sentence-case a list: "A, b, and c stay." */
function joinPreserved(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * The "Reset scores" blurb for a game type.
 *
 * Falls back to the non-golf wording for an unregistered id — the same default
 * `surfaceForGameType` applies, so an unknown manual format reads sensibly
 * rather than blank.
 */
export function resetScoresBlurb(gameTypeId: string | null | undefined): string {
  const surface: GameSurfaceId = surfaceForGameType(gameTypeId) ?? "nongolf";
  const preserved = PRESERVED[surface].filter(
    // The one fact already in the registry — never restated here.
    (p) => p !== "course" || FORMAT_SURFACE[surface].course
  );
  return `Clears ${CLEARED[surface]}. ${joinPreserved(preserved)} stay.`;
}

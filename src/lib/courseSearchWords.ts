/**
 * The ONE wording for what a course-database search came back with, shared by
 * both pickers (`CoursePicker`, `CourseSearchPanel`), which used to word the
 * same outcomes differently (#1611).
 *
 * "Couldn't search" and "found nothing" are different facts, and only one of
 * them is true at a time. A failed search used to read "No courses found",
 * which is the app saying something false. Every outcome keeps the manual-entry
 * way out, which sits right below the line in both pickers.
 */
export function courseSearchLine(s: {
  /** The search couldn't run: network, upstream, or no API key configured. */
  failed: boolean;
  /** How many courses it found. */
  found: number;
  /** How many of those are shown (the panel hides ones already saved above). */
  shown: number;
}): string | null {
  if (s.failed) return "Couldn't search the course database just now — add it manually below, or try again.";
  if (s.found === 0) return "No courses found — add it manually below.";
  if (s.shown === 0) return "Everything matching is already in your courses above.";
  return null;
}

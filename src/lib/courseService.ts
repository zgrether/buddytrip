/**
 * CourseService — the provider abstraction (Slice C part 2, §5). The picker UI
 * talks to THIS, never to golfapi.io directly; the provider lives behind the
 * `/api/golf-courses/*` routes and is swappable without touching any caller.
 *
 * Every call fails soft: a search returns `[]` and a detail returns `null` on
 * any error / rate-limit / missing key, so the UI gracefully falls back to
 * manual entry rather than surfacing a failure.
 */

export interface CourseSummary {
  id: string;
  name: string;
  location: string;
  city: string;
  state: string;
  country: string;
  courseCount: number;
}

export interface CourseTeeBox {
  name: string;
  color: string;
  rating: number;
  slope: number;
  totalYardage: number;
}

export interface CourseHole {
  number: number;
  par: number;
  handicapIndex: number;
  tees: { [teeBoxName: string]: { yardage: number } };
}

export interface CourseDetail {
  externalId: string;
  name: string;
  clubName: string;
  location: string;
  teeBoxes: CourseTeeBox[];
  holes: CourseHole[];
}

// Well-known tee names → a display color dot. Arbitrary/free-text names fall
// back to the neutral dim token (safe lookup — never throws on unknown names).
const TEE_DOT: Record<string, string> = {
  black: "#1f2937",
  blue: "#3b82f6",
  white: "#e5e7eb",
  gold: "#f59e0b",
  yellow: "#eab308",
  red: "#ef4444",
  green: "#22c55e",
  silver: "#cbd5e1",
  member: "#a855f7",
  championship: "#1f2937",
};
export function teeColor(name: string): string {
  const key = name.trim().toLowerCase();
  for (const k of Object.keys(TEE_DOT)) if (key.includes(k)) return TEE_DOT[k];
  return "var(--color-bt-text-dim)";
}

/** Search the provider for courses. Returns [] on any failure (→ manual entry). */
export async function searchCourses(
  query: string,
  opts?: { country?: string; state?: string }
): Promise<CourseSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q });
  if (opts?.country) params.set("country", opts.country);
  if (opts?.state) params.set("state", opts.state);
  try {
    const res = await fetch(`/api/golf-courses/search?${params}`);
    if (!res.ok) return [];
    return (await res.json()) as CourseSummary[];
  } catch {
    return [];
  }
}

/** Pull full scorecard detail for a course. Returns null on any failure. */
export async function getCourseDetail(id: string): Promise<CourseDetail | null> {
  if (!id) return null;
  try {
    const res = await fetch(`/api/golf-courses/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as CourseDetail;
  } catch {
    return null;
  }
}

// ── Provider detail → picker shape ─────────────────────────────────────────

/** Course-level par[] from a pulled detail, ordered by hole. */
export function parFromDetail(detail: CourseDetail): number[] {
  return [...detail.holes].sort((a, b) => a.number - b.number).map((h) => h.par || 0);
}

/**
 * Course-level handicap_index[] from a pulled detail, ordered by hole. golfapi
 * frequently returns 0 / missing for a hole's hcp — those become `null` (unset)
 * so the confirm screen's validation flags them instead of silently accepting a
 * broken index (§3, dirty lookup data).
 */
export function indexFromDetail(detail: CourseDetail): (number | null)[] {
  return [...detail.holes]
    .sort((a, b) => a.number - b.number)
    .map((h) => (h.handicapIndex >= 1 ? h.handicapIndex : null));
}

/** Tee sets ({ name, yards[] }) from a pulled detail, ordered by hole. */
export function teeSetsFromDetail(
  detail: CourseDetail
): { name: string; yards: (number | null)[] }[] {
  const holes = [...detail.holes].sort((a, b) => a.number - b.number);
  return detail.teeBoxes.map((tee) => ({
    name: tee.name,
    yards: holes.map((h) => {
      const y = h.tees[tee.name]?.yardage;
      return y && y > 0 ? y : null;
    }),
  }));
}

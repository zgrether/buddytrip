/**
 * golfcourseapi.com payload mapping — the pure functions that turn the
 * provider's raw shapes into our normalized search/detail contract. Kept in a
 * lib module (NOT the route files) because Next route handlers may only export
 * GET/POST/etc.; the routes import these. Also independently unit-testable.
 */

export const SEARCH_LIMIT = 10;
export const API_BASE = "https://api.golfcourseapi.com";

// ── Search ──────────────────────────────────────────────────────────────────

export interface CourseSearchResult {
  id: string;
  name: string;
  location: string;
  city: string;
  state: string;
  country: string;
  courseCount: number;
}

export interface RawSearchCourse {
  id?: number | string;
  club_name?: string;
  course_name?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/** Map golfcourseapi search items into the normalized list shape. */
export function normalizeSearch(courses: RawSearchCourse[]): CourseSearchResult[] {
  return courses.slice(0, SEARCH_LIMIT).map((c) => {
    const city = c.location?.city ?? "";
    const stateOrCountry = c.location?.state || c.location?.country || "";
    const location = [city, stateOrCountry].filter(Boolean).join(", ");
    // golfcourseapi returns individual courses (not clubs); name leads with the
    // club, with the course appended when it adds information.
    const club = c.club_name?.trim() ?? "";
    const course = c.course_name?.trim() ?? "";
    const name =
      club && course && club.toLowerCase() !== course.toLowerCase()
        ? `${club} — ${course}`
        : club || course || "Unknown course";
    return {
      id: String(c.id ?? ""),
      name,
      location,
      city,
      state: c.location?.state ?? "",
      country: c.location?.country ?? "",
      courseCount: 1,
    };
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────

export interface TeeBox {
  name: string;
  color: string;
  rating: number; // course rating
  slope: number; // slope rating
  bogeyRating: number;
  totalYardage: number;
}

export interface HoleData {
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
  teeBoxes: TeeBox[];
  holes: HoleData[];
}

interface RawTee {
  tee_name?: string;
  course_rating?: number;
  slope_rating?: number;
  bogey_rating?: number;
  total_yards?: number;
  holes?: Array<{
    par?: number;
    yardage?: number;
    handicap?: number;
  }>;
}

export interface RawGolfApiCourse {
  id?: string | number;
  course_name?: string;
  club_name?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
  tees?: {
    male?: RawTee[];
    female?: RawTee[];
  };
}

// golfcourseapi commonly returns tee names without obvious display colors. Map
// well-known names to the colors most clubs use; fall back to the dim token.
const TEE_COLOR_BY_NAME: Record<string, string> = {
  black: "#000000",
  blue: "#3b82f6",
  white: "#ffffff",
  gold: "#f59e0b",
  yellow: "#eab308",
  red: "#ef4444",
  green: "#22c55e",
};

/** Map a golfcourseapi course into the normalized CourseDetail. */
export function transformCourse(courseId: string, raw: RawGolfApiCourse): CourseDetail {
  // Male tees first, then female; tag gender so colliding names disambiguate.
  const tagged: Array<{ tee: RawTee; gender: "M" | "W" }> = [
    ...(raw.tees?.male ?? []).map((tee) => ({ tee, gender: "M" as const })),
    ...(raw.tees?.female ?? []).map((tee) => ({ tee, gender: "W" as const })),
  ];

  const usedNames = new Set<string>();
  const uniqueName = (rawName: string, gender: "M" | "W"): string => {
    const base = rawName.trim() || "Tee";
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let n = `${base} (${gender})`;
    let i = 2;
    while (usedNames.has(n)) n = `${base} (${gender}${i++})`;
    usedNames.add(n);
    return n;
  };

  const teeBoxes: TeeBox[] = [];
  const holesMap = new Map<number, HoleData>();

  for (const { tee, gender } of tagged) {
    const name = uniqueName(tee.tee_name ?? "Tee", gender);
    const colorKey = name.toLowerCase();
    teeBoxes.push({
      name,
      color: TEE_COLOR_BY_NAME[colorKey] ?? "var(--color-bt-text-dim)",
      rating: tee.course_rating ?? 0,
      slope: tee.slope_rating ?? 0,
      bogeyRating: tee.bogey_rating ?? 0,
      totalYardage: tee.total_yards ?? 0,
    });

    // golfcourseapi's holes array is positional (index 0 = hole 1) and carries
    // no hole number — derive it from position.
    (tee.holes ?? []).forEach((hole, idx) => {
      const num = idx + 1;
      const existing =
        holesMap.get(num) ??
        ({ number: num, par: 0, handicapIndex: 0, tees: {} } as HoleData);
      // par + stroke index are course-level facts; keep the first non-zero we
      // see (identical across tees on the vast majority of courses).
      existing.par = existing.par || (hole.par ?? 0);
      existing.handicapIndex = existing.handicapIndex || (hole.handicap ?? 0);
      existing.tees[name] = { yardage: hole.yardage ?? 0 };
      holesMap.set(num, existing);
    });
  }

  const holes = Array.from(holesMap.values()).sort((a, b) => a.number - b.number);
  const location = [raw.location?.city, raw.location?.state || raw.location?.country]
    .filter(Boolean)
    .join(", ");

  const clubN = raw.club_name?.trim() ?? "";
  const courseN = raw.course_name?.trim() ?? "";

  return {
    externalId: String(raw.id ?? courseId),
    name:
      clubN && courseN && clubN.toLowerCase() !== courseN.toLowerCase()
        ? `${clubN} — ${courseN}`
        : clubN || courseN || "Unknown course",
    clubName: raw.club_name ?? "",
    location,
    teeBoxes,
    holes,
  };
}

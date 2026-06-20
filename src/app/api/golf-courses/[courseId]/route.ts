import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/golf-courses/[courseId]
 *
 * Proxies golfcourseapi.com `/v1/courses/{id}`. Returns the normalized
 * CourseDetail shape the picker consumes — UNCHANGED from the prior golfapi.io
 * provider EXCEPT each tee now carries its ratings (course/slope/bogey), which
 * the old path fetched and discarded. `holes[]` captures every tee box's
 * yardage so the all-tees scorecard + future moving-tees feature have the data
 * without re-fetching against the daily cap.
 *
 * Cached for 7 days — full scorecard data is essentially immutable.
 */

interface TeeBox {
  name: string;
  color: string;
  rating: number; // course rating
  slope: number; // slope rating
  bogeyRating: number;
  totalYardage: number;
}

interface HoleData {
  number: number;
  par: number;
  handicapIndex: number;
  tees: { [teeBoxName: string]: { yardage: number } };
}

interface CourseDetail {
  externalId: string;
  name: string;
  clubName: string;
  location: string;
  teeBoxes: TeeBox[];
  holes: HoleData[];
}

const REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7d
const API_BASE = "https://api.golfcourseapi.com";

// golfcourseapi.com commonly returns tee names without obvious display colors.
// Map the well-known names to the colors most clubs use; fall back to the dim
// text token so unknown tees still render.
const TEE_COLOR_BY_NAME: Record<string, string> = {
  black: "#000000",
  blue: "#3b82f6",
  white: "#ffffff",
  gold: "#f59e0b",
  yellow: "#eab308",
  red: "#ef4444",
  green: "#22c55e",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params;
  const apiKey = process.env.GOLFCOURSE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${API_BASE}/v1/courses/${encodeURIComponent(courseId)}`,
      {
        headers: {
          Authorization: `Key ${apiKey}`,
          Accept: "application/json",
        },
        next: { revalidate: REVALIDATE_SECONDS },
      }
    );

    if (res.status === 404) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (!res.ok) {
      console.error("golfcourseapi course detail error:", res.status, await res.text());
      return NextResponse.json({ error: "Course lookup failed" }, { status: 502 });
    }

    const payload = (await res.json()) as { course?: RawGolfApiCourse } | RawGolfApiCourse;
    // golfcourseapi wraps the detail in { course: {...} }; tolerate either.
    const raw = (payload as { course?: RawGolfApiCourse }).course ?? (payload as RawGolfApiCourse);
    const detail = transformCourse(courseId, raw);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("golfcourseapi course detail fetch error:", err);
    return NextResponse.json({ error: "Course lookup failed" }, { status: 502 });
  }
}

// ── golfcourseapi.com payload shape ─────────────────────────────────────────
// We type only the fields we read; everything else stays implicit. Tees are
// split into male/female arrays; each tee carries ratings + a per-hole array
// where `handicap` is the stroke index (the load-bearing scoring field).
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

/** Map a golfcourseapi course into the normalized CourseDetail. Exported for tests. */
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

  return {
    externalId: String(raw.id ?? courseId),
    name: raw.course_name ?? raw.club_name ?? "Unknown course",
    clubName: raw.club_name ?? "",
    location,
    teeBoxes,
    holes,
  };
}

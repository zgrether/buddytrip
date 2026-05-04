import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/golf-courses/[courseId]
 *
 * Proxies golfapi.io `/courses/{id}`. Returns the normalized CourseDetail
 * shape that `golf_course_details` stores as JSONB — `holes[]` always
 * captures every tee box's yardage so the future moving-tees feature has
 * the data it needs without re-fetching.
 *
 * Cached for 7 days — full scorecard data is essentially immutable.
 */

interface TeeBox {
  name: string;
  color: string;
  rating: number;
  slope: number;
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

// golfapi.io commonly returns tee box names without obvious display colors.
// Map the well-known tee names to the colors most clubs use; fallback to
// the dim text token so unknown tees still render.
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
  const apiKey = process.env.GOLF_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://www.golfapi.io/api/v2.3/courses/${encodeURIComponent(courseId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        next: { revalidate: REVALIDATE_SECONDS },
      }
    );

    if (res.status === 404) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (!res.ok) {
      console.error("golfapi.io course detail error:", res.status, await res.text());
      return NextResponse.json({ error: "Course lookup failed" }, { status: 502 });
    }

    const raw = (await res.json()) as RawGolfApiCourse;
    const detail = transformCourse(courseId, raw);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("golfapi.io course detail fetch error:", err);
    return NextResponse.json({ error: "Course lookup failed" }, { status: 502 });
  }
}

// ── golfapi.io payload shape ────────────────────────────────────────────────
// We type only the fields we read; everything else stays implicit.
interface RawGolfApiCourse {
  courseID?: string | number;
  courseName?: string;
  clubName?: string;
  city?: string;
  state?: string;
  country?: string;
  numHoles?: number;
  tees?: Array<{
    teeName?: string;
    teeColor?: string;
    courseRatingMen?: number;
    courseRatingWomen?: number;
    slopeMen?: number;
    slopeWomen?: number;
    totalYardage?: number;
    holes?: Array<{
      holeNumber?: number;
      par?: number;
      hcp?: number;
      yardage?: number;
    }>;
  }>;
}

function transformCourse(courseId: string, raw: RawGolfApiCourse): CourseDetail {
  const tees = raw.tees ?? [];

  const teeBoxes: TeeBox[] = tees.map((tee) => {
    const name = tee.teeName ?? "Default";
    const colorKey = (tee.teeColor ?? name).toLowerCase();
    return {
      name,
      color: tee.teeColor ?? TEE_COLOR_BY_NAME[colorKey] ?? "var(--color-bt-text-dim)",
      rating: tee.courseRatingMen ?? tee.courseRatingWomen ?? 0,
      slope: tee.slopeMen ?? tee.slopeWomen ?? 0,
      totalYardage: tee.totalYardage ?? 0,
    };
  });

  // Build hole-keyed map so we can attach every tee's yardage to each hole.
  const holesMap = new Map<number, HoleData>();
  for (const tee of tees) {
    const teeName = tee.teeName ?? "Default";
    for (const hole of tee.holes ?? []) {
      const num = hole.holeNumber ?? 0;
      if (num <= 0) continue;
      const existing =
        holesMap.get(num) ??
        ({
          number: num,
          par: hole.par ?? 0,
          handicapIndex: hole.hcp ?? 0,
          tees: {},
        } as HoleData);
      // Prefer the first tee's par/HCP we see; reasonable since they're
      // identical across tee boxes for the same hole on the vast majority
      // of courses.
      existing.par = existing.par || (hole.par ?? 0);
      existing.handicapIndex = existing.handicapIndex || (hole.hcp ?? 0);
      existing.tees[teeName] = { yardage: hole.yardage ?? 0 };
      holesMap.set(num, existing);
    }
  }

  const holes = Array.from(holesMap.values()).sort((a, b) => a.number - b.number);

  const location = [raw.city, raw.state || raw.country]
    .filter(Boolean)
    .join(", ");

  return {
    externalId: String(raw.courseID ?? courseId),
    name: raw.courseName ?? "Unknown course",
    clubName: raw.clubName ?? "",
    location,
    teeBoxes,
    holes,
  };
}

import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/golf-courses/search?q=Pebble+Beach
 *
 * Proxies golfcourseapi.com `/v1/search` to keep the API key server-side.
 * Returns a normalized list of courses (the `id` is the golfcourseapi course
 * identifier; use it with /api/golf-courses/[courseId] to fetch full scorecard
 * data). The normalized shape is unchanged from the prior golfapi.io provider
 * so courseService.ts + CoursePicker.tsx need no changes.
 *
 * Cached for 24h via Next's `revalidate` — golf course metadata barely moves.
 *
 * If GOLFCOURSE_API_KEY is not set we return [] (not an error) so the UI can
 * gracefully fall back to manual entry without the user seeing a failure.
 *
 * NOTE: golfcourseapi.com's free tier is 50 requests/day. The daily counter +
 * local-first search that protect that cap live one layer up (the picker only
 * hits this route on an explicit "Search the full database" click) — this route
 * is the dumb proxy.
 */

interface CourseSearchResult {
  id: string;
  name: string;
  location: string;
  city: string;
  state: string;
  country: string;
  courseCount: number;
}

const SEARCH_LIMIT = 10;
const REVALIDATE_SECONDS = 60 * 60 * 24; // 24h
const API_BASE = "https://api.golfcourseapi.com";

// golfcourseapi.com search payload — we type only the fields we read.
interface RawSearchCourse {
  id?: number | string;
  club_name?: string;
  course_name?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.GOLFCOURSE_API_KEY;
  if (!apiKey) {
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }

  const params = new URLSearchParams({ search_query: q });

  try {
    const res = await fetch(`${API_BASE}/v1/search?${params}`, {
      headers: {
        Authorization: `Key ${apiKey}`,
        Accept: "application/json",
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      // Soft-fail: log but return empty so the UI can fall back to manual entry.
      console.error("golfcourseapi search error:", res.status, await res.text());
      return NextResponse.json([] satisfies CourseSearchResult[]);
    }

    const payload = (await res.json()) as { courses?: RawSearchCourse[] };
    return NextResponse.json(normalizeSearch(payload.courses ?? []));
  } catch (err) {
    console.error("golfcourseapi search fetch error:", err);
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }
}

/** Map golfcourseapi search items into the normalized list shape. Exported for tests. */
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

import { NextRequest, NextResponse } from "next/server";
import { API_BASE, normalizeSearch, type CourseSearchResult, type RawSearchCourse } from "@/lib/golfCourseApi";

/**
 * GET /api/golf-courses/search?q=Pebble+Beach
 *
 * Proxies golfcourseapi.com `/v1/search` to keep the API key server-side.
 * Returns a normalized list of courses (the `id` is the golfcourseapi course
 * identifier; use it with /api/golf-courses/[courseId] to fetch full scorecard
 * data). The normalized shape is unchanged from the prior golfapi.io provider
 * so courseService.ts + CoursePicker.tsx need no changes. Mapping lives in
 * @/lib/golfCourseApi (route files may only export GET/POST/etc.).
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

const REVALIDATE_SECONDS = 60 * 60 * 24; // 24h

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

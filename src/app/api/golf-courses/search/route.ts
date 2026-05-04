import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/golf-courses/search?q=Augusta+National&country=US&state=GA
 *
 * Proxies golfapi.io `/clubs` to keep the API key server-side. Returns a
 * normalized list of clubs (the `id` is the golfapi.io club identifier;
 * use it with /api/golf-courses/[courseId] to fetch full scorecard data).
 *
 * Cached for 24h via Next's `revalidate` — golf course metadata barely
 * moves, and the same query repeats often as users type.
 *
 * If GOLF_API_KEY is not set we return [] (not an error) so the UI can
 * gracefully fall back to manual entry without the user seeing a failure.
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

export async function GET(req: NextRequest) {
  const apiKey = process.env.GOLF_API_KEY;
  if (!apiKey) {
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }

  const country = req.nextUrl.searchParams.get("country")?.trim() ?? "";
  const state = req.nextUrl.searchParams.get("state")?.trim() ?? "";

  const params = new URLSearchParams({ name: q });
  if (country) params.set("country", country);
  if (state) params.set("state", state);

  try {
    const res = await fetch(`https://www.golfapi.io/api/v2.3/clubs?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      // Soft-fail: log but return empty so the UI can fall back to manual entry.
      console.error("golfapi.io search error:", res.status, await res.text());
      return NextResponse.json([] satisfies CourseSearchResult[]);
    }

    const payload = (await res.json()) as {
      clubs?: Array<{
        clubID?: string | number;
        clubName?: string;
        city?: string;
        state?: string;
        country?: string;
        numCourses?: number;
      }>;
    };

    const clubs = payload.clubs ?? [];
    const normalized: CourseSearchResult[] = clubs.slice(0, SEARCH_LIMIT).map((c) => {
      const city = c.city ?? "";
      const stateOrCountry = c.state || c.country || "";
      const location = [city, stateOrCountry].filter(Boolean).join(", ");
      return {
        id: String(c.clubID ?? ""),
        name: c.clubName ?? "Unknown course",
        location,
        city,
        state: c.state ?? "",
        country: c.country ?? "",
        courseCount: c.numCourses ?? 0,
      };
    });

    return NextResponse.json(normalized);
  } catch (err) {
    console.error("golfapi.io search fetch error:", err);
    return NextResponse.json([] satisfies CourseSearchResult[]);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { API_BASE, transformCourse, type RawGolfApiCourse } from "@/lib/golfCourseApi";

/**
 * GET /api/golf-courses/[courseId]
 *
 * Proxies golfcourseapi.com `/v1/courses/{id}`. Returns the normalized
 * CourseDetail shape the picker consumes — each tee carries its ratings
 * (course/slope/bogey) and `holes[]` captures every tee box's yardage, so the
 * configured-tee snapshot + future moving-tees have the data without
 * re-fetching against the daily cap. Mapping lives in @/lib/golfCourseApi
 * (route files may only export GET/POST/etc.).
 *
 * Cached for 7 days — full scorecard data is essentially immutable.
 */

const REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7d

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

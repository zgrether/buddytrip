import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Signed in: these cases are about the route, not its caller check, which
// apiRoutesCheckCaller.test.ts covers against the real routeCaller.
vi.mock("@/server/lib/routeCaller", () => ({
  routeCaller: async () => ({ ok: true, userId: "user-1" }),
}));
import { NextRequest } from "next/server";
import { GET } from "./route";
import { normalizeSearch } from "@/lib/golfCourseApi";

/**
 * The search route's contract, plus the golfcourseapi → normalized-list mapping.
 *
 * A search that COULDN'T RUN is an error status; `[]` means it ran and found
 * nothing (#1611). This REVERSES the route's first design, which returned `[]`
 * for a missing key and for any upstream failure "so the UI can swap to manual
 * entry without flashing a failure state". The pickers rendered that `[]` as
 * "No courses found", which was false, and Zach ruled that a failure must be
 * named (2026-10-12). Manual entry is still offered either way.
 */

describe("GET /api/golf-courses/search", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GOLFCOURSE_API_KEY;
    delete process.env.GOLFCOURSE_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.GOLFCOURSE_API_KEY = savedKey;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no API key: 503, not an empty list", async () => {
    const req = new NextRequest("http://localhost/api/golf-courses/search?q=Pebble");
    const res = await GET(req);
    expect(res.status).toBe(503);
  });

  it("the upstream refuses: 502, not an empty list", async () => {
    process.env.GOLFCOURSE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new NextRequest("http://localhost/api/golf-courses/search?q=Pebble"));
    expect(res.status).toBe(502);
  });

  it("the fetch itself fails: 502, not an empty list", async () => {
    process.env.GOLFCOURSE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new NextRequest("http://localhost/api/golf-courses/search?q=Pebble"));
    expect(res.status).toBe(502);
  });

  it("control: the upstream answers with nothing — 200 and an empty list (that IS 'found nothing')", async () => {
    process.env.GOLFCOURSE_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ courses: [] }), { status: 200 })));
    const res = await GET(new NextRequest("http://localhost/api/golf-courses/search?q=Pebble"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array when query is too short", async () => {
    process.env.GOLFCOURSE_API_KEY = "test-key";
    const req = new NextRequest("http://localhost/api/golf-courses/search?q=a");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

describe("normalizeSearch — golfcourseapi → normalized list", () => {
  it("maps club + course names and the location object", () => {
    const out = normalizeSearch([
      {
        id: 4321,
        club_name: "Pebble Beach Golf Links",
        course_name: "Pebble Beach",
        location: { city: "Pebble Beach", state: "California", country: "United States" },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "4321",
      name: "Pebble Beach Golf Links — Pebble Beach",
      location: "Pebble Beach, California",
      state: "California",
      country: "United States",
      courseCount: 1,
    });
  });

  it("collapses to one name when club == course, and falls back to country", () => {
    const out = normalizeSearch([
      { id: 7, club_name: "Augusta National", course_name: "Augusta National", location: { city: "Augusta", country: "United States" } },
    ]);
    expect(out[0].name).toBe("Augusta National");
    expect(out[0].location).toBe("Augusta, United States");
  });

  it("tolerates missing names → 'Unknown course'", () => {
    const out = normalizeSearch([{ id: 1 }]);
    expect(out[0]).toMatchObject({ id: "1", name: "Unknown course", location: "" });
  });
});

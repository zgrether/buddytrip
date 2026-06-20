import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { normalizeSearch } from "@/lib/golfCourseApi";

/**
 * Confirms the graceful no-key fallback for the golf course search route, plus
 * the golfcourseapi → normalized-list mapping (the provider-swap contract).
 * The UI relies on `[]` rather than an error so it can swap to manual entry
 * without flashing a failure state.
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

  it("returns empty array when GOLFCOURSE_API_KEY is not set", async () => {
    const req = new NextRequest("http://localhost/api/golf-courses/search?q=Pebble");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
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

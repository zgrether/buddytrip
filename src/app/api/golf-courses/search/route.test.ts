import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

/**
 * Confirms the graceful no-key fallback for the golf course search route.
 * The UI relies on `[]` rather than an error so it can swap to manual
 * entry without flashing a failure state.
 */

describe("GET /api/golf-courses/search", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GOLF_API_KEY;
    delete process.env.GOLF_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) {
      process.env.GOLF_API_KEY = savedKey;
    }
  });

  it("returns empty array when GOLF_API_KEY is not set", async () => {
    const req = new NextRequest("http://localhost/api/golf-courses/search?q=Augusta");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns empty array when query is too short", async () => {
    process.env.GOLF_API_KEY = "test-key";
    const req = new NextRequest("http://localhost/api/golf-courses/search?q=a");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

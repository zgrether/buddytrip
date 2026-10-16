import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { isPlaceId } from "@/lib/placeId";

/**
 * #693 — the place id goes into the PATH of a request that carries our Google
 * API key, so it must not be able to change which path is requested.
 *
 * Requests are built from a real query string, so the handler sees the value
 * the way Next hands it over: already percent-decoded. That is why `%2F` is in
 * the list — it arrives as `/`.
 */

const VALID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

function get(placeId: string) {
  const qs = new URLSearchParams({ placeId }).toString();
  return GET(new NextRequest(`http://localhost/api/places?${qs}`));
}

describe("GET /api/places (place details)", () => {
  let savedKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedKey = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: VALID,
          displayName: { text: "Pebble Beach Golf Links" },
          formattedAddress: "1700 17-Mile Dr",
          location: { latitude: 36.57, longitude: -121.95 },
          googleMapsUri: "https://maps.example/x",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = savedKey;
  });

  it.each([
    ["a parent-directory walk", "../places:autocomplete"],
    ["a second path segment", "abc/def"],
    ["an encoded slash (decoded before the handler sees it)", decodeURIComponent("abc%2Fdef")],
    ["a query string", "abc?fields=*"],
    ["a fragment", "abc#x"],
    ["a percent sign", "abc%2e%2e"],
    ["whitespace", "abc def"],
  ])("refuses %s with a 400 and never calls Google", async (_label, placeId) => {
    const res = await get(placeId);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("CONTROL: a real place id reaches Google as exactly one path segment", async () => {
    const res = await get(VALID);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://places.googleapis.com/v1/places/${VALID}`);
    expect(await res.json()).toMatchObject({ placeId: VALID, name: "Pebble Beach Golf Links" });
  });
});

describe("isPlaceId", () => {
  it("admits Google's alphabet: letters, digits, _ and -", () => {
    expect(isPlaceId(VALID)).toBe(true);
    expect(isPlaceId("GhIJQWDl0CIeQUARxks3icF8U8A-_")).toBe(true);
  });

  it("refuses empty and over-long values", () => {
    expect(isPlaceId("")).toBe(false);
    expect(isPlaceId("a".repeat(1025))).toBe(false);
    expect(isPlaceId("a".repeat(1024))).toBe(true);
  });
});

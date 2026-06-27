import { describe, it, expect } from "vitest";
import { manualEntryVisible, dedupeApiCourses, normalizeCourseName } from "./courseSearch";

// W-GAMEPAGE-01 §10 — course-search flow. The manual-entry timing (pin #4) and
// the API-vs-local dedup (stage 3) are the punch-list items this phase closes.

describe("manualEntryVisible (pin #4 timing)", () => {
  it("FRONT mode: hidden until the full-DB search has run", () => {
    expect(manualEntryVisible({ back: false, apiSearched: false })).toBe(false); // recents / live-filter
    expect(manualEntryVisible({ back: false, apiSearched: true })).toBe(true); // after enter (incl. empty)
  });
  it("BACK mode: always visible — no API stage to gate behind", () => {
    expect(manualEntryVisible({ back: true, apiSearched: false })).toBe(true);
    expect(manualEntryVisible({ back: true, apiSearched: true })).toBe(true);
  });
});

describe("dedupeApiCourses (stage 3 — vs saved)", () => {
  const api = [
    { id: "p1", name: "Pebble Beach" },
    { id: "p2", name: "Spyglass Hill" },
    { id: "p3", name: "  pebble beach  " }, // dupe by normalized name, different casing/space
  ];

  it("drops API results whose name matches a saved course (case/space-insensitive)", () => {
    const out = dedupeApiCourses(api, ["PEBBLE BEACH"]);
    expect(out.map((c) => c.id)).toEqual(["p2"]); // both Pebble variants dropped
  });
  it("keeps everything when nothing is saved", () => {
    expect(dedupeApiCourses(api, [])).toHaveLength(3);
  });
  it("empty API → empty out", () => {
    expect(dedupeApiCourses([], ["Anything"])).toEqual([]);
  });
});

describe("normalizeCourseName", () => {
  it("trims + lowercases for cross-source (API id ≠ saved id) matching", () => {
    expect(normalizeCourseName("  Augusta National  ")).toBe("augusta national");
  });
});

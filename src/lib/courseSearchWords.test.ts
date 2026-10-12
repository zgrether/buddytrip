import { describe, it, expect, afterEach, vi } from "vitest";
import { courseSearchLine } from "./courseSearchWords";
import { searchCourses } from "./courseService";

/**
 * #1611: "couldn't search" and "found nothing" are different facts. A failed
 * course search used to read "No courses found". Exact strings: a substring
 * test could pass on the wrong sentence.
 */
describe("courseSearchLine — one wording for both pickers", () => {
  it("couldn't search: says so, keeps manual entry, offers a retry", () => {
    expect(courseSearchLine({ failed: true, found: 0, shown: 0 })).toBe(
      "Couldn't search the course database just now — add it manually below, or try again."
    );
  });

  it("found nothing", () => {
    expect(courseSearchLine({ failed: false, found: 0, shown: 0 })).toBe("No courses found — add it manually below.");
  });

  it("found some, all already saved above", () => {
    expect(courseSearchLine({ failed: false, found: 3, shown: 0 })).toBe("Everything matching is already in your courses above.");
  });

  it("found some to show: no line", () => {
    expect(courseSearchLine({ failed: false, found: 3, shown: 2 })).toBeNull();
  });
});

describe("searchCourses — a search that couldn't run THROWS; [] means it found nothing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the route says it couldn't search (non-200): throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 502 })));
    await expect(searchCourses("Pebble")).rejects.toThrow("course search failed (502)");
  });

  it("the network fails: throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(searchCourses("Pebble")).rejects.toThrow("fetch failed");
  });

  it("control: the route answers with nothing — []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    await expect(searchCourses("Pebble")).resolves.toEqual([]);
  });

  it("a query too short to search is [] without asking", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(searchCourses("a")).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

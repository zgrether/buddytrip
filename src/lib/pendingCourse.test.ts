import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pendingCoursePut, pendingCourseTake } from "./pendingCourse";

/**
 * The `/courses/new` → settings-draft hand-off (#1226).
 *
 * The bug this replaces was a SILENT loss — import a course mid-settings and the
 * points you had set were gone, with nothing said. So the properties that matter
 * here are the ones that decide whether the hand-off arrives at all, and every
 * one of them is a way for it to go quiet again.
 *
 * `environment: "node"`, so `sessionStorage` is stubbed rather than real. That is
 * honest for this module: it stores a JSON string under a key and reads it back,
 * and what is worth pinning is the CONTRACT (consume-once, expiry, rejection of
 * junk), not the browser's implementation of Storage.
 */

function installSessionStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal("window", { sessionStorage: store });
  return { map, store };
}

beforeEach(() => {
  installSessionStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pendingCourse hand-off", () => {
  it("round-trips the course, tee and slot", () => {
    pendingCoursePut("g1", { courseId: "c1", teeName: "Blue", slot: "front" });
    expect(pendingCourseTake("g1")).toMatchObject({
      courseId: "c1",
      teeName: "Blue",
      slot: "front",
    });
  });

  it("CONSUMES — a second take returns nothing", () => {
    // The staging action overwrites the draft's course slice, so it must not run
    // twice. A remount that re-applied it would clobber a course the user had
    // since changed by hand.
    pendingCoursePut("g1", { courseId: "c1", slot: "front" });
    expect(pendingCourseTake("g1")).not.toBeNull();
    expect(pendingCourseTake("g1")).toBeNull();
  });

  it("is keyed per game — one game's hand-off never lands on another", () => {
    // The settings page reads on mount with its OWN game id. Cross-talk here
    // would stage a course onto the wrong game, which is worse than the bug.
    pendingCoursePut("g1", { courseId: "c1", slot: "front" });
    expect(pendingCourseTake("g2")).toBeNull();
    expect(pendingCourseTake("g1")).not.toBeNull();
  });

  it("carries the BACK slot distinctly — it composes, it does not replace", () => {
    // `slot=back` (W-9HOLE-01) goes to `onApplyBack`. Collapsing the two would
    // replace the front nine with a 9-hole course.
    pendingCoursePut("g1", { courseId: "c9", slot: "back" });
    expect(pendingCourseTake("g1")?.slot).toBe("back");
  });

  it("EXPIRES, and clears the expired key rather than leaving it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
    pendingCoursePut("g1", { courseId: "c1", slot: "front" });

    vi.setSystemTime(new Date("2026-09-03T12:09:00Z")); // inside the window
    const fresh = pendingCourseTake("g1");
    expect(fresh).not.toBeNull();

    pendingCoursePut("g2", { courseId: "c2", slot: "front" });
    vi.setSystemTime(new Date("2026-09-03T12:30:00Z")); // past it
    expect(pendingCourseTake("g2")).toBeNull();
    // And it did not leave the stale key behind for the tab's lifetime.
    expect(window.sessionStorage.getItem("bt.pendingCourse.v1:g2")).toBeNull();
  });

  it("rejects junk instead of throwing into the settings page", () => {
    // The read happens in a mount effect. A throw there would break the whole
    // settings surface over a corrupt storage value.
    window.sessionStorage.setItem("bt.pendingCourse.v1:g1", "not json");
    expect(() => pendingCourseTake("g1")).not.toThrow();
    expect(pendingCourseTake("g1")).toBeNull();

    window.sessionStorage.setItem(
      "bt.pendingCourse.v1:g2",
      JSON.stringify({ courseId: "", slot: "front", ts: Date.now() })
    );
    expect(pendingCourseTake("g2")).toBeNull();

    window.sessionStorage.setItem(
      "bt.pendingCourse.v1:g3",
      JSON.stringify({ courseId: "c", slot: "sideways", ts: Date.now() })
    );
    expect(pendingCourseTake("g3")).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    // Private mode / storage disabled. Best-effort, per the module's contract:
    // losing the hand-off costs one re-pick from the saved list, and the course
    // is already in the library by then.
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
        removeItem: () => {
          throw new Error("storage disabled");
        },
      },
    });
    expect(() => pendingCoursePut("g1", { courseId: "c1", slot: "front" })).not.toThrow();
    expect(pendingCourseTake("g1")).toBeNull();
  });

  it("is a no-op on the server, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => pendingCoursePut("g1", { courseId: "c1", slot: "front" })).not.toThrow();
    expect(pendingCourseTake("g1")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  composedCourseTitle, composeProvenance, TITLE_FALLBACK,
  type ProvenanceCourse,
} from "./courseProvenance";
import type { TeeSetRecord } from "./courseService";

// W-GAMEPAGE P-F0c — the §5a collapsed-Course-row title. Separator-delimited shared
// WHOLE leading segment; the Pebble guard must NOT raw-substring-merge.
describe("composedCourseTitle (§5a)", () => {
  it("single name → that name", () => {
    expect(composedCourseTitle(["Pebble Creek"])).toBe("Pebble Creek");
  });

  it("shared leading segment → the common base", () => {
    expect(composedCourseTitle(["Peninsula — Cypress", "Peninsula — Lakes"])).toBe("Peninsula");
    expect(composedCourseTitle(["Pinehurst · No. 2", "Pinehurst · No. 4"])).toBe("Pinehurst");
    // The exact live-data case (spaced single hyphen " - " from the provider).
    expect(
      composedCourseTitle([
        "Peninsula Golf & Racquet Club - Lakes",
        "Peninsula Golf & Racquet Club - Cypress",
      ]),
    ).toBe("Peninsula Golf & Racquet Club");
  });

  it("Pebble guard: similar first WORDS but different first SEGMENT do NOT merge", () => {
    // "Pebble Beach" / "Pebble Creek" are each ONE segment (no spaced separator) →
    // they differ → no shared leading segment → fallback (never "Pebble").
    expect(composedCourseTitle(["Pebble Beach", "Pebble Creek"])).toBe(TITLE_FALLBACK);
  });

  it("hyphenated single word stays one segment (only SPACED separators split)", () => {
    expect(composedCourseTitle(["Winged-Foot — East", "Winged-Foot — West"])).toBe("Winged-Foot");
  });

  it("no overlap at all → fallback", () => {
    expect(composedCourseTitle(["Augusta National", "St Andrews"])).toBe(TITLE_FALLBACK);
  });

  it("trivially short / generic shared base → fallback (not 'The' or a lone char)", () => {
    expect(composedCourseTitle(["The — North", "The — South"])).toBe(TITLE_FALLBACK);
    expect(composedCourseTitle(["A — One", "A — Two"])).toBe(TITLE_FALLBACK);
  });

  it("identical names → that name (no 'X — X')", () => {
    expect(composedCourseTitle(["Riverside", "Riverside"])).toBe("Riverside");
  });

  it("empty / all-blank → fallback, never undefined", () => {
    expect(composedCourseTitle([])).toBe(TITLE_FALLBACK);
    expect(composedCourseTitle([null, undefined, "  "])).toBe(TITLE_FALLBACK);
  });
});

// W-GAMEPAGE P-F0b — read-side provenance recovery from the fetched course records.
const tee = (name: string, yards: (number | null)[]): TeeSetRecord => ({
  name, courseRating: null, slopeRating: null, bogeyRating: null, yards,
});
const f9 = [400, 410, 420, 380, 390, 350, 540, 160, 430];
const b9 = [405, 415, 425, 385, 395, 355, 545, 165, 435];

describe("composeProvenance (P-F0b)", () => {
  it("single course → passthrough tees + name, no back", () => {
    const front: ProvenanceCourse = {
      name: "Pebble Creek",
      teeSets: [tee("White", [...f9, ...b9]), tee("Blue", [...f9, ...b9])],
    };
    const p = composeProvenance({ teeName: "White", backTeeName: null }, front, null);
    expect(p.composed).toBe(false);
    expect(p.front).toEqual({ courseName: "Pebble Creek", teeName: "White" });
    expect(p.back).toBeNull();
    expect(p.chosenTeeName).toBe("White");
    expect(p.tees.map((t) => t.name)).toEqual(["White", "Blue"]);
    expect(p.tees[0].yards).toHaveLength(18);
  });

  it("composed 18 → per-nine names + all tees concatenated front9+back9", () => {
    const front: ProvenanceCourse = { name: "Front Club", teeSets: [tee("White", f9), tee("Blue", f9)] };
    const back: ProvenanceCourse = { name: "Back Club", teeSets: [tee("White", b9), tee("Blue", b9)] };
    const p = composeProvenance({ teeName: "White", backTeeName: "White" }, front, back);
    expect(p.composed).toBe(true);
    expect(p.front).toEqual({ courseName: "Front Club", teeName: "White" });
    expect(p.back).toEqual({ courseName: "Back Club", teeName: "White" });
    expect(p.tees).toHaveLength(2);
    expect(p.tees[0].yards).toEqual([...f9, ...b9]); // White composed
  });

  it("back-tee name FALLS BACK to the composed name when absent (pre-P-F0 game)", () => {
    const front: ProvenanceCourse = { name: "Front Club", teeSets: [tee("White", f9)] };
    const back: ProvenanceCourse = { name: "Back Club", teeSets: [tee("White", b9)] };
    const p = composeProvenance({ teeName: "White", backTeeName: null }, front, back);
    expect(p.back?.teeName).toBe("White"); // not null/undefined — the composed name
  });

  it("back has no same-named tee → pickBackTee uses the back's FIRST tee (mirrors setBackNine)", () => {
    const front: ProvenanceCourse = { name: "Front Club", teeSets: [tee("White", f9)] };
    const back: ProvenanceCourse = { name: "Back Club", teeSets: [tee("Gold", b9), tee("Red", b9)] };
    const p = composeProvenance({ teeName: "White", backTeeName: "Gold" }, front, back);
    expect(p.back?.teeName).toBe("Gold"); // the captured chosen back tee
    expect(p.tees[0].yards).toEqual([...f9, ...b9]); // White ← front White + back Gold (first)
  });
});

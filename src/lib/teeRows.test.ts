import { describe, it, expect } from "vitest";
import { buildTeeRows, type RawTee } from "./teeRows";

// Spec 5b — the multi-tee scorecard rows (DISPLAY only). These lock in the order
// (longest→shortest), the default window (chosen ± one neighbor, clamped at the
// ends with no phantom), and the two-nines composition.

const t = (name: string, ...yards: (number | null)[]): RawTee => ({ name, yards });
// Four 18-hole tees, distinct totals so order is unambiguous.
const tees18 = (): RawTee[] => [
  { name: "Blue", yards: Array(18).fill(400) }, // total 7200 (longest)
  { name: "White", yards: Array(18).fill(350) }, // 6300
  { name: "Gold", yards: Array(18).fill(300) }, // 5400
  { name: "Red", yards: Array(18).fill(250) }, // 4500 (shortest)
];

describe("buildTeeRows — order + defaults", () => {
  it("orders rows longest→shortest (back tees first)", () => {
    const rows = buildTeeRows({ chosenTeeName: "White", holeCount: 18, frontTees: tees18() });
    expect(rows.map((r) => r.name)).toEqual(["Blue", "White", "Gold", "Red"]);
    expect(rows[0].total).toBeGreaterThan(rows[3].total);
  });

  it("flags the chosen tee and derives its color from the name", () => {
    const rows = buildTeeRows({ chosenTeeName: "White", holeCount: 18, frontTees: tees18() });
    expect(rows.find((r) => r.name === "White")!.isChosen).toBe(true);
    expect(rows.filter((r) => r.isChosen)).toHaveLength(1);
    expect(rows.find((r) => r.name === "Blue")!.color).toBe("#3b82f6"); // teeColor("Blue")
  });

  it("default-visible = chosen + one neighbor each side (3 in the middle)", () => {
    const rows = buildTeeRows({ chosenTeeName: "White", holeCount: 18, frontTees: tees18() });
    const vis = rows.filter((r) => r.defaultVisible).map((r) => r.name);
    expect(vis).toEqual(["Blue", "White", "Gold"]); // White ± 1
  });

  it("clamps at the HARD end (chosen is longest → no phantom behind): 2 rows", () => {
    const rows = buildTeeRows({ chosenTeeName: "Blue", holeCount: 18, frontTees: tees18() });
    const vis = rows.filter((r) => r.defaultVisible).map((r) => r.name);
    expect(vis).toEqual(["Blue", "White"]); // nothing harder than Blue
  });

  it("clamps at the EASY end (chosen is shortest → no phantom in front): 2 rows", () => {
    const rows = buildTeeRows({ chosenTeeName: "Red", holeCount: 18, frontTees: tees18() });
    const vis = rows.filter((r) => r.defaultVisible).map((r) => r.name);
    expect(vis).toEqual(["Gold", "Red"]); // nothing easier than Red
  });
});

describe("buildTeeRows — two-nines composition", () => {
  it("composes front-9 ⊕ back-9 per tee, matching the back tee by name", () => {
    const frontTees: RawTee[] = [t("Blue", ...Array(9).fill(400)), t("White", ...Array(9).fill(350))];
    const backTees: RawTee[] = [t("White", ...Array(9).fill(360)), t("Blue", ...Array(9).fill(410))];
    const rows = buildTeeRows({ chosenTeeName: "Blue", holeCount: 18, frontTees, backTees });
    const blue = rows.find((r) => r.name === "Blue")!;
    expect(blue.yards).toHaveLength(18);
    expect(blue.yards.slice(0, 9)).toEqual(Array(9).fill(400)); // front from front course
    expect(blue.yards.slice(9)).toEqual(Array(9).fill(410)); // back matched by name
    expect(blue.total).toBe(9 * 400 + 9 * 410);
  });

  it("falls back to the back course's first tee when the name doesn't match", () => {
    const frontTees: RawTee[] = [t("Championship", ...Array(9).fill(420))];
    const backTees: RawTee[] = [t("Tips", ...Array(9).fill(430))];
    const rows = buildTeeRows({ chosenTeeName: "Championship", holeCount: 18, frontTees, backTees });
    expect(rows[0].yards.slice(9)).toEqual(Array(9).fill(430)); // back's first tee
  });
});

describe("buildTeeRows — edge cases", () => {
  it("returns [] when there are no tees (→ scorecard falls back to its single row)", () => {
    expect(buildTeeRows({ chosenTeeName: "Blue", holeCount: 18, frontTees: [] })).toEqual([]);
  });

  it("a single-tee course yields exactly one row (that one tee)", () => {
    const rows = buildTeeRows({ chosenTeeName: "White", holeCount: 18, frontTees: [t("White", ...Array(18).fill(350))] });
    expect(rows).toHaveLength(1);
    expect(rows[0].defaultVisible).toBe(true);
    expect(rows[0].isChosen).toBe(true);
  });
});

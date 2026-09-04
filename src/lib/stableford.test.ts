import { describe, it, expect } from "vitest";
import {
  STABLEFORD_PRESETS,
  bucketCount,
  bucketLabel,
  configFor,
  edgeLabel,
  isValidRubric,
  matchesPreset,
  rubricBuckets,
  scoringOf,
  stablefordPoints,
  withBucketPoints,
  withEdge,
  type StablefordRubric,
} from "./stableford";

/**
 * The Stableford rubric model.
 *
 * ── The wrong build these cases exist to fail ──────────────────────────────
 *
 * A DISCRETE MAP — `{ "-2": 4, "-1": 3, "0": 2, "1": 1, "2": 0 }` — is the
 * obvious implementation and it passes most of a naive test file, because most
 * holes land inside it. It fails on the two ends, which is exactly where a real
 * card goes: an albatross and a quintuple bogey both return `undefined`, and
 * `undefined` propagates into a total as `NaN` rather than as an error. The
 * clamping cases below are the whole reason the model is a RANGE.
 */

const STANDARD = STABLEFORD_PRESETS.standard.rubric;
const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;

describe("stablefordPoints — the domain is total", () => {
  it("scores every named bucket on the Standard scale", () => {
    // −3 albatross 5 · −2 eagle 4 · −1 birdie 3 · 0 par 2 · +1 bogey 1 · +2 double 0
    expect([-3, -2, -1, 0, 1, 2].map((d) => stablefordPoints(d, STANDARD))).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("an ALBATROSS on a rubric whose ceiling is an eagle scores the ceiling value", () => {
    // BBMI 2024's ceiling is −2. A discrete map returns undefined here.
    expect(BBMI.ceiling).toBe(-2);
    expect(stablefordPoints(-3, BBMI)).toBe(9);
    // And further out still — a hole-in-one on a par 5.
    expect(stablefordPoints(-4, BBMI)).toBe(9);
  });

  it("a QUINTUPLE BOGEY scores the floor value on every preset", () => {
    // +5 is past every preset's floor. Under Standard that is 0 and under
    // Modified it is −3: "or worse" is a catch-all, not a zero.
    expect(stablefordPoints(5, STANDARD)).toBe(0);
    expect(stablefordPoints(5, BBMI)).toBe(0);
    expect(stablefordPoints(5, STABLEFORD_PRESETS.modified.rubric)).toBe(-3);
  });

  it("never returns undefined or NaN across a wide differential sweep", () => {
    // The property version of the two cases above: the failure mode of a
    // discrete map is an absent value, so assert a NUMBER comes back for every
    // differential a real round could produce, on every preset.
    for (const { rubric } of Object.values(STABLEFORD_PRESETS)) {
      for (let d = -6; d <= 12; d++) {
        const p = stablefordPoints(d, rubric);
        expect(Number.isFinite(p), `differential ${d} produced ${p}`).toBe(true);
      }
    }
  });

  it("is monotonic — a worse hole never scores more", () => {
    for (const { rubric } of Object.values(STABLEFORD_PRESETS)) {
      for (let d = -6; d < 12; d++) {
        expect(stablefordPoints(d + 1, rubric)).toBeLessThanOrEqual(stablefordPoints(d, rubric));
      }
    }
  });
});

describe("the three presets carry the ratified numbers", () => {
  it("Standard is Rule 32", () => {
    expect(STANDARD).toEqual({ ceiling: -3, floor: 2, points: [5, 4, 3, 2, 1, 0] });
  });

  it("Modified is the Barracuda scale, and PUNISHES rather than zeroing", () => {
    const m = STABLEFORD_PRESETS.modified.rubric;
    expect(m).toEqual({ ceiling: -3, floor: 2, points: [8, 5, 2, 0, -1, -3] });
    // The property that distinguishes it from the other two, and the reason it
    // exists: par is worth nothing and a bad hole costs you.
    expect(stablefordPoints(0, m)).toBe(0);
    expect(stablefordPoints(2, m)).toBeLessThan(0);
  });

  it("BBMI 2024 moves the floor one right, which is what makes gross playable", () => {
    expect(BBMI).toEqual({ ceiling: -2, floor: 3, points: [9, 6, 4, 2, 1, 0] });
    // The point of the shift: a TRIPLE still scores under BBMI and is already
    // past the floor under Standard. With 97–103 on a par 70 that is the
    // difference between a card of numbers and a card of zeroes.
    expect(stablefordPoints(3, BBMI)).toBe(0);
    expect(stablefordPoints(2, BBMI)).toBe(1);
    expect(stablefordPoints(2, STANDARD)).toBe(0);
  });

  it("every preset's points array matches its bucket count", () => {
    for (const [id, { rubric }] of Object.entries(STABLEFORD_PRESETS)) {
      expect(rubric.points.length, id).toBe(bucketCount(rubric.ceiling, rubric.floor));
      expect(isValidRubric(rubric), id).toBe(true);
    }
  });
});

describe("labels are rendered from the differential, never stored", () => {
  it("names the seven buckets golf has words for", () => {
    expect([-3, -2, -1, 0, 1, 2, 3].map(bucketLabel)).toEqual([
      "Albatross", "Eagle", "Birdie", "Par", "Bogey", "Double bogey", "Triple bogey",
    ]);
  });

  it("renders the NUMBER past the point golf has a word", () => {
    // The stated rule. Nobody calls par + 7 anything, and no name is invented.
    expect(bucketLabel(4)).toBe("+4");
    expect(bucketLabel(7)).toBe("+7");
    expect(bucketLabel(-4)).toBe("-4");
  });

  it("an EDGE bucket reads as the catch-all it is", () => {
    expect(edgeLabel(-3, "ceiling")).toBe("Albatross or better");
    expect(edgeLabel(2, "floor")).toBe("Double bogey or worse");
  });

  it("rubricBuckets marks exactly the two ends as edges", () => {
    const b = rubricBuckets(STANDARD);
    expect(b.map((x) => x.differential)).toEqual([-3, -2, -1, 0, 1, 2]);
    expect(b.filter((x) => x.isEdge).map((x) => x.differential)).toEqual([-3, 2]);
    // The panel renders these; they must be the values the scorer honours.
    expect(b.map((x) => x.points)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});

describe("Custom — the floor and ceiling MOVE, generating buckets", () => {
  it("moving the floor down one adds a bucket seeded from its neighbour", () => {
    // This is how the scale slides right, and without it BBMI 2024 is not
    // expressible from a preset — which is the requirement, not a nicety.
    const wider = withEdge(STANDARD, "floor", 3);
    expect(wider.floor).toBe(3);
    expect(wider.points).toEqual([5, 4, 3, 2, 1, 0, 0]);
    expect(isValidRubric(wider)).toBe(true);
  });

  it("moving the ceiling out adds at the best end", () => {
    // BBMI's ceiling is −2, so going to −4 generates TWO buckets (−3 and −4),
    // both seeded from the eagle value the old catch-all was already paying.
    const wider = withEdge(BBMI, "ceiling", -4);
    expect(wider.points).toEqual([9, 9, 9, 6, 4, 2, 1, 0]);
    expect(wider.points.length).toBe(bucketCount(-4, 3));
    expect(stablefordPoints(-4, wider)).toBe(9);
    expect(isValidRubric(wider)).toBe(true);
  });

  it("moving an edge INWARD drops buckets and stays valid", () => {
    const tighter = withEdge(STANDARD, "ceiling", -1);
    expect(tighter).toEqual({ ceiling: -1, floor: 2, points: [3, 2, 1, 0] });
    expect(isValidRubric(tighter)).toBe(true);
    // The catch-all follows the edge: an eagle now scores the birdie value.
    expect(stablefordPoints(-2, tighter)).toBe(3);
  });

  it("BBMI 2024 is reachable from Standard by moving the edges and editing", () => {
    // The end-to-end version of the requirement: the Custom controls can
    // express Zach's own rubric starting from a preset.
    let r: StablefordRubric = withEdge(withEdge(STANDARD, "floor", 3), "ceiling", -2);
    const want = [9, 6, 4, 2, 1, 0];
    want.forEach((p, i) => { r = withBucketPoints(r, -2 + i, p); });
    expect(r).toEqual(BBMI);
  });

  it("an out-of-range bucket edit is a no-op, not a hole in the array", () => {
    expect(withBucketPoints(STANDARD, 9, 99)).toEqual(STANDARD);
  });

  it("matchesPreset flips to false the moment a value is edited", () => {
    expect(matchesPreset(STANDARD, "standard")).toBe(true);
    expect(matchesPreset(withBucketPoints(STANDARD, 0, 3), "standard")).toBe(false);
    expect(matchesPreset(STANDARD, "custom")).toBe(false);
  });
});

describe("isValidRubric refuses what would score undefined", () => {
  it("rejects a points array of the wrong length", () => {
    // The one that matters: a short array indexes past its end and scores
    // undefined, which totals to NaN rather than failing.
    expect(isValidRubric({ ceiling: -3, floor: 2, points: [5, 4, 3] })).toBe(false);
  });

  it("rejects an inverted range and non-integer edges", () => {
    expect(isValidRubric({ ceiling: 2, floor: -3, points: [] })).toBe(false);
    expect(isValidRubric({ ceiling: -1.5, floor: 2, points: [1, 2, 3, 4] })).toBe(false);
  });

  it("rejects null, undefined and a non-numeric value", () => {
    expect(isValidRubric(null)).toBe(false);
    expect(isValidRubric(undefined)).toBe(false);
    expect(isValidRubric({ ceiling: 0, floor: 0, points: ["2" as unknown as number] })).toBe(false);
  });
});

describe("scoringOf — reading games.config", () => {
  it("an EMPTY config is Traditional", () => {
    // Every game that exists today has `config = '{}'`. Reading those as
    // anything else would rescore the entire history of the app.
    expect(scoringOf({})).toEqual({ type: "traditional", rubric: null });
    expect(scoringOf(null)).toEqual({ type: "traditional", rubric: null });
    expect(scoringOf(undefined)).toEqual({ type: "traditional", rubric: null });
  });

  it("reads a valid Stableford block", () => {
    const cfg = { scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } };
    expect(scoringOf(cfg)).toEqual({ type: "stableford", rubric: BBMI });
  });

  it("falls back to Traditional on a MALFORMED rubric rather than scoring undefined", () => {
    // A hand-edited row or an older shape. A card that reads exactly as it
    // always did beats a card of NaN.
    const cfg = { scoringType: "stableford", stableford: { ceiling: -3, floor: 2, points: [5, 4] } };
    expect(scoringOf(cfg)).toEqual({ type: "traditional", rubric: null });
  });

  it("returns a COPY, so a caller cannot mutate the stored config", () => {
    const cfg = { scoringType: "stableford", stableford: { preset: "standard", ...STANDARD } };
    const got = scoringOf(cfg);
    got.rubric!.points[0] = 999;
    expect(cfg.stableford.points[0]).toBe(5);
  });

  it("round-trips through configFor", () => {
    const written = configFor("stableford", { preset: "bbmi_2024", ...BBMI });
    expect(scoringOf(written)).toEqual({ type: "stableford", rubric: BBMI });
    expect(scoringOf(configFor("traditional", null))).toEqual({ type: "traditional", rubric: null });
  });
});

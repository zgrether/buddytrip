import { describe, it, expect } from "vitest";
import {
  formatPoints,
  formatResultSummary,
  formatClinchMargin,
} from "./gameFinishNotify";

/**
 * Notification copy, exercised with REAL names rather than "Team A" — a summary
 * that reads well with short test names is exactly the one that overflows on a
 * lock screen. The truncation block at the bottom is the point of this file as
 * much as the formatting assertions are.
 */

describe("formatPoints — halves, because tie-averaging produces them", () => {
  it("renders whole numbers bare", () => {
    expect(formatPoints(3)).toBe("3");
    expect(formatPoints(0)).toBe("0");
  });

  it("renders halves with ½, and a lone half without a leading zero", () => {
    expect(formatPoints(2.5)).toBe("2½");
    expect(formatPoints(0.5)).toBe("½");
    expect(formatPoints(25.5)).toBe("25½");
  });

  it("shows a non-half fraction honestly rather than rounding it away", () => {
    // Points SHOULD only ever be half-steps. If one isn't, that is information —
    // quietly rounding it would hide a real scoring bug behind tidy copy.
    expect(formatPoints(2.25)).toBe("2.25");
  });
});

describe("formatResultSummary — three shapes that must read as siblings", () => {
  it("match play: a head-to-head score line", () => {
    expect(
      formatResultSummary([
        { name: "Manhattans", points: 2.5 },
        { name: "Centurions", points: 1.5 },
      ])
    ).toBe("Manhattans 2½ – Centurions 1½");
  });

  it("match play: the winner leads regardless of input order", () => {
    expect(
      formatResultSummary([
        { name: "Centurions", points: 1.5 },
        { name: "Manhattans", points: 2.5 },
      ])
    ).toBe("Manhattans 2½ – Centurions 1½");
  });

  it("rack: same score-line shape, whole points", () => {
    expect(
      formatResultSummary([
        { name: "Manhattans", points: 24, position: 1 },
        { name: "Centurions", points: 18, position: 2 },
      ])
    ).toBe("Manhattans 24 – Centurions 18");
  });

  it("non-golf: a placement list", () => {
    expect(
      formatResultSummary([
        { name: "Centurions", position: 1 },
        { name: "Manhattans", position: 2 },
      ])
    ).toBe("1st Centurions · 2nd Manhattans");
  });

  it("stroke: the same placement shape, with people instead of teams", () => {
    expect(
      formatResultSummary([
        { name: "Zach", position: 1 },
        { name: "BJ", position: 2 },
        { name: "Dave", position: 3 },
      ])
    ).toBe("1st Zach · 2nd BJ · 3rd Dave");
  });

  it("more than two sides falls to the placement list, keeping the points", () => {
    // A 3-team rack still needs to report the margin, so points ride along
    // rather than being dropped for the sake of a uniform shape.
    expect(
      formatResultSummary([
        { name: "Manhattans", points: 12, position: 1 },
        { name: "Centurions", points: 9, position: 2 },
        { name: "Bootleggers", points: 7, position: 3 },
      ])
    ).toBe("1st Manhattans 12 · 2nd Centurions 9 · 3rd Bootleggers 7");
  });

  it("a tie reads as a tie — both sides at 1st", () => {
    expect(
      formatResultSummary([
        { name: "Centurions", position: 1 },
        { name: "Manhattans", position: 1 },
      ])
    ).toBe("1st Centurions · 1st Manhattans");
  });

  it("a halved match still renders as a score line", () => {
    expect(
      formatResultSummary([
        { name: "Manhattans", points: 2 },
        { name: "Centurions", points: 2 },
      ])
    ).toBe("Manhattans 2 – Centurions 2");
  });

  it("returns empty when there is nothing to say, so the body can fall back", () => {
    expect(formatResultSummary([])).toBe("");
    expect(formatResultSummary([{ name: "", points: 1 }])).toBe("");
  });
});

describe("formatClinchMargin — bare totals, no names", () => {
  it("reports the top two", () => {
    expect(formatClinchMargin([25.5, 20.5])).toBe("25½ – 20½");
  });

  it("ignores teams below second place", () => {
    expect(formatClinchMargin([14, 9, 7, 2])).toBe("14 – 9");
  });

  it("says nothing with fewer than two teams", () => {
    expect(formatClinchMargin([25.5])).toBe("");
    expect(formatClinchMargin([])).toBe("");
  });
});

/**
 * ── TRUNCATION, with the names actually in use ─────────────────────────────
 *
 * Android cuts a notification title around 40-50 characters in the collapsed
 * shade (the exact point varies by OEM skin and font scale — treat 40 as the
 * safe budget and 50 as the outer edge). The BODY is far more forgiving: it
 * wraps to a second line when collapsed and expands fully on a long-press.
 *
 * So the risk is concentrated entirely in the title, and the title is
 * `Final: {game name}` — six characters of prefix the game name has to live
 * inside. These assertions record which real names fit and which don't, so the
 * failure is visible here rather than on someone's phone.
 */
describe("truncation with real names", () => {
  const TITLE_PREFIX = "Final: ";
  const SAFE = 40;
  const EDGE = 50;

  const GAME_NAMES = [
    "Saturday Singles",
    "Euchre night",
    "Saturday Morning Fourball",
    "Buddy Banks Memorial Invitational",
    "Sunday Singles — Championship Match",
  ];

  it.each(GAME_NAMES)("title for %s", (game) => {
    const title = `${TITLE_PREFIX}${game}`;
    // Nothing here may exceed the outer edge; the report below records which
    // ones cross the SAFE budget and would be cut on a narrower device.
    expect(title.length).toBeLessThanOrEqual(EDGE);
  });

  it("reports the measured title lengths (the record, not a gate)", () => {
    const rows = GAME_NAMES.map((g) => {
      const title = `${TITLE_PREFIX}${g}`;
      return {
        title,
        length: title.length,
        fitsSafe: title.length <= SAFE,
        fitsEdge: title.length <= EDGE,
      };
    });
    // Every real name must at least survive the outer edge.
    expect(rows.every((r) => r.fitsEdge)).toBe(true);
    // The longest cup name in use, inside the longest realistic title.
    expect(`${TITLE_PREFIX}Buddy Banks Memorial Invitational`.length).toBe(40);
  });

  it("the BODY survives at full length for every shape", () => {
    // Bodies are the payload's real content now, so they must not be the thing
    // that overflows. All three stay comfortably inside two lines.
    const bodies = [
      formatResultSummary([
        { name: "Manhattans", points: 2.5 },
        { name: "Centurions", points: 1.5 },
      ]),
      formatResultSummary([
        { name: "Centurions", position: 1 },
        { name: "Manhattans", position: 2 },
      ]),
      `Buddy Banks Memorial Invitational · ${formatClinchMargin([25.5, 20.5])}`,
    ];
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(80);
  });

  it("a long TEAM name is the real overflow risk in a body, and it is bounded", () => {
    // Two long team names in one score line is the worst case the body can hit.
    const worst = formatResultSummary([
      { name: "Buddy Banks Memorial Invitational", points: 25.5 },
      { name: "Centurions of the Back Nine", points: 20.5 },
    ]);
    expect(worst.length).toBeLessThanOrEqual(80);
  });
});

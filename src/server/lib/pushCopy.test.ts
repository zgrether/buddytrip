import { describe, it, expect } from "vitest";
import {
  formatPoints,
  formatResultSummary,
  formatStrokeSummary,
  formatClinchMargin,
} from "./gameFinishNotify";

/**
 * Names used throughout: TEAM names are the ones in `supabase/seed.sql`'s BBMI
 * fixture, which are real-shaped rather than "Team A" — they are long, and that
 * length is the finding. CREW names are full names, because `users.name` holds a
 * full name ("Zach Grether" in the seed) and that is what the summary resolves;
 * testing with "Zach" would measure a string the app never actually sends.
 */
const TEAMS = {
  usual: "The Usual Suspects",
  buddy: "Buddy's Last Stand",
  vibing: "Not Golfing, Just Vibing",
  breeders: "Former Breeders II",
};
const CREW = {
  zach: "Zach Grether",
  bj: "BJ Dennison",
  marcus: "Marcus Thornton",
  jeremy: "Jeremy Maddox",
};

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
    // Reached by MATCH PLAY in a 3+-team competition — not by rack, which its
    // own engine caps at two teams. Points ride along rather than being dropped
    // for the sake of a uniform shape, so the margin still reads.
    expect(
      formatResultSummary([
        { name: TEAMS.usual, points: 12, position: 1 },
        { name: TEAMS.buddy, points: 9, position: 2 },
        { name: TEAMS.breeders, points: 7, position: 3 },
      ])
    ).toBe(
      "1st The Usual Suspects 12 · 2nd Buddy's Last Stand 9 · 3rd Former Breeders II 7"
    );
  });

  it("returns empty when there is nothing to say, so the body can fall back", () => {
    expect(formatResultSummary([])).toBe("");
    expect(formatResultSummary([{ name: "", points: 1 }])).toBe("");
  });
});

describe("ties — an ordinal is NEVER repeated", () => {
  it("two-way tie for the whole field drops ordinals entirely", () => {
    // "1st X · 1st Y" reads as an app bug, not a tie. And "1st" says nothing
    // when there is nobody behind it.
    expect(
      formatResultSummary([
        { name: TEAMS.usual, position: 1 },
        { name: TEAMS.buddy, position: 1 },
      ])
    ).toBe("Tied: The Usual Suspects & Buddy's Last Stand");
  });

  it("a DRAWN match uses the tie form, not a 2 – 2 score line", () => {
    // The score line states the numbers but buries the outcome; "Tied:" leads
    // with what happened.
    expect(
      formatResultSummary([
        { name: TEAMS.usual, points: 2 },
        { name: TEAMS.buddy, points: 2 },
      ])
    ).toBe("Tied: The Usual Suspects & Buddy's Last Stand 2");
  });

  it("three-way tie leads with the COUNT — the part that survives truncation", () => {
    expect(
      formatResultSummary([
        { name: TEAMS.usual, position: 1 },
        { name: TEAMS.buddy, position: 1 },
        { name: TEAMS.breeders, position: 1 },
      ])
    ).toBe("3-way tie: The Usual Suspects, Buddy's Last Stand & Former Breeders II");
  });

  it("four-way tie scales the same way", () => {
    expect(
      formatResultSummary([
        { name: "Alpha", position: 1 },
        { name: "Bravo", position: 1 },
        { name: "Charlie", position: 1 },
        { name: "Delta", position: 1 },
      ])
    ).toBe("4-way tie: Alpha, Bravo, Charlie & Delta");
  });

  it("a PARTIAL tie shares one ordinal rather than printing it twice", () => {
    expect(
      formatResultSummary([
        { name: TEAMS.usual, position: 1 },
        { name: TEAMS.buddy, position: 2 },
        { name: TEAMS.breeders, position: 2 },
      ])
    ).toBe("1st The Usual Suspects · 2nd Buddy's Last Stand & Former Breeders II");
  });

  it("a tied group with points prints the shared score ONCE, not per name", () => {
    expect(
      formatResultSummary([
        { name: "Alpha", points: 12, position: 1 },
        { name: "Bravo", points: 9, position: 2 },
        { name: "Charlie", points: 9, position: 2 },
      ])
    ).toBe("1st Alpha 12 · 2nd Bravo & Charlie 9");
  });

  it("no output anywhere repeats an ordinal", () => {
    // The invariant itself, checked over every tie shape above.
    const shapes = [
      formatResultSummary([
        { name: "A", position: 1 },
        { name: "B", position: 1 },
      ]),
      formatResultSummary([
        { name: "A", position: 1 },
        { name: "B", position: 2 },
        { name: "C", position: 2 },
      ]),
      formatResultSummary([
        { name: "A", position: 1 },
        { name: "B", position: 1 },
        { name: "C", position: 3 },
      ]),
      formatStrokeSummary([
        { name: "A", position: 1 },
        { name: "B", position: 1 },
        { name: "C", position: 3 },
      ]),
    ];
    for (const s of shapes) {
      for (const ord of ["1st", "2nd", "3rd", "4th"]) {
        const hits = s.split(ord).length - 1;
        expect(hits, `"${ord}" appears ${hits}× in "${s}"`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("formatStrokeSummary — capped at top two plus a count", () => {
  it("names the top two and counts the rest", () => {
    expect(
      formatStrokeSummary([
        { name: CREW.zach, position: 1 },
        { name: CREW.bj, position: 2 },
        { name: CREW.marcus, position: 3 },
        { name: CREW.jeremy, position: 4 },
      ])
    ).toBe("1st Zach Grether · 2nd BJ Dennison · +2");
  });

  it("omits the +N when nobody is left over", () => {
    expect(
      formatStrokeSummary([
        { name: CREW.zach, position: 1 },
        { name: CREW.bj, position: 2 },
      ])
    ).toBe("1st Zach Grether · 2nd BJ Dennison");
  });

  it("a tie FOR THE LEAD is expressed — it is what the notification is for", () => {
    expect(
      formatStrokeSummary([
        { name: CREW.zach, position: 1 },
        { name: CREW.bj, position: 1 },
        { name: CREW.marcus, position: 3 },
      ])
    ).toBe("Tied: Zach Grether & BJ Dennison · +1");
  });

  it("a tie BELOW first is deliberately NOT expressed — see the note at the site", () => {
    // 2nd and 3rd tie: one is shown, the other folds into +N. This is the
    // documented trade, not a bug. Expressing it would either re-expand the list
    // the cap exists to bound, or need an ordinal scheme two lines can't explain.
    expect(
      formatStrokeSummary([
        { name: CREW.zach, position: 1 },
        { name: CREW.bj, position: 2 },
        { name: CREW.marcus, position: 2 },
        { name: CREW.jeremy, position: 4 },
      ])
    ).toBe("1st Zach Grether · 2nd BJ Dennison · +2");
  });

  it("a 30-person field stays one short line", () => {
    const field = Array.from({ length: 30 }, (_, i) => ({
      name: `Player Number ${i + 1}`,
      position: i + 1,
    }));
    const out = formatStrokeSummary(field);
    expect(out).toBe("1st Player Number 1 · 2nd Player Number 2 · +28");
    expect(out.length).toBeLessThanOrEqual(60);
  });

  it("returns empty for an empty field", () => {
    expect(formatStrokeSummary([])).toBe("");
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

  /**
   * BODY lengths with the REAL names. Bodies wrap to a second line collapsed and
   * expand on long-press, so ~80 chars is comfortable and ~120 is the point at
   * which a collapsed body starts losing its tail. The team names below are the
   * seed fixture's, which are the long ones — that length is the finding.
   */
  it("body: head-to-head with the two longest real team names", () => {
    const b = formatResultSummary([
      { name: TEAMS.vibing, points: 2.5 },
      { name: TEAMS.breeders, points: 1.5 },
    ]);
    expect(b).toBe("Not Golfing, Just Vibing 2½ – Former Breeders II 1½");
    expect(b.length).toBe(51);
  });

  it("body: a 4-team placement list is the longest shape a real game produces", () => {
    const b = formatResultSummary([
      { name: TEAMS.vibing, position: 1 },
      { name: TEAMS.usual, position: 2 },
      { name: TEAMS.buddy, position: 3 },
      { name: TEAMS.breeders, position: 4 },
    ]);
    // Crosses 80 — still fully readable expanded, tail-cut when collapsed.
    expect(b.length).toBeGreaterThan(80);
    expect(b.length).toBeLessThanOrEqual(130);
  });

  it("body: a 3-way tie with real team names is the worst case overall", () => {
    const b = formatResultSummary([
      { name: TEAMS.vibing, position: 1 },
      { name: TEAMS.usual, position: 1 },
      { name: TEAMS.buddy, position: 1 },
    ]);
    // The COUNT leads, so even a hard cut still says "3-way tie:" first.
    expect(b.startsWith("3-way tie:")).toBe(true);
    expect(b.length).toBeLessThanOrEqual(130);
  });

  it("body: stroke stays short regardless of field size, with full crew names", () => {
    const b = formatStrokeSummary([
      { name: CREW.zach, position: 1 },
      { name: CREW.marcus, position: 2 },
      ...Array.from({ length: 28 }, (_, i) => ({ name: `Player ${i}`, position: i + 3 })),
    ]);
    expect(b).toBe("1st Zach Grether · 2nd Marcus Thornton · +28");
    expect(b.length).toBeLessThanOrEqual(60);
  });

  it("body: the clinch line is short because it carries no names", () => {
    const b = `Buddy Banks Memorial Invitational · ${formatClinchMargin([25.5, 20.5])}`;
    expect(b.length).toBe(45);
  });
});

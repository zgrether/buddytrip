import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeLeaderboard } from "./StrokeLeaderboard";
import { FoursomeEntry, type FoursomeGroupView } from "./rack/FoursomeEntry";
import { ScoreEntryView } from "./ScoreEntryView";
import { computeStrokeLeaderboard } from "@/lib/strokePlay";
import { thruLabel, groupThruLine } from "@/lib/thruLabel";
import { fmtToPar } from "@/lib/rackNStack";
import type { Participant, ScoreUnit } from "./types";

/**
 * RND · THRU · TO PAR, AND **F** FOR A FINISHED ROUND.
 *
 * Four surfaces show how far through a round somebody is — the stroke/scramble
 * board, the rack board, the group cards (shared by all three formats) and the
 * entry row. "thru 18" is the number restating what the letter says better, and
 * it makes a finished player look like they are still out on the course.
 *
 * `thruLabel` is one formatter for that reason: four sites is four chances to
 * disagree, and the round is not always 18 — a 9-hole game is exactly the case
 * a hardcoded literal gets wrong, which is why the count is a required prop
 * rather than a constant.
 */

const PAR: Record<string, number> = Object.fromEntries(
  Array.from({ length: 18 }, (_, i) => [String(i + 1), 4])
);

function board(holes: number, unitCount: number) {
  const entries = Array.from({ length: holes }, (_, i) => ({
    participant_id: "a",
    unit_label: String(i + 1),
    value: 4,
  }));
  const rows = computeStrokeLeaderboard(["a"], entries, PAR, null);
  const people: Participant[] = [{ id: "a", name: "Ann", color: "#e11d48", avatarIcon: null }];
  return renderToStaticMarkup(
    <StrokeLeaderboard rows={rows} participants={people} rubric={null} unitCount={unitCount} />
  );
}

describe("thruLabel", () => {
  it("reads F only once the round is COMPLETE", () => {
    expect(thruLabel(17, 18)).toBe("17");
    expect(thruLabel(18, 18)).toBe("F");
    // A 9-hole round finishes at 9 — the case a hardcoded 18 would call "9".
    expect(thruLabel(9, 9)).toBe("F");
    expect(thruLabel(9, 18)).toBe("9");
  });

  it("never claims F when the round's length is unknown", () => {
    // `unitCount` 0 means no schema to be finished against. Returning "F" for a
    // player thru 0 of 0 would be the worst possible wrong answer.
    expect(thruLabel(0, 0)).toBe("0");
    expect(thruLabel(5, 0)).toBe("5");
  });
});

describe("the stroke board's columns", () => {
  it("reads RND · THRU · TO PAR, not THRU · STRK · TO PAR", () => {
    const html = board(3, 18);
    expect(html).toContain(">Rnd<");
    expect(html).toContain(">Thru<");
    expect(html).toContain(">To par<");
    expect(html).not.toContain(">Strk<");
    // RND leads: the round's score is the number being compared, and THRU
    // qualifies it. Asserted as document ORDER, because a rename alone would
    // pass a pair of `toContain`s while leaving the columns swapped.
    expect(html.indexOf(">Rnd<")).toBeLessThan(html.indexOf(">Thru<"));
    expect(html.indexOf(">Thru<")).toBeLessThan(html.indexOf(">To par<"));
  });

  it("shows F in the THRU cell for a finished round, and the number before it", () => {
    // Anchored to the cell's own testid: "F" is a single letter and the row also
    // carries a name, and 18 appears as a stroke total too.
    expect(board(18, 18)).toContain('data-testid="stroke-lb-thru-a">F<');
    expect(board(3, 18)).toContain('data-testid="stroke-lb-thru-a">3<');
  });
});

describe("the group card", () => {
  const g: FoursomeGroupView = {
    id: "g1",
    name: "Group 1",
    teeLabel: null,
    thru: 18,
    players: [{ id: "p1", name: "Ann", teamColor: "#e11d48" }],
    mine: false,
  };
  const card = (o: Partial<FoursomeGroupView>) =>
    renderToStaticMarkup(<FoursomeEntry groups={[{ ...g, ...o }]} onEnter={() => {}} />);

  it("says F when the group is done, thru N while it is not", () => {
    expect(card({ finished: true })).toContain("F");
    expect(card({ finished: true })).not.toContain("thru 18");
    expect(card({ thru: 7, finished: false })).toContain("thru 7");
  });

  it("still separates NOT STARTED from thru 0", () => {
    // A null thru is "nobody has teed off", which is a different state from a
    // group that has played zero holes of a round in progress.
    expect(card({ thru: null, finished: false })).toContain("not started");
    expect(groupThruLine(null, false)).toBe("not started");
    expect(groupThruLine(0, false)).toBe("thru 0");
  });

  it("PINS THE ENTER AFFORDANCE TO THE TOP, so a wrapped name does not drag it down", () => {
    // `items-center` centred the chevron against a two-line team name, leaving
    // it out of line with the single-line cards beside it in the grid.
    expect(card({ mine: true })).toContain("flex items-start justify-between");
    expect(card({ mine: true })).not.toContain("flex items-center justify-between");
  });
});

describe("the entry row's running line", () => {
  const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({ label: String(i + 1), par: 4 }));
  const team: Participant[] = [{ id: "t1", name: "Do Dead Hookahs Float", color: "#e11d48", avatarIcon: null }];
  // Three holes: 3, 4, 4 on par 4s → total 11, to-par −1.
  const values = { t1: { "1": 3, "2": 4, "3": 4 } };

  /**
   * Hole 4 is UNSCORED, deliberately. “Leading” only renders when the current
   * hole has no golf word to print — on a scored hole the bucket name takes that
   * slot — so a fixture sitting on hole 3 could not reach the branch the control
   * below exists to check, and would have passed for the wrong reason.
   */
  const entry = (runningStyle: "rank" | "toPar") =>
    renderToStaticMarkup(
      <ScoreEntryView
        gameName="Scramble"
        units={units}
        participants={team}
        values={values}
        currentHole={4}
        runningStyle={runningStyle}
        onChange={() => {}}
      />
    );

  it("SCRAMBLE reads Total + To Par, and never says Leading", () => {
    /**
     * With one competitor on the card "Leading" is either vacuously true, or a
     * comparison against teams on other cards — and because this is golf, the
     * group that teed off last leads on holes played alone. A badge decided by
     * tee time is noise wearing a result's clothes.
     */
    const html = entry("toPar");
    // Built with `fmtToPar` rather than a literal: it emits a typographic minus
    // (U+2212), and asserting the glyph would pin the formatter’s choice instead
    // of the relationship this test is about.
    expect(html).toContain(`Total: 11 · To Par: ${fmtToPar(-1)}`);
    expect(html).not.toContain("Leading");
  });

  it("EVERY OTHER FORMAT KEEPS THE RANK LINE — the control", () => {
    // Without this, "no Leading" would also pass against a build that removed
    // the badge for everyone, and it is load-bearing on a real foursome.
    const html = entry("rank");
    expect(html).toContain("11 total");
    expect(html).toContain("Leading");
    expect(html).not.toContain("To Par:");
  });
});

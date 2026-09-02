import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemTeamRollUp, placeLabels, rollUpNote } from "./PickemTeamRollUp";
import type { SideStanding } from "@/lib/pickemBoard";
import type { ScoredPick, ScoredSlateGame } from "@/lib/pickemScoring";

/**
 * Screen G — the team roll-up, N sides wide.
 *
 * The place pill and the lead sentence are the two things that state a result,
 * so they are the two things tested directly.
 */

const team = (id: string) => ({ team: { id }, standing: { total: 0, upside: 0 } });

describe("placeLabels", () => {
  it("reads a dash for everyone before anything is scored", () => {
    /**
     * Everybody is level at zero. Calling the first row "1st" would report a
     * standing that does not exist yet — the same reason the awards read
     * "Nothing awarded yet" rather than paying a first place nobody has taken.
     */
    expect(placeLabels([team("a"), team("b"), team("c")], new Set(), 0)).toEqual([
      "—",
      "—",
      "—",
    ]);
  });

  it("numbers a clean order", () => {
    expect(placeLabels([team("a"), team("b"), team("c")], new Set(), 4)).toEqual([
      "1st",
      "2nd",
      "3rd",
    ]);
  });

  it("marks BOTH sides of a tie, including the one above", () => {
    /**
     * The decisive case, and the one a naive build gets wrong.
     *
     * `tiedWithPrevious` names only the LOWER member of each tied pair, so
     * reading it directly renders "1st" then "T1st" — and a reader seeing those
     * two side by side reasonably concludes the first one is ahead. The count
     * of who holds a place is what decides it.
     */
    const tied = new Set(["b"]);
    expect(placeLabels([team("a"), team("b"), team("c")], tied, 4)).toEqual([
      "T1st",
      "T1st",
      "3rd",
    ]);
  });

  it("skips the places a tie consumed", () => {
    // Two level for first means the next side is THIRD, not second — the tie
    // occupies both places, which is also why the award is averaged across
    // them rather than given twice.
    const tied = new Set(["b"]);
    expect(placeLabels([team("a"), team("b"), team("c"), team("d")], tied, 4)).toEqual([
      "T1st",
      "T1st",
      "3rd",
      "4th",
    ]);
  });

  it("handles a tie further down, and a three-way one", () => {
    expect(
      placeLabels([team("a"), team("b"), team("c"), team("d")], new Set(["c"]), 4)
    ).toEqual(["1st", "T2nd", "T2nd", "4th"]);

    expect(
      placeLabels([team("a"), team("b"), team("c"), team("d")], new Set(["b", "c"]), 4)
    ).toEqual(["T1st", "T1st", "T1st", "4th"]);
  });

  it("gets its ordinals right past the teens", () => {
    const many = Array.from({ length: 13 }, (_, i) => team(`t${i}`));
    const out = placeLabels(many, new Set(), 4);
    expect(out[10]).toBe("11th");
    expect(out[11]).toBe("12th");
    expect(out[12]).toBe("13th");
  });
});

const side = (name: string, total: number, upside: number) => ({
  team: { name },
  standing: { total, upside } as SideStanding,
});

describe("rollUpNote", () => {
  it("says nothing before anything is scored", () => {
    // At nil-all every side is level, so a sentence would be describing the
    // ordering rather than the game.
    expect(rollUpNote([side("A", 0, 40), side("B", 0, 40)], 0, 16, false, null)).toBeNull();
  });

  it("names the leader, the margin, and what the chaser still has", () => {
    expect(rollUpNote([side("A", 41, 20), side("B", 34, 26)], 5, 11, false, "a")).toBe(
      "A by 7 · 26 still in play."
    );
  });

  it("says LEVEL rather than picking one of two equal totals", () => {
    expect(rollUpNote([side("A", 30, 20), side("B", 30, 20)], 5, 11, false, null)).toBe(
      "Level at the top with 11 to play."
    );
  });

  it("gives the clinch its own sentence", () => {
    expect(rollUpNote([side("A", 90, 0), side("B", 10, 5)], 14, 2, true, "a")).toBe(
      "A has clinched — 2 still to play."
    );
  });
});

// ── the rendered surface ───────────────────────────────────────────────────

const SLATE: ScoredSlateGame[] = [
  { id: "g1", result: "home", multiplier: 1 },
  { id: "g2", result: null, multiplier: 1 },
];

const pick = (slateGameId: string, p: "away" | "home", c: number): ScoredPick => ({
  slateGameId,
  pick: p,
  confidence: c,
});

const render = (over: Partial<Parameters<typeof PickemTeamRollUp>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemTeamRollUp
      slate={SLATE}
      sheets={{
        u1: [pick("g1", "home", 5), pick("g2", "home", 3)],
        u2: [pick("g1", "away", 2), pick("g2", "away", 4)],
      }}
      teams={[
        { id: "t1", name: "Team Buddy", shortName: "BUD" },
        { id: "t2", name: "Team Banks", shortName: "BNK" },
      ]}
      teamOf={(u) => (u === "u1" ? "t1" : u === "u2" ? "t2" : null)}
      nameOf={(u) => (u === "u1" ? "Zach" : u === "u2" ? "Ty" : "Guest")}
      meId="u1"
      useConfidence
      resolved={1}
      total={2}
      pointsMode={false}
      {...over}
    />
  );

describe("PickemTeamRollUp", () => {
  it("renders a card per side, ordered by total", () => {
    const html = render();
    // The CARDS carry the SHORT name — a stack of ranked cards read against each
    // other is a label slot. Asserting the short name here rather than the full
    // one is what makes this fail against a build that reverted to `team.name`;
    // `toContain("Team Buddy")` would pass either way, because the prose note
    // below the cards legitimately still spells the full name out.
    expect(html).toContain("BUD");
    expect(html).toContain("BNK");
    // u1 scored on g1, u2 did not — so Buddy leads and comes first.
    expect(html.indexOf("BUD")).toBeLessThan(html.indexOf("BNK"));
  });

  it("spells the full name in the prose note and nowhere else", () => {
    /**
     * The two halves of the slot rule, in one place, on one render — the note is
     * a sentence about a team (subject) and the cards are keys to rows (label).
     * A build that used one name everywhere fails this whichever name it picked.
     */
    const html = render();
    const note = html.slice(html.indexOf('data-testid="pickem-rollup-note"'));
    expect(note).toContain("Team Buddy");

    const cards = html.slice(html.indexOf('data-testid="pickem-board-side"'));
    expect(cards).not.toContain("Team Buddy");
    expect(cards).not.toContain("Team Banks");
  });

  it("grows past two sides rather than dropping them", () => {
    /**
     * The failure this component replaced was `const [a, b] = standings` —
     * correct at two, silently dropping every side after the second. Four in,
     * four out.
     */
    const html = render({
      teams: [
        { id: "t1", name: "Alpha", shortName: "ALP" },
        { id: "t2", name: "Bravo", shortName: "BRA" },
        { id: "t3", name: "Charlie", shortName: "CHA" },
        { id: "t4", name: "Delta", shortName: "DEL" },
      ],
    });
    for (const n of ["ALP", "BRA", "CHA", "DEL"]) {
      expect(html, n).toContain(n);
    }
    expect(html.split('data-testid="pickem-board-side"').length - 1).toBe(4);
  });

  it("shows awards only in a points cup, and only once something is scored", () => {
    // A schedule with nothing played would pay a first place nobody has taken.
    const unscored = render({ pointsMode: true, distribution: [2, 1], resolved: 0 });
    expect(unscored).toContain("Nothing awarded yet");

    const scored = render({ pointsMode: true, distribution: [2, 1] });
    // Split per STYLE_GUIDE §2c. The PLURAL still tracks the displayed value —
    // "1 pt" beside a 1, "pts" beside a 2 — which is why the unit is derived
    // from the same rounded number the value shows.
    expect(scored).toContain(">2<");
    expect(scored).toContain(">pts<");
    expect(scored).toContain(">1<");
    expect(scored).toContain(">pt<");

    // Not a points cup: no award line at all, rather than a zero.
    expect(render()).not.toContain('data-testid="pickem-board-payout"');
  });

  it("does not pay out an EMPTY schedule", () => {
    /**
     * `effectiveDistribution` returns `[]` for a game with no authored split,
     * and `[]` is truthy — the bare check once paid everyone "0 pts", which
     * reads as a decided prize of nothing rather than an unconfigured game.
     */
    expect(render({ pointsMode: true, distribution: [] })).not.toContain(
      'data-testid="pickem-board-payout"'
    );
  });

  it("names a sheet that belongs to no side", () => {
    // Their sheet scores nowhere. Rendering nothing would make a short field
    // and a dropped one look identical.
    const html = render({
      sheets: {
        u1: [pick("g1", "home", 5)],
        u3: [pick("g1", "home", 5)],
      },
    });
    expect(html).toContain("Guest");
  });

  it("shows each person's contribution and what they have left", () => {
    const html = render();
    expect(html).toContain("Zach");
    expect(html).toContain("points from 1 sheet");
    expect(html).toContain('data-testid="pickem-board-participant"');
  });
});

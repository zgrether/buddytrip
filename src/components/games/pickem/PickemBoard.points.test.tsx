import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemBoard } from "./PickemBoard";

/**
 * The board in POINTS MODE — N teams ordered, placement pays (Phase 7).
 *
 * Four teams throughout, because two hides everything that matters here: an
 * unsorted pair reads as a comparison rather than a wrong ranking, and a
 * binary clinch check is correct. The one two-team case is deliberately about
 * NOT special-casing it.
 */

const NAMES: Record<string, string> = {
  a1: "Ann", a2: "Al", b1: "Bo", c1: "Cy", d1: "Di", x1: "Nomad",
};
const TEAM_OF: Record<string, string> = {
  a1: "A", a2: "A", b1: "B", c1: "C", d1: "D",
  // x1 deliberately absent — a sheet on no team.
};

const team = (id: string, name: string) => ({
  id,
  name,
  shortName: name.slice(0, 2).toUpperCase(),
  color: "#123456",
  memberIds: Object.keys(TEAM_OF).filter((u) => TEAM_OF[u] === id),
});

/** Four games, all resolved 'home', so a 'home' pick is worth its confidence. */
const SLATE = [0, 1, 2, 3].map((i) => ({
  id: `g${i}`,
  displayOrder: i,
  awayTeam: "Away",
  homeTeam: "Home",
  multiplier: 1,
  spread: null,
  kickoff: null,
  result: "home" as const,
}));

/** n correct picks out of four, ranked 4..1 so more correct = more points. */
const sheet = (correct: number) =>
  SLATE.map((g, i) => ({
    slateGameId: g.id,
    pick: (i < correct ? "home" : "away") as "home" | "away",
    confidence: 4 - i,
  }));

const render = (
  over: {
    sheets?: Record<string, ReturnType<typeof sheet>>;
    teams?: ReturnType<typeof team>[];
    pointsMode?: boolean;
    distribution?: number[];
    rollUp?: "team_totals" | "individual_matches";
  } = {}
) =>
  renderToStaticMarkup(
    <PickemBoard
      slate={SLATE}
      sheets={over.sheets ?? { a1: sheet(4), b1: sheet(3), c1: sheet(2), d1: sheet(1) }}
      matches={[]}
      rollUp={over.rollUp ?? "team_totals"}
      useConfidence
      meId={null}
      nameOf={(id) => NAMES[id] ?? "Unknown"}
      teams={over.teams ?? [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs"), team("D", "Dogs")]}
      teamOf={(id) => TEAM_OF[id] ?? null}
      pointsMode={over.pointsMode ?? true}
      distribution={over.distribution ?? [2, 1.5, 0.5, 0]}
    />
  );

/** Team names in the order they appear in the rendered markup. */
const orderOf = (html: string, names: string[]) =>
  names
    .map((n) => ({ n, at: html.indexOf(n) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.n);

describe("PickemBoard — points mode", () => {
  it("ORDERS the teams by total, highest first", () => {
    // Roster order here is Aces, Bears, Cubs, Dogs and the totals happen to
    // agree, so the fixture below reverses the roster to prove the SORT is
    // doing it rather than the input happening to be sorted.
    const html = render({
      teams: [team("D", "Dogs"), team("C", "Cubs"), team("B", "Bears"), team("A", "Aces")],
    });
    expect(orderOf(html, ["Aces", "Bears", "Cubs", "Dogs"])).toEqual([
      "Aces",
      "Bears",
      "Cubs",
      "Dogs",
    ]);
  });

  it("shows what each place PAYS, on the card", () => {
    // The Cadence question: can you tell what second is worth without opening
    // anything. A payout behind a tap is the same as one not shown.
    const html = render();
    expect(html).toContain("2 pts");
    expect(html).toContain("1.5 pts");
    expect(html).toContain("0.5 pts");
    expect(html).toContain("0 pts");
  });

  it("names an unassigned sheet WITHOUT saying 'either side'", () => {
    /**
     * "Either side" is two-team language and this is the tenth instance in the
     * feature of copy naming a mechanic that is not in play.
     *
     * The count still has to reconcile — Phase 6's property was that shown plus
     * named equals the total — so the named person is asserted as well as the
     * phrasing.
     */
    const html = render({
      sheets: { a1: sheet(4), b1: sheet(3), c1: sheet(2), d1: sheet(1), x1: sheet(2) },
    });
    expect(html).toContain("Nomad");
    expect(html).not.toContain("either side");
    expect(html).toContain("any team");
  });

  it("still says 'either side' with TWO teams — the control", () => {
    // Without this, a build that said "any team" unconditionally would pass the
    // case above while breaking the match-play board.
    const html = render({
      pointsMode: false,
      teams: [team("A", "Aces"), team("B", "Bears")],
      sheets: { a1: sheet(4), b1: sheet(3), x1: sheet(2) },
    });
    expect(html).toContain("either side");
    expect(html).not.toContain("any team");
  });

  it("IGNORES roll_up entirely — a points cup carrying individual_matches", () => {
    /**
     * The case every other test in this file was blind to, because they all
     * pass `team_totals` and so would pass against a board that never applied
     * the override at all.
     *
     * `roll_up` is inert in a points cup but still SET. Four sites in this
     * component branch on it to choose a MATCH LIST over standings, so a points
     * cup reaching any of them renders a match list for a competition that has
     * no matches. Resolved once at the top of the component rather than at each
     * site, because a fifth site is inevitable.
     */
    const html = render({ rollUp: "individual_matches" });
    expect(html).toContain("Standings");
    expect(html).not.toContain(">Matches<");
    // ...and it is really the ORDERING, not just the heading.
    expect(orderOf(html, ["Aces", "Bears", "Cubs", "Dogs"])).toEqual(["Aces", "Bears", "Cubs", "Dogs"]);
  });

  it("still renders a MATCH LIST under match play with individual_matches", () => {
    // The control: without it, a board that showed standings unconditionally
    // passes the case above and breaks the match-play surface.
    const html = render({ pointsMode: false, rollUp: "individual_matches" });
    expect(html).toContain("Matches");
  });

  it("lists every participant under their team", () => {
    const html = render();
    for (const n of ["Ann", "Bo", "Cy", "Di"]) expect(html).toContain(n);
  });

  it("renders TWO teams as an ordering with payouts, not a match", () => {
    // §4: do not special-case two. A winner and a loser, paid by the schedule.
    const html = render({
      teams: [team("A", "Aces"), team("B", "Bears")],
      sheets: { a1: sheet(4), b1: sheet(1) },
      distribution: [2, 1.5],
    });
    expect(orderOf(html, ["Aces", "Bears"])).toEqual(["Aces", "Bears"]);
    expect(html).toContain("2 pts");
    expect(html).toContain("1.5 pts");
  });

  it("shows NO payout when there is no schedule", () => {
    // An empty distribution renders the ordering without inventing a prize.
    const html = render({ distribution: [] });
    expect(html).not.toContain("pickem-board-payout");
  });

  it("does not show payouts in MATCH-PLAY mode", () => {
    // The placement schedule is a points-mode concept; a match-play board that
    // grew payout chips would be the same class of error as head-to-head copy
    // in a points cup, pointing the other way.
    const html = render({ pointsMode: false });
    expect(html).not.toContain("pickem-board-payout");
  });
});

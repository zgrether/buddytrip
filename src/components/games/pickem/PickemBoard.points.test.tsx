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

// The side cards render the SHORT name (label slot — a stack of ranked cards
// read against each other), so the ordering assertions below look for these,
// not for "Aces"/"Bears". Three characters rather than two: `orderOf` is a
// plain substring search over the whole markup, and a two-letter token is short
// enough to collide with something incidental in it.
const team = (id: string, name: string) => ({
  id,
  name,
  shortName: name.slice(0, 3).toUpperCase(),
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
    matches?: { id: string; sideAId: string | null; sideBId: string | null }[];
  } = {}
) =>
  renderToStaticMarkup(
    <PickemBoard
      slate={SLATE}
      sheets={over.sheets ?? { a1: sheet(4), b1: sheet(3), c1: sheet(2), d1: sheet(1) }}
      matches={over.matches ?? []}
      rollUp={over.rollUp ?? "team_totals"}
      useConfidence
      meId={null}
      nameOf={(id) => NAMES[id] ?? "Unknown"}
      teams={over.teams ?? [team("A", "Aces"), team("B", "Bears"), team("C", "Cubs"), team("D", "Dogs")]}
      avatarFor={() => ({ avatarIcon: null, teamColor: null })}
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
    expect(orderOf(html, ["ACE", "BEA", "CUB", "DOG"])).toEqual([
      "ACE",
      "BEA",
      "CUB",
      "DOG",
    ]);
  });

  it("shows what each place PAYS, on the card", () => {
    // The Cadence question: can you tell what second is worth without opening
    // anything. A payout behind a tap is the same as one not shown.
    const html = render();
    // STYLE_GUIDE §2c — the payout splits, so the value and the unit are
    // separate nodes. Asserted as parts; a contiguous "2 pts" is what passes
    // against a build that never split them.
    for (const v of ["2", "1.5", "0.5", "0"]) expect(html).toContain(`>${v}<`);
    expect(html).toContain(">pts<");
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
    // The roll-up brings its own header now; the board no longer prints one
    // over it, which is why this reads "Team totals" rather than "Standings".
    expect(html).toContain("Team totals");
    expect(html).not.toContain(">Matches<");
    // ...and it is really the ORDERING, not just the heading.
    expect(orderOf(html, ["ACE", "BEA", "CUB", "DOG"])).toEqual(["ACE", "BEA", "CUB", "DOG"]);
  });

  it("still renders a MATCH LIST under match play with individual_matches", () => {
    /**
     * The control: without it, a board that showed standings unconditionally
     * passes the case above and breaks the match-play surface.
     *
     * ── It was not a control, and removing a heading proved it ─────────────
     *
     * This passed for as long as it existed by finding the word "Matches" in
     * the eyebrow — with `matches={[]}`, so not one card ever rendered. Both
     * branches print that eyebrow, so the assertion held whichever branch ran.
     * Dropping the header (§7) is the only reason it ever failed.
     *
     * It now passes REAL pairings and asserts the cards, which is the thing it
     * always claimed to check.
     */
    const html = render({
      pointsMode: false,
      rollUp: "individual_matches",
      matches: [
        { id: "m1", sideAId: "a1", sideBId: "b1" },
        { id: "m2", sideAId: "c1", sideBId: "d1" },
      ],
    });
    expect(html.split('data-testid="pickem-board-match').length - 1).toBe(2);
    // ...and it is the match surface, not the standings one.
    expect(html).not.toContain('data-testid="pickem-board-side"');
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
    expect(orderOf(html, ["ACE", "BEA"])).toEqual(["ACE", "BEA"]);
    for (const v of ["2", "1.5"]) expect(html).toContain(`>${v}<`);
    expect(html).toContain(">pts<");
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

/**
 * ── WHO IS "NOT IN THE SCORING" — THE ROSTER, NOT THE SHEETS ───────────────
 *
 * The list was built from `Object.keys(sheets)` — everybody who had submitted —
 * so a teammate who had not picked yet was invisible. That is backwards: five
 * people unpaired across two teams reported ONE, the only one holding a sheet,
 * and the four the runner most needs to chase were the four it dropped.
 *
 * The rule is on a team, and not in a VALID match. Sheets do not enter into it.
 */
describe("the unassigned note", () => {
  const NOTE = 'data-testid="pickem-board-unassigned"';

  /**
   * The names the note LISTS — its bolded run, not its markup.
   *
   * Two narrowings, each because the wider version failed against correct code:
   *
   * Every name in the note is also elsewhere on the page — a match card, a
   * standings row, a roll-up — so a page-wide assertion about who is NOT listed
   * reads the rest of the board.
   *
   * And the note's own markup is no better. These names are two letters, and
   * `"Bo"` is a substring of `viewBox` in the info icon's SVG. Asserting a short
   * name against HTML matches attributes, not people.
   */
  const listedIn = (html: string) => {
    const at = html.indexOf(NOTE);
    if (at < 0) return "";
    const openB = html.indexOf("<b", at);
    return html.slice(html.indexOf(">", openB) + 1, html.indexOf("</b>", openB));
  };

  it("names people with NO sheet — the ones worth chasing", () => {
    /**
     * The reported shape: everybody on a roster, nobody paired, one sheet
     * between them. A build counting sheets names one of four and passes any
     * assertion that only checks the note exists.
     */
    const html = render({ pointsMode: false, rollUp: "individual_matches", matches: [], sheets: { a1: sheet(4) } });
    expect(html).toContain(NOTE);
    // Everybody ON A TEAM, whether or not they hold a sheet. Only `a1` does.
    const listed = listedIn(html);
    for (const uid of Object.keys(TEAM_OF)) {
      expect(listed, NAMES[uid] + " missing from the note").toContain(NAMES[uid]);
    }
  });

  it("leaves out somebody on NO team — that is the other note's job", () => {
    /**
     * `x1` holds a sheet and belongs to nothing. This note is about people whose
     * TEAM will not score them; a person with no team is `PickemTeamRollUp`'s
     * `unplaced`, and naming them in both would be one fact reported twice with
     * two different remedies.
     *
     * My first version of the case above asserted every NAME rather than every
     * ROSTERED name, and failed against correct code for exactly this reason.
     */
    const html = render({ pointsMode: false, rollUp: "individual_matches", matches: [], sheets: { x1: sheet(4) } });
    expect(html).toContain(NOTE);
    expect(listedIn(html)).not.toContain(NAMES.x1);
  });

  it("counts a HALF-FILLED match as no match at all", () => {
    /**
     * A side of one pairs nobody — the divisor says so and `matchesToSaveRows`
     * drops the row before it is stored. Counting it as paired would hide the
     * person with no opponent, who is the likeliest reason somebody is not in
     * the scoring.
     */
    const html = render({
      pointsMode: false,
      rollUp: "individual_matches",
      matches: [{ id: "m1", sideAId: "a1", sideBId: null }],
      sheets: { a1: sheet(4) },
    });
    expect(html).toContain(NOTE);
    expect(listedIn(html)).toContain(NAMES.a1);
  });

  it("drops somebody once they are in a REAL match", () => {
    // The control. Without it "names everyone" is satisfied by a note that
    // never filters anybody out.
    const html = render({
      pointsMode: false,
      rollUp: "individual_matches",
      matches: [{ id: "m1", sideAId: "a1", sideBId: "b1" }],
      sheets: { a1: sheet(4) },
    });
    const note = listedIn(html);
    expect(note).not.toContain(NAMES.a1);
    expect(note).not.toContain(NAMES.b1);
    // ...and the others are still named, so this is not passing on a note that
    // vanished altogether.
    expect(note).toContain(NAMES.c1);
  });

  it("does not presuppose a sheet in its copy", () => {
    // It fires for people who have not picked, so a sentence about "their
    // sheet" describes something that does not exist.
    const html = render({ pointsMode: false, rollUp: "individual_matches", matches: [], sheets: {} });
    expect(html).toContain(NOTE);
    expect(html).not.toContain("sheet doesn");
    expect(html).not.toContain("sheets don");
    expect(html).toContain("picks won");
  });
});

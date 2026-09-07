import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FoursomeEntry, type FoursomeGroupView } from "./rack/FoursomeEntry";
import { ScorecardLabelCell } from "./StandardGrid";

/**
 * THE SCRAMBLE SURFACE — a tile is a TEAM, and a team is not a person.
 *
 * Four findings from Zach using it, three of which are the same mistake wearing
 * different clothes: machinery built for people, pointed at a team.
 *
 *  · the scorecard abbreviated "Do Dead Hookahs Float" to "D. Float";
 *  · the tile truncated the team name to "Do Dead Hookahs Fl…";
 *  · the tile carried a per-player dot inside what is one scoring unit.
 *
 * The fourth is a real bug rather than a display choice, and it is the one with
 * a failure mode: the tiles read "not started" for the whole round while the
 * board showed every team thru 3.
 */

const TEAM = "#e11d48";

const base: FoursomeGroupView = {
  id: "g1",
  name: "Do Dead Hookahs Float",
  teeLabel: null,
  thru: null,
  players: [
    { id: "p1", name: "Bud Banks", teamColor: TEAM },
    { id: "p2", name: "Rob Drupp", teamColor: TEAM },
  ],
  mine: false,
};

const render = (g: Partial<FoursomeGroupView>) =>
  renderToStaticMarkup(<FoursomeEntry groups={[{ ...base, ...g }]} onEnter={() => {}} />);

describe("the group tile on a scramble game", () => {
  it("WEARS THE TEAM COLOUR and drops the per-player dots", () => {
    const team = render({ teamColor: TEAM });
    // Tinted from the team colour rather than filled with it, so the surface
    // hierarchy's text contrast still holds without a second colour rule.
    expect(team).toContain(`color-mix(in srgb, ${TEAM} 14%, var(--color-bt-card))`);
    expect(team).toContain(`color-mix(in srgb, ${TEAM} 55%, transparent)`);
    // The dots go: a dot per player inside one team-coloured card says there is
    // something to tell apart, and there is not.
    expect(team).not.toContain("border-radius:50%");
    // Names stay — they are the point of listing the roster at all.
    expect(team).toContain("Bud Banks");
    expect(team).toContain("Rob Drupp");
  });

  it("EVERY OTHER FORMAT IS UNTOUCHED — neutral card, dots kept", () => {
    // The control. Without it "no dots" would also pass against a build that
    // removed them everywhere, and the tile is shared with rack and stroke.
    const neutral = render({ teamColor: null });
    expect(neutral).toContain("border-radius:50%");
    expect(neutral).toContain("var(--color-bt-card)");
    expect(neutral).not.toContain("color-mix");
  });

  it("lets a team name WRAP, where a group label still truncates", () => {
    // "Do Dead Hookahs Fl…" tells you almost nothing; "Group 3" loses nothing to
    // an ellipsis. So the behaviour is per-kind, not global.
    expect(render({ teamColor: TEAM })).toContain('class="min-w-0"');
    expect(render({ teamColor: null })).toContain('class="min-w-0 truncate"');
  });

  it("SAYS THRU N ONCE SCORING STARTS — the bug that shipped", () => {
    /**
     * The tiles read "not started" through a whole round because `groupViews`
     * looked up `values[userId]` while a scramble game keys its scores to the
     * GROUP. This asserts the rendered string rather than the lookup, because
     * "not started" is what Zach saw.
     *
     * The lookup itself lives in `StrokeGameView`, which has no harness here —
     * so this pins the component's half and the view's half is covered by the
     * scramble integration test's scoring path. Stated rather than implied.
     */
    expect(render({ thru: 3, teamColor: TEAM })).toContain("thru 3");
    expect(render({ thru: 3, teamColor: TEAM })).not.toContain("not started");
    expect(render({ thru: null, teamColor: TEAM })).toContain("not started");
  });
});

describe("the scorecard label", () => {
  const nameCell = { width: 120 };
  const people = [{ id: "t1", name: "Do Dead Hookahs Float", color: TEAM }];

  it("DOES NOT ABBREVIATE A TEAM AS A PERSON", () => {
    const html = renderToStaticMarkup(
      <ScorecardLabelCell people={people} nameCell={nameCell} kind="team" />
    );
    // The whole name, and specifically NOT the initial-plus-surname form the
    // person ladder produces — which read as a plausible human who does not
    // exist, and is worse than either the full name or a plain truncation.
    expect(html).toContain("Do Dead Hookahs Float");
    expect(html).not.toContain("D. Float");
    expect(html).toContain('data-name-kind="team"');
    // It wraps rather than truncating: a scramble card has one row of scores.
    expect(html).toContain("break-words");
    expect(html).not.toContain("truncate");
  });

  it("STILL ABBREVIATES A PERSON — the control", () => {
    /**
     * Without this, "no D. Float" would also pass against a build that removed
     * the ladder for everyone, and the ladder is load-bearing on the other four
     * formats, where a long name in a 120px cell is genuinely unreadable.
     *
     * `kind` is omitted, not passed as "person": the default is what every
     * existing caller relies on, so the default is what needs pinning.
     */
    const html = renderToStaticMarkup(
      <ScorecardLabelCell
        people={[{ id: "p1", name: "Bartholomew Fotheringay", color: TEAM }]}
        nameCell={nameCell}
      />
    );
    expect(html).toContain("B. Fotheringay");
    expect(html).toContain('data-name-step="2"');
    expect(html).toContain("truncate");
  });
});

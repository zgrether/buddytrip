import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeLeaderboard } from "./StrokeLeaderboard";
import { SkinsBoard } from "./skins/SkinsBoard";
import { NotOnATeamSection } from "./NotOnATeam";
import { computeStrokeLeaderboard } from "@/lib/strokePlay";
import type { Participant } from "./types";

/**
 * #1668 look — someone on no team of a cup plays, and their result counts for
 * no team. The boards show it: their row is muted and their avatar is the
 * OUTLINED no-team one, never a team's filled colour.
 *
 * Every assertion reads ONE row (sliced from its own test id to the next row's),
 * never the whole board: the colour under test is also every counting row's
 * colour, so a whole-board search would find it whatever the not-counting row
 * did (CLAUDE.md, the substring corollary). Each colour check has a CONTROL row
 * of the same colour that must show it, so the absence is not the absence of
 * the colour from the fixture.
 */

const RED = "#ef4444";
const people: Participant[] = [
  { id: "ann", name: "Ann", color: RED },
  { id: "bob", name: "Bob", color: RED },
];

function rowOf(html: string, prefix: string, id: string): string {
  const at = html.indexOf(`data-testid="${prefix}${id}"`);
  expect(at, `${prefix}${id} rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", at);
  const next = html.indexOf(`data-testid="${prefix}`, at + 1);
  return html.slice(start, next === -1 ? undefined : html.lastIndexOf("<div", next));
}

describe("the stroke board", () => {
  const rows = computeStrokeLeaderboard(
    ["ann", "bob"],
    [
      { participant_id: "ann", unit_label: "1", value: 3 },
      { participant_id: "bob", unit_label: "1", value: 4 },
    ],
    { "1": 4 },
    null
  );
  const html = renderToStaticMarkup(
    <StrokeLeaderboard rows={rows} participants={people} notCountingIds={new Set(["ann"])} rubric={null} unitCount={1} />
  );

  it("marks only the not-counting row", () => {
    expect(rowOf(html, "stroke-lb-row-", "ann")).toContain('data-not-counting="true"');
    expect(rowOf(html, "stroke-lb-row-", "bob")).not.toContain("data-not-counting");
  });

  it("the not-counting row carries no team colour; a counting row of the same team colour does", () => {
    expect(rowOf(html, "stroke-lb-row-", "bob")).toContain(RED);
    expect(rowOf(html, "stroke-lb-row-", "ann")).not.toContain(RED);
  });

  it("CONTROL: with nobody off, both rows wear the colour", () => {
    const plain = renderToStaticMarkup(<StrokeLeaderboard rows={rows} participants={people} rubric={null} unitCount={1} />);
    expect(rowOf(plain, "stroke-lb-row-", "ann")).toContain(RED);
  });
});

describe("the skins board", () => {
  const rows = [
    { entityId: "ann", skins: 2, groupingId: "g1", position: 1, started: true },
    { entityId: "bob", skins: 1, groupingId: "g1", position: 2, started: true },
  ];
  const render = (off?: Set<string>) =>
    renderToStaticMarkup(
      <SkinsBoard rows={rows} teamRows={[]} teams={[]} participants={people} notCountingIds={off} unitCount={18} thruOf={() => 3} />
    );

  it("marks only the not-counting row, and strips its team colour", () => {
    const html = render(new Set(["ann"]));
    expect(rowOf(html, "skins-row-", "ann")).toContain('data-not-counting="true"');
    expect(rowOf(html, "skins-row-", "ann")).not.toContain(RED);
    expect(rowOf(html, "skins-row-", "bob")).not.toContain("data-not-counting");
    expect(rowOf(html, "skins-row-", "bob")).toContain(RED);
  });

  it("CONTROL: with nobody off, the row wears the colour", () => {
    expect(rowOf(render(), "skins-row-", "ann")).toContain(RED);
  });
});

describe("the groupings' Not on a team section", () => {
  const team = { id: "red", name: "Red", color: RED };

  it("lists each person with the add", () => {
    const html = renderToStaticMarkup(
      <NotOnATeamSection people={[{ id: "cat", name: "Cat" }]} targets={[team]} note={null} rostersHref="/r" onAdd={() => {}} />
    );
    expect(html).toContain('data-testid="groupings-not-on-a-team"');
    expect(html).toContain("Not on a team");
    expect(html).toContain('data-testid="not-on-a-team-cat"');
    expect(html).toContain('data-testid="add-to-team-cat"');
  });

  it("a viewer with no add sees who can add instead", () => {
    const html = renderToStaticMarkup(
      <NotOnATeamSection people={[{ id: "cat", name: "Cat" }]} targets={[]} note="organizer" rostersHref="/r" onAdd={() => {}} />
    );
    expect(html).not.toContain('data-testid="add-to-team-cat"');
    expect(html).toContain('data-testid="not-on-a-team-note"');
  });

  it("renders nothing when everyone is on a team", () => {
    expect(renderToStaticMarkup(<NotOnATeamSection people={[]} targets={[team]} note={null} rostersHref="/r" onAdd={() => {}} />)).toBe("");
  });
});

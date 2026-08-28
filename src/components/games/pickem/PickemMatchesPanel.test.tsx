import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchesPanel, type PickemTeam } from "./PickemMatchesPanel";

/**
 * The pairing grid's MISMATCH NOTE — the pairing and the rosters disagreeing.
 *
 * `pairingMismatch` is unit-tested next to the helper; this asserts the part
 * only the component can get wrong — that each of the three findings reaches
 * the screen, names the right people, and stays silent when there is nothing
 * to say. The copy is the deliverable here, so the assertions read it.
 */

const team = (id: string, name: string, memberIds: string[]): PickemTeam => ({
  id,
  name,
  shortName: name.slice(0, 3).toUpperCase(),
  color: "#336699",
  memberIds,
});

const NAMES: Record<string, string> = {
  a1: "Zach", a2: "Rob", a3: "Brad",
  b1: "Frank", b2: "Ty",
  ghost: "New Name",
};

const render = (
  teams: [PickemTeam, PickemTeam],
  pairs: { a: string | null; b: string | null }[]
) =>
  renderToStaticMarkup(
    <PickemMatchesPanel
      teams={teams}
      nameOf={(id) => NAMES[id] ?? "Unknown"}
      pairs={pairs}
      pointsTotal={10}
      canEdit
      saving={false}
      onSave={() => {}}
    />
  );

describe("PickemMatchesPanel — the mismatch note", () => {
  it("says NOTHING when the pairing matches the rosters", () => {
    const html = render(
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])],
      [{ a: "a1", b: "b1" }]
    );
    expect(html).not.toContain("pickem-pairing-mismatch");
  });

  it("names a player who is PAIRED but no longer on either team", () => {
    // The live case: a roster change left a stranger in the grid. Without this
    // the runner sees a name in no roster column and nothing explaining it.
    const html = render(
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])],
      [{ a: "ghost", b: "b1" }]
    );
    expect(html).toContain("pickem-pairing-mismatch");
    expect(html).toContain("New Name");
    expect(html).toContain("no longer on either team");
    // ...and the person who is now in no match is named in the same breath,
    // because they are the obvious replacement.
    expect(html).toContain("Zach");
  });

  it("explains an UNEVEN pairing with both counts and the consequence", () => {
    // 8 v 7 — what made `open` refuse by naming one person, with nothing on the
    // pairing screen saying why that person could not be paired. The counts are
    // asserted, not just the sentence: a note that said "uneven" without them
    // would leave the runner counting rows.
    const html = render(
      [
        team("A", "Team Buddy", ["a1", "a2", "a3"]),
        team("B", "Team Banks", ["b1", "b2"]),
      ],
      [{ a: "a1", b: "b1" }, { a: "a2", b: "b2" }]
    );
    expect(html).toContain("Team Buddy has 3");
    expect(html).toContain("Team Banks has 2");
    expect(html).toContain("one player will have no opponent");
  });

  it("counts and pluralises when MORE THAN ONE cannot be paired", () => {
    const html = render(
      [
        team("A", "Team Buddy", ["a1", "a2", "a3"]),
        team("B", "Team Banks", ["b1"]),
      ],
      [{ a: "a1", b: "b1" }]
    );
    expect(html).toContain("2 players will have no opponent");
  });

  it("blames the side that is actually LARGER", () => {
    // Direction, not magnitude. A version that always named side A passes an
    // "is it uneven" assertion and tells the runner to cut the wrong team.
    const html = render(
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1", "b2"])],
      [{ a: "a1", b: "b1" }]
    );
    // The WHOLE clause, in order. Asserting the two names separately passed
    // whichever side was blamed — both strings appear either way — which a
    // mutation forcing largerSide to 0 proved while the helper test caught it.
    expect(html).toContain("Team Banks has 2 and Team Buddy has 1");
  });

  it("does not report an EMPTY SLOT as an off-roster player", () => {
    // Half-filled rows are the normal mid-edit state — the note must not fire
    // on every open slot, or it is noise the runner learns to ignore.
    const html = render(
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])],
      [{ a: "a1", b: null }]
    );
    expect(html).not.toContain("no longer on either team");
    expect(html).toContain("Frank");
  });
});

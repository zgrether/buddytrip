import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketFieldPicker } from "./BracketFieldPicker";
import { BracketPartnerBuilder } from "./BracketPartnerBuilder";
import { BracketSeedList } from "./BracketSeedList";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { BracketSettingsRows } from "./BracketSettingsRows";
import type { BracketConfig } from "@/lib/bracketDraft";
import { buildDraw } from "@/lib/bracket";
import { resolveDraw, matchKey } from "@/lib/bracketAdvance";
import { bracketPlacements } from "@/lib/bracketPlacements";
import { placementPoints } from "@/lib/competitionPlacement";

/**
 * The three setup surfaces render — the guard the pure-model tests can't give.
 *
 * `bracketDraft.test.ts` covers what these components DO to the pool; nothing
 * covered that they mount at all. tsc catches a type error, not a render crash
 * (a bad hook order, a portal touching `document` on the server, dnd-kit needing
 * a DOM), so a broken one would have surfaced only when someone opened the page.
 *
 * Rendered via react-dom/server — the test env is node, there is no RTL, and
 * this is the same idiom `rowPattern.test.tsx` established.
 *
 * These are SMOKE + copy assertions, deliberately shallow. They pin the things
 * the spec is explicit about (pairs on one line, honest randomize copy, no
 * "group is full" language) and leave interaction to the pure model beneath.
 */

const TEAMS: GroupBuilderTeam[] = [
  {
    id: "A",
    name: "Manhattans",
    color: "#ef4444",
    players: [
      { id: "a1", name: "Brad", avatarIcon: null },
      { id: "a2", name: "Zach", avatarIcon: null },
      { id: "a3", name: "Cole", avatarIcon: null },
    ],
  },
  {
    id: "B",
    name: "Old Fashioneds",
    color: "#3b82f6",
    players: [
      { id: "b1", name: "Drew", avatarIcon: null },
      { id: "b2", name: "Sam", avatarIcon: null },
    ],
  },
];

const noop = () => {};

describe("BracketFieldPicker — selection only", () => {
  it("offers every team's roster and reports how many are in", () => {
    const html = renderToStaticMarkup(
      <BracketFieldPicker pool={[["a1"], ["b1"]]} teams={TEAMS} canEdit onChange={noop} />
    );
    expect(html).toContain("Manhattans");
    expect(html).toContain("Old Fashioneds");
    for (const name of ["Brad", "Zach", "Cole", "Drew", "Sam"]) expect(html).toContain(name);
    expect(html).toContain("2 in the field");
  });

  it("says nothing about groups, capacity or being FULL — the concept is gone", () => {
    // The old surface announced "This group is full (max 4). Remove someone to
    // swap" after a single pick, because it was a group builder wearing a
    // field's label. There is no group here to be full.
    const html = renderToStaticMarkup(
      <BracketFieldPicker pool={[["a1"]]} teams={TEAMS} canEdit onChange={noop} />
    );
    // Matched against the COPY, not the markup — `rounded-full` is a class, and
    // a bare /full/i happily matches it.
    expect(html).not.toMatch(/group/i);
    expect(html).not.toMatch(/is full/i);
    expect(html).not.toMatch(/\bmax \d/i);
    expect(html).not.toMatch(/remove someone/i);
  });

  it("offers Everyone when the field is partial, and Clear when it's complete", () => {
    const partial = renderToStaticMarkup(
      <BracketFieldPicker pool={[["a1"]]} teams={TEAMS} canEdit onChange={noop} />
    );
    expect(partial).toContain("Everyone");

    const full = renderToStaticMarkup(
      <BracketFieldPicker
        pool={[["a1"], ["a2"], ["a3"], ["b1"], ["b2"]]}
        teams={TEAMS}
        canEdit
        onChange={noop}
      />
    );
    expect(full).toContain("Clear");
  });

  it("says why there is nothing to pick when nobody is on a cup team", () => {
    const html = renderToStaticMarkup(
      <BracketFieldPicker pool={[]} teams={[]} canEdit onChange={noop} />
    );
    expect(html).toMatch(/cup team/i);
  });
});

describe("BracketPartnerBuilder — pairing, on one line", () => {
  it("renders a made pair as ONE line, not two stacked names", () => {
    const html = renderToStaticMarkup(
      <BracketPartnerBuilder pool={[["a1", "a2"]]} teams={TEAMS} canEdit onChange={noop} />
    );
    expect(html).toContain("Brad &amp; Zach");
  });

  it("counts what is still unpaired, and offers Shuffle pairs", () => {
    const html = renderToStaticMarkup(
      <BracketPartnerBuilder pool={[["a1", "a2"], ["a3"]]} teams={TEAMS} canEdit onChange={noop} />
    );
    expect(html).toContain("1 still unpaired");
    expect(html).toContain("Shuffle pairs");
  });

  it("sends someone to the field first when there is nobody to pair", () => {
    const html = renderToStaticMarkup(
      <BracketPartnerBuilder pool={[]} teams={TEAMS} canEdit onChange={noop} />
    );
    expect(html).toMatch(/field first/i);
  });
});

describe("BracketSeedList — the order", () => {
  const pool = [["a1", "a2"], ["b1", "b2"], ["a3"], ["b1"]];

  it("numbers the seeds and names who each meets first", () => {
    const html = renderToStaticMarkup(
      <BracketSeedList pool={pool} teams={TEAMS} canEdit={false} onChange={noop} onRandomize={noop} />
    );
    // 4 entrants: 1v4, 2v3.
    expect(html).toContain("v 4");
    expect(html).toContain("v 3");
    expect(html).toContain("Brad &amp; Zach"); // pairs stay on one line here too
  });

  it("renders the draggable arm without a DOM, and the read-only arm too", () => {
    // The read-only arm is what a member sees; the editable arm mounts dnd-kit.
    // Both must survive a server render — this is the crash guard.
    expect(() =>
      renderToStaticMarkup(
        <BracketSeedList pool={pool} teams={TEAMS} canEdit onChange={noop} onRandomize={noop} />
      )
    ).not.toThrow();
    const readOnly = renderToStaticMarkup(
      <BracketSeedList pool={pool} teams={TEAMS} canEdit={false} onChange={noop} onRandomize={noop} />
    );
    expect(readOnly).not.toContain("Reorder"); // no handles when you can't edit
  });

  it("explains the seeding rule rather than leaving the order arbitrary", () => {
    const html = renderToStaticMarkup(
      <BracketSeedList pool={pool} teams={TEAMS} canEdit onChange={noop} onRandomize={noop} />
    );
    expect(html).toMatch(/Seed 1 plays the last seed/i);
  });

  it("has nothing to seed before the field is picked", () => {
    const html = renderToStaticMarkup(
      <BracketSeedList pool={[]} teams={TEAMS} canEdit onChange={noop} onRandomize={noop} />
    );
    expect(html).toMatch(/field first/i);
  });
});

describe("the 3rd-place match toggle (item 4)", () => {
  const rows = (config: Partial<BracketConfig>, pool: string[][]) =>
    renderToStaticMarkup(
      <BracketSettingsRows
        config={{ elimination: "single", entrants: "singles", seeding: "manual", consolation: false, ...config }}
        pool={pool}
        teams={TEAMS}
        canEdit
        onConfigChange={noop}
        onPoolChange={noop}
      />
    );

  const four = [["a1"], ["a2"], ["b1"], ["b2"]];

  it("is offered, and says which way it is set", () => {
    expect(rows({}, four)).toContain("Semi-finalists tie for 3rd");
    expect(rows({ consolation: true }, four)).toContain("The losing semi-finalists play off");
  });

  it("needs semis to lose — disabled with the reason below 3 entrants", () => {
    // `buildDraw` only emits the match at two rounds or more. Shown rather than
    // hidden: the setting isn't missing, its prerequisite is.
    expect(rows({}, [["a1"], ["a2"]])).toContain("Needs at least 3 entrants");
  });
});

describe("what the toggle actually changes", () => {
  it("adds the consolation match to the built draw", () => {
    expect(buildDraw(8).some((m) => m.bracket === "consolation")).toBe(false);
    expect(buildDraw(8, { consolation: true }).some((m) => m.bracket === "consolation")).toBe(true);
  });

  it("splits the tied 3rd into a real 3rd and 4th once decided", () => {
    // OFF: the two semi losers tie at 3rd, spanning places 3-4.
    const plain = bracketPlacements(decided(buildDraw(4)));
    expect(plain.filter((p) => p.position === 3)).toHaveLength(2);

    // ON and played: they are separated.
    const withPlayoff = bracketPlacements(decided(buildDraw(4, { consolation: true }), true));
    expect(withPlayoff.filter((p) => p.position === 3)).toHaveLength(1);
    expect(withPlayoff.filter((p) => p.position === 4)).toHaveLength(1);
  });

  it("3rd and 4th distribution values are consumed EITHER WAY — the rows must not be hidden", () => {
    // The reason this item does not remove the 3rd/4th rows when the toggle is
    // off: `placementPoints` averages a tie group across the places it spans, so
    // two players tied at 3rd share (dist[2] + dist[3]) / 2. Zeroing the 4th row
    // would quietly change what every existing bracket pays its semi-finalists.
    const dist = [9, 6, 4, 2];
    const tied = placementPoints(dist, [
      { entityId: "w", value: 4 },
      { entityId: "x", value: 3 },
      { entityId: "y", value: 2 },
      { entityId: "z", value: 2 },
    ], "high_wins");
    expect(tied.get("y")).toBe(3); // (4 + 2) / 2 — the 4th-place value is in there
    expect(tied.get("z")).toBe(3);
  });
});

/** Decide every match in a draw, so placements can be computed. */
function decided(draw: ReturnType<typeof buildDraw>, playConsolation = false) {
  const winners: Record<string, number> = {};
  for (const m of draw) {
    if (m.bracket === "consolation" && !playConsolation) continue;
    const resolvedSoFar = resolveDraw(draw, winners).find(
      (r) => r.bracket === m.bracket && r.round === m.round && r.slot === m.slot
    )!;
    if (resolvedSoFar.aSeed !== null) winners[matchKey(m)] = resolvedSoFar.aSeed;
  }
  return resolveDraw(draw, winners);
}

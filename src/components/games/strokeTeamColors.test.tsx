import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeLeaderboard } from "./StrokeLeaderboard";
import { FoursomeEntry } from "./rack/FoursomeEntry";
import { teamColorByUser, UNASSIGNED_TEAM_ID, type RosterTeam } from "@/lib/teamRosterColors";
import { computeStrokeLeaderboard } from "@/lib/strokePlay";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import type { Participant } from "@/components/games/types";

/**
 * A PLAYER WEARS THEIR TEAM'S COLOUR — on the board and on the group tiles.
 *
 * ── Asserted against the palette, never against a literal ───────────────────
 *
 * Every expectation below reads `WTH.color` / `TA.color` / `DH.color` out of
 * the same fixture the components were fed. A test hardcoding `#e11d48` would
 * pass against a build that painted every avatar red for an unrelated reason,
 * and would need editing every time a team's colour changed — it would be
 * asserting a colour rather than the RELATIONSHIP, which is the whole claim.
 *
 * ── What this covers, and what it does not ──────────────────────────────────
 *
 * These span the derivation (`teamColorByUser`) into both real consumers, which
 * is where the two surfaces could disagree. They do NOT render `StrokeGameView`
 * — no harness in this suite reaches a tRPC-hook component — so they cannot see
 * a view that stops consulting the resolver.
 *
 * That gap is smaller than it was and worth naming precisely: the board and the
 * tiles now read ONE value (`fieldParticipants`, which `groupViews` derives
 * from), so there is one wiring to get wrong rather than two that must agree.
 * Unlike the Stableford sort, a type cannot help here — every candidate is a
 * `string`, and a wrong colour is as well-typed as a right one.
 */

// Three teams, because BBMI 2024 is a three-team points cup and the two-team
// case is the one that already worked everywhere by accident.
const WTH: RosterTeam = { id: "t-wth", color: "#e11d48", players: [{ id: "frank" }, { id: "steve" }] };
const TA: RosterTeam = { id: "t-ta", color: "#f59e0b", players: [{ id: "taj" }] };
const DH: RosterTeam = { id: "t-dh", color: "#22c55e", players: [{ id: "merling" }] };
/** The picker's display bucket for everyone on no team — NOT a team. */
const CREW: RosterTeam = {
  id: UNASSIGNED_TEAM_ID,
  color: "var(--color-bt-text-dim)",
  players: [{ id: "nomad" }],
};

const SECTIONS = [WTH, TA, DH, CREW];

/** What `StrokeGameView.fieldParticipants` does, in the same precedence. */
function fieldParticipants(ids: string[], teams: RosterTeam[]): Participant[] {
  const teamColorOf = teamColorByUser(teams);
  return ids.map((id, i) => ({
    id,
    name: id,
    color: teamColorOf.get(id) ?? PLAYER_COLORS[i % PLAYER_COLORS.length],
    avatarIcon: null,
  }));
}

describe("teamColorByUser", () => {
  it("resolves every team, not just the first two", () => {
    const m = teamColorByUser(SECTIONS);
    expect(m.get("frank")).toBe(WTH.color);
    expect(m.get("steve")).toBe(WTH.color);
    expect(m.get("taj")).toBe(TA.color);
    // The third team is the case a `teams.length === 2` gate would drop, and
    // the reason this resolver deliberately has no such gate.
    expect(m.get("merling")).toBe(DH.color);
  });

  it("excludes the unassigned bucket — teamless is ABSENT, not dim grey", () => {
    const m = teamColorByUser(SECTIONS);
    // Absent, so the call site reaches its palette fallback. Admitting the
    // bucket would hand back `var(--color-bt-text-dim)` — a real string that
    // renders, so the failure would be a page of identical grey dots rather
    // than an error.
    expect(m.has("nomad")).toBe(false);
    expect([...m.values()]).not.toContain(CREW.color);
  });

  it("is empty for a game with no competition — the standalone path is untouched", () => {
    expect(teamColorByUser([]).size).toBe(0);
  });
});

describe("the leaderboard paints a player their team's colour", () => {
  const IDS = ["frank", "taj", "merling", "nomad"];

  function boardHtml(teams: RosterTeam[]) {
    const people = fieldParticipants(IDS, teams);
    const rows = computeStrokeLeaderboard(
      IDS,
      IDS.map((id, i) => ({ participant_id: id, unit_label: "1", value: 4 + i })),
      { "1": 4 },
      null
    );
    return { html: renderToStaticMarkup(<StrokeLeaderboard rows={rows} participants={people} rubric={null} />), people };
  }

  it("carries each team's own colour, read from the competition's palette", () => {
    const { html } = boardHtml(SECTIONS);
    expect(html).toContain(WTH.color);
    expect(html).toContain(TA.color);
    expect(html).toContain(DH.color);
  });

  it("does NOT paint them the identity palette that produced the reported bug", () => {
    const { people } = boardHtml(SECTIONS);
    // The defect was `PLAYER_COLORS[i % 4]` — teal/blue/amber/purple, unrelated
    // to the competition. Frank, Taj and Merling are all on teams, so none of
    // them may take a palette colour.
    //
    // Asserted on the resolved participant rather than the markup because
    // `#f59e0b` is BOTH TA's colour here and `PLAYER_COLORS[2]`: a substring
    // check over the HTML could not tell the two apart, and would pass against
    // the broken build for Taj. The collision is deliberate — it is the exact
    // coincidence that makes a naive assertion useless.
    expect(people.find((p) => p.id === "frank")!.color).toBe(WTH.color);
    expect(people.find((p) => p.id === "merling")!.color).toBe(DH.color);
    expect(people.find((p) => p.id === "taj")!.color).toBe(TA.color);
    expect(PLAYER_COLORS).not.toContain(WTH.color);
    expect(PLAYER_COLORS).not.toContain(DH.color);
  });

  it("falls back to the per-player palette for a teamless player", () => {
    const { people } = boardHtml(SECTIONS);
    const nomad = people.find((p) => p.id === "nomad")!;
    expect(PLAYER_COLORS).toContain(nomad.color);
    expect(nomad.color).not.toBe(CREW.color);
  });

  it("a game with NO teams keeps the palette for everyone — the standalone path", () => {
    const { people } = boardHtml([]);
    for (const p of people) expect(PLAYER_COLORS).toContain(p.color);
  });
});

describe("the group tiles paint the same colour as the board", () => {
  it("a player's dot is their team's colour, from the one shared source", () => {
    const ids = ["frank", "taj", "merling"];
    const people = fieldParticipants(ids, SECTIONS);
    // `groupViews` derives the tile players from `fieldParticipants` — this
    // mirrors that derivation, which is what makes the two surfaces agree by
    // construction rather than by two lookups.
    const html = renderToStaticMarkup(
      <FoursomeEntry
        groups={[
          {
            id: "g1",
            name: "Group 1",
            teeLabel: null,
            thru: 2,
            mine: false,
            finished: false,
            players: ids.map((id) => ({
              id,
              name: id,
              teamColor: people.find((p) => p.id === id)!.color,
            })),
          },
        ]}
        onEnter={() => {}}
      />
    );

    // The dot's inline style names the colour; three teams, three colours.
    expect(html).toContain(`background:${WTH.color}`);
    expect(html).toContain(`background:${TA.color}`);
    expect(html).toContain(`background:${DH.color}`);
  });
});

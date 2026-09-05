import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeTeamTotals } from "./StrokeTeamTotals";
import {
  computeStrokeLeaderboard,
  computeStrokePlayStandings,
  computeStrokeTeamStandings,
  netStrokeEntriesByHole,
  stablefordEntries,
} from "@/lib/strokePlay";
import { STABLEFORD_PRESETS } from "@/lib/stableford";
import { readStrokeConfig, rollUpOf, writeStrokeConfig, DEFAULT_ROLL_UP } from "@/lib/strokeGameConfig";
import type { StablefordRubric } from "@/lib/stableford";

/**
 * TEAM TOTALS — the roll-up, the live pipeline, and the board section.
 *
 * ── What these cover, and what they do not ─────────────────────────────────
 *
 * They pin the config round-trip, the live team pipeline (which is the server's
 * own, with one deliberate difference), and the rendered section. They do NOT
 * render `StrokeGameView`, so as with the two PRs before this they cannot see a
 * view that stops consulting `rollUpOf`. The whole-config write is the part a
 * type does cover: `writeStrokeConfig` takes the complete config, so a payload
 * that omits `rollUp` and wipes it is a `tsc` error rather than a silent loss.
 */

const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;
const PAR4: Record<string, number> = { "1": 4, "2": 4, "3": 4 };
const TEAMS = [
  { id: "t-wth", name: "WTH", color: "#e11d48" },
  { id: "t-ta", name: "TA", color: "#f59e0b" },
  { id: "t-dh", name: "DH", color: "#22c55e" },
];

function gross(id: string, ...vals: number[]) {
  return vals.map((v, i) => ({ participant_id: id, unit_label: String(i + 1), value: v }));
}

/**
 * The view's live team pipeline, reproduced exactly — including the STARTED
 * filter, which is the one place it differs from `computeStrokePlayResults`.
 */
function liveTeamRows(
  fieldIds: string[],
  raw: { participant_id: string; unit_label: string; value: number }[],
  teamOf: Record<string, string>,
  rubric: StablefordRubric | null
) {
  const netted = netStrokeEntriesByHole(raw, {});
  const board = computeStrokeLeaderboard(fieldIds, netted, PAR4, rubric);
  const started = new Set(board.filter((r) => r.started).map((r) => r.entityId));
  if (started.size === 0) return [];
  const startedEntries = netted.filter((e) => started.has(e.participant_id));
  const scoring = rubric ? ("stableford" as const) : ("traditional" as const);
  const scored = rubric
    ? stablefordEntries(startedEntries, PAR4, rubric)
    : startedEntries.map((e) => ({ participant_id: e.participant_id, value: e.value }));
  return computeStrokeTeamStandings(
    computeStrokePlayStandings([...started], scored, { scoring }),
    teamOf,
    scoring
  );
}

describe("the roll-up setting", () => {
  it("defaults to individual — every game that exists today is unaffected", () => {
    expect(rollUpOf(undefined)).toBe("individual");
    expect(rollUpOf(null)).toBe("individual");
    expect(rollUpOf({})).toBe("individual");
    // The whole history of the app carries `config = '{}'`, which is why the
    // unrecognised direction has to resolve here and not to team totals.
    expect(rollUpOf({ scoringType: "stableford" })).toBe("individual");
    expect(rollUpOf({ rollUp: "nonsense" })).toBe(DEFAULT_ROLL_UP);
  });

  it("round-trips through the writer the payload uses", () => {
    const written = writeStrokeConfig({
      scoring: { type: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } },
      rollUp: "team_totals",
    });
    const read = readStrokeConfig(written);
    expect(read.rollUp).toBe("team_totals");
    expect(read.scoring).toEqual({ type: "stableford", rubric: BBMI });
  });

  it("carries the roll-up across a scoring-type change, and vice versa", () => {
    // The two settings share one jsonb column that is REPLACED wholesale, so
    // this is the case that would silently wipe if either were written alone.
    const teamStableford = writeStrokeConfig({
      scoring: { type: "stableford", stableford: { preset: "standard", ...STABLEFORD_PRESETS.standard.rubric } },
      rollUp: "team_totals",
    });
    expect(rollUpOf(teamStableford)).toBe("team_totals");

    const backToTraditional = writeStrokeConfig({
      scoring: { type: "traditional", stableford: null },
      rollUp: rollUpOf(teamStableford),
    });
    expect(readStrokeConfig(backToTraditional)).toEqual({
      scoring: { type: "traditional", rubric: null },
      rollUp: "team_totals",
    });
  });
});

describe("the live team pipeline", () => {
  const TEAM_OF = { frank: "t-wth", steve: "t-wth", taj: "t-ta", merling: "t-dh" };

  it("ranks three teams on their players' combined net strokes, lowest first", () => {
    const rows = liveTeamRows(
      ["frank", "steve", "taj", "merling"],
      [
        ...gross("frank", 4, 4, 4), // 12
        ...gross("steve", 5, 5, 5), // 15  → WTH 27
        ...gross("taj", 6, 6, 6), //   18  → TA 18
        ...gross("merling", 5, 5, 4), // 14 → DH 14
      ],
      TEAM_OF,
      null
    );
    expect(rows.map((r) => [r.teamId, r.total, r.position])).toEqual([
      ["t-dh", 14, 1],
      ["t-ta", 18, 2],
      ["t-wth", 27, 3],
    ]);
  });

  it("A TEAM THAT HAS NOT TEED OFF GETS NO ROW — a zero total is a WIN under lowest-wins", () => {
    /**
     * The corruption `computeStrokePlayStandings`' own doc records, in its team
     * form: without the started filter, WTH and TA contribute nothing, total 0,
     * and lead a team that has actually played golf.
     *
     * This is the assertion that separates the built pipeline from the obvious
     * one (`computeStrokePlayStandings` over the whole field with no
     * `requiredUnits`), and it is the only case in this file where the two
     * differ.
     */
    const rows = liveTeamRows(
      ["frank", "steve", "taj", "merling"],
      gross("merling", 5, 5, 5), // only DH has played
      TEAM_OF,
      null
    );
    expect(rows.map((r) => r.teamId)).toEqual(["t-dh"]);
    expect(rows[0].total).toBe(15);
  });

  it("ranks by POINTS, highest first, under Stableford — where strokes would disagree", () => {
    // The same disagreement the individual board turns on, at team scale:
    // WTH plays steady bogeys, DH takes two pars and a blow-up.
    const rows = liveTeamRows(
      ["frank", "merling"],
      [...gross("frank", 5, 5, 5), ...gross("merling", 4, 4, 12)],
      { frank: "t-wth", merling: "t-dh" },
      BBMI
    );
    // frank: 2+2+2 = 6 pts (to-par +3). merling: 4+4+0 = 8 pts (to-par +8).
    expect(rows.map((r) => [r.teamId, r.total, r.position])).toEqual([
      ["t-dh", 8, 1],
      ["t-wth", 6, 2],
    ]);
    // And the traditional reading of the same cards puts them the other way —
    // which is what makes the case above evidence rather than a coincidence.
    const traditional = liveTeamRows(
      ["frank", "merling"],
      [...gross("frank", 5, 5, 5), ...gross("merling", 4, 4, 12)],
      { frank: "t-wth", merling: "t-dh" },
      null
    );
    expect(traditional.map((r) => r.teamId)).toEqual(["t-wth", "t-dh"]);
  });

  it("ignores a player on no team rather than attributing them somewhere", () => {
    const rows = liveTeamRows(
      ["frank", "nomad"],
      [...gross("frank", 4, 4, 4), ...gross("nomad", 3, 3, 3)],
      { frank: "t-wth" },
      null
    );
    expect(rows.map((r) => r.teamId)).toEqual(["t-wth"]);
    expect(rows[0].total).toBe(12); // not 21
  });
});

describe("the team-totals section", () => {
  const ROWS = [
    { teamId: "t-dh", total: 14, playerCount: 1, position: 1 },
    { teamId: "t-ta", total: 18, playerCount: 1, position: 2 },
    { teamId: "t-wth", total: 27, playerCount: 2, position: 3 },
  ];

  it("names each team and paints its own colour, from the competition's palette", () => {
    const html = renderToStaticMarkup(
      <StrokeTeamTotals rows={ROWS} teams={TEAMS} rubric={null} />
    );
    for (const t of TEAMS) {
      expect(html).toContain(t.name);
      expect(html).toContain(t.color);
    }
  });

  it("shows the total, and NO thru — a team's thru is not a quantity", () => {
    const html = renderToStaticMarkup(
      <StrokeTeamTotals rows={ROWS} teams={TEAMS} rubric={null} />
    );
    // The total is anchored per team: 14, 18 and 27 all appear in this region
    // and a bare number match could not say which cell produced one.
    expect(html).toContain('data-testid="stroke-team-total-t-wth">27<');
    expect(html).toContain('data-testid="stroke-team-total-t-dh">14<');

    /**
     * A single player's THRU is a real number; a team's is a sum over different
     * people's unrelated progress, which is not a hole count and not anything a
     * reader can act on. It was here and it was removed — this is the guard
     * against it coming back, and against the same figure returning under
     * another name (points-per-hole, a rate, a percentage), which would be a
     * projection presented as a plain column.
     *
     * The heading check is the part that catches a re-add wearing new words:
     * the section has exactly ONE column heading.
     */
    expect(html).not.toContain("stroke-team-thru-");
    expect(html).not.toContain(">Thru<");
    expect((html.match(/uppercase tracking-wider/g) ?? []).length).toBe(2); // eyebrow + one column
  });

  it("heads the total column STRK under Traditional and PTS under Stableford", () => {
    const strokes = renderToStaticMarkup(
      <StrokeTeamTotals rows={ROWS} teams={TEAMS} rubric={null} />
    );
    const points = renderToStaticMarkup(
      <StrokeTeamTotals rows={ROWS} teams={TEAMS} rubric={BBMI} />
    );
    expect(strokes).toContain(">Strk<");
    expect(strokes).not.toContain(">Pts<");
    expect(points).toContain(">Pts<");
    expect(points).not.toContain(">Strk<");
  });

  it("says nobody has started rather than showing an empty ranked list", () => {
    const html = renderToStaticMarkup(
      <StrokeTeamTotals rows={[]} teams={TEAMS} rubric={null} />
    );
    expect(html).toContain("stroke-team-totals-empty");
    expect(html).toContain("No team has started");
    // Not a ranked list of zeroes — "has not teed off" and "scored nothing"
    // are different states and only one of them belongs on a leaderboard.
    expect(html).not.toContain("stroke-team-row-");
  });
});

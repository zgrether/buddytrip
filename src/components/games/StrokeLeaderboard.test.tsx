import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrokeLeaderboard } from "./StrokeLeaderboard";
import { computeStrokeLeaderboard, netStrokeEntriesByHole } from "@/lib/strokePlay";
import { STABLEFORD_PRESETS } from "@/lib/stableford";
import type { Participant } from "@/components/games/types";

/**
 * THE BOARD, FED BY THE ENGINE — the seam the Stableford sort fell through.
 *
 * ── What these cover, and what they do not ─────────────────────────────────
 *
 * The bug was that `StrokeGameView` called `computeStrokeLeaderboard` with
 * three arguments, so a Stableford game ranked by to-par. `strokePlayDirection
 * .test.ts:153` already holds the exact fixture that separates the two
 * orderings — and it passes, because it calls the engine directly and nothing
 * rendered the view to check what the view passes. The test and the bug never
 * intersected.
 *
 * These tests move one seam closer: they run the ENGINE's real output into the
 * REAL board, so a column that disagrees with the ordering fails here. They
 * still do not render `StrokeGameView` (it is a tRPC-hook component with no
 * harness in this suite), so they cannot see a view that drops the argument.
 *
 * **That case is covered by the type, not by a test.** `rubric` is a REQUIRED
 * parameter on both `computeStrokeLeaderboard` and this component, so omitting
 * it is a `tsc` error, and `npx tsc --noEmit` is a merge-blocking CI step
 * (ci.yml:185). Verified red rather than assumed: making it required failed
 * five existing call sites immediately. A type check is exhaustive over call
 * sites in a way a source scan is not — which matters here, because the source
 * scan built for exactly this class (`strokeRankingDirection.guard.test.ts`,
 * widened once after missing a real one in this same file) could not see this
 * bug either. It looks for a WRONG direction literal, and the defect was an
 * ABSENT argument.
 *
 * Stated rather than implied, per CLAUDE.md: a test file that names its own
 * limit is worth more than one that suggests coverage it does not have.
 */

const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;

/** Three par-4 holes — the same shape the engine's own direction tests use. */
const PAR4: Record<string, number> = { "1": 4, "2": 4, "3": 4 };

function gross(id: string, ...vals: number[]) {
  return vals.map((v, i) => ({ participant_id: id, unit_label: String(i + 1), value: v }));
}

/**
 * The fixture is the point, and it is the one the live data cannot produce.
 *
 *   steady — three bogeys     → to-par +3, points 2+2+2 = 6
 *   spiky  — two pars, a 12   → to-par +8, points 4+4+0 = 8
 *
 * The blow-up stops costing past the floor, so `spiky` has the WORSE card and
 * the BETTER points. Rank on to-par and `steady` leads; rank on points and
 * `spiky` does. Zach's live game is two holes in, where the two orderings agree
 * — which is exactly why looking at it could not settle this.
 */
const STEADY_VS_SPIKY = netStrokeEntriesByHole(
  [...gross("steady", 5, 5, 5), ...gross("spiky", 4, 4, 12)],
  {}
);

const PEOPLE: Participant[] = [
  { id: "steady", name: "Steady", color: "#e11d48", avatarIcon: null },
  { id: "spiky", name: "Spiky", color: "#f59e0b", avatarIcon: null },
];

/** Document order of a row, by its own testid — an anchor no other node emits. */
function rowOrder(html: string, ids: string[]): string[] {
  return [...ids]
    .map((id) => ({ id, at: html.indexOf(`data-testid="stroke-lb-row-${id}"`) }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((r) => r.id);
}

describe("the Stableford board", () => {
  it("renders in POINTS order where to-par would disagree", () => {
    const rows = computeStrokeLeaderboard(["steady", "spiky"], STEADY_VS_SPIKY, PAR4, BBMI);
    const html = renderToStaticMarkup(
      <StrokeLeaderboard rows={rows} participants={PEOPLE} rubric={BBMI} />
    );

    // The ORDER on screen, not the order in the array the engine returned.
    expect(rowOrder(html, ["steady", "spiky"])).toEqual(["spiky", "steady"]);
  });

  it("shows each player's points in a cell only that player's row emits", () => {
    const rows = computeStrokeLeaderboard(["steady", "spiky"], STEADY_VS_SPIKY, PAR4, BBMI);
    const html = renderToStaticMarkup(
      <StrokeLeaderboard rows={rows} participants={PEOPLE} rubric={BBMI} />
    );

    // Anchored per player, because 8 and 6 are short generic numbers and the
    // row also prints thru, strokes and to-par. `+8` and `8` would collide.
    expect(html).toContain('data-testid="stroke-lb-pts-spiky">8<');
    expect(html).toContain('data-testid="stroke-lb-pts-steady">6<');
    expect(html).toContain('data-testid="stroke-lb-col-pts"');
  });

  it("keeps STRK and TO PAR alongside PTS — a true fact is not dropped to fit a new one", () => {
    const rows = computeStrokeLeaderboard(["steady", "spiky"], STEADY_VS_SPIKY, PAR4, BBMI);
    const html = renderToStaticMarkup(
      <StrokeLeaderboard rows={rows} participants={PEOPLE} rubric={BBMI} />
    );

    expect(html).toContain(">Thru<");
    expect(html).toContain(">Strk<");
    expect(html).toContain(">To par<");
    expect(html).toContain(">Pts<");
    // spiky's card is still 20 strokes and +8 — the board reports the round as
    // played as well as what it pays.
    expect(html).toContain(">20<");
    expect(html).toContain(">+8<");
  });
});

describe("the Traditional board is unchanged", () => {
  it("ranks by to-par and renders NO points column", () => {
    const rows = computeStrokeLeaderboard(["steady", "spiky"], STEADY_VS_SPIKY, PAR4, null);
    const html = renderToStaticMarkup(
      <StrokeLeaderboard rows={rows} participants={PEOPLE} rubric={null} />
    );

    // The other ordering — which is what makes the Stableford case above
    // evidence rather than a coincidence of this fixture.
    expect(rowOrder(html, ["steady", "spiky"])).toEqual(["steady", "spiky"]);
    expect(html).not.toContain("stroke-lb-col-pts");
    expect(html).not.toContain("stroke-lb-pts-");
    expect(html).not.toContain(">Pts<");
  });

  it("renders byte-for-byte what it rendered before the points column existed", () => {
    /**
     * The literal reading of "do not change the Traditional board". A snapshot
     * would drift with any unrelated edit and get re-blessed; this pins the
     * three things the constraint is actually about — the column set, the
     * emphasis on to-par, and the ordering — against a build that widened the
     * row for everyone.
     *
     * `font-bold` on to-par is the emphasis assertion: under Stableford that
     * moves to PTS, so a build applying the Stableford treatment unconditionally
     * fails here. Anchored to the cell's own class string rather than to the
     * word "bold", which appears on the rank and the name too.
     */
    const rows = computeStrokeLeaderboard(["steady", "spiky"], STEADY_VS_SPIKY, PAR4, null);
    const html = renderToStaticMarkup(
      <StrokeLeaderboard rows={rows} participants={PEOPLE} rubric={null} />
    );

    expect(html).toContain('class="w-12 text-right text-sm font-bold tabular-nums"');
    // Four numeric columns would mean five `w-` trailing cells per row; three
    // means three. Counting the header's column spans is the cheapest form.
    const headerCols = (html.match(/uppercase tracking-wider/g) ?? []).length;
    expect(headerCols).toBe(4); // "Leaderboard" eyebrow + Thru + Strk + To par
  });
});

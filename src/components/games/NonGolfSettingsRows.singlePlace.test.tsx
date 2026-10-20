import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NonGolfSettingsRows, usesPointsPool } from "./NonGolfSettingsRows";
import { configToNonGolfDraft, isRealSplit, isWinnerTakesAll, type NonGolfConfigDraft } from "@/lib/configDraft";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import type { PointsDistribution } from "@/lib/pointsDistribution";

/**
 * #920 — a one-place split `[8]` is winner-takes-all on every page.
 *
 * `isWinnerTakesAll` called `[8]` winner-takes-all while the non-golf page's
 * readers asked `isPlacement`, which `[8]` passes. The stroke page normalized
 * `[8]` away in its draft; the non-golf page did not, so the same bytes read
 * "Winner takes all" on one and "Custom placement split" on the other.
 *
 * Fixed twice over, and each is tested on its own:
 *  - the non-golf draft normalizes `[8]` to null, as the stroke draft does;
 *  - both non-golf readers ask `isRealSplit`, so even an UN-normalized `[8]`
 *    reaching the row reads winner-takes-all.
 */

const ONE: PointsDistribution = { type: "placement", values: [8] };
const TWO: PointsDistribution = { type: "placement", values: [5, 3] };

const GAME: GameRow = {
  id: "g1", competition_id: "comp1", game_type_id: "gtt_generic_card", name: "Cards", status: "pending",
  points_distribution: ONE, points_total: 8, competition_format: null, rules_for_today: null, modifiers: null,
  scorecard_schema: null, course_id: null, back_course_id: null, schedule_item_id: null, corrections_open: false,
};

/** The distribution row's subtitle, read off the row's own test id. */
function subtitle(draft: NonGolfConfigDraft): string {
  const html = renderToStaticMarkup(
    <NonGolfSettingsRows
      game={GAME}
      scoringModel="match_play"
      draft={draft}
      canEdit
      capacity={{ count: 2, source: "teams" }}
      onFormatChange={() => {}}
      onPointsTotalChange={() => {}}
      onPointsDistChange={() => {}}
    />,
  );
  const at = html.indexOf('data-testid="row-point-distribution"');
  expect(at, "the distribution row rendered").toBeGreaterThan(-1);
  const row = html.slice(at, html.indexOf("</button>", at));
  return row;
}

describe("isRealSplit", () => {
  it("is two or more places, and nothing else", () => {
    expect(isRealSplit(TWO)).toBe(true);
    expect(isRealSplit(ONE)).toBe(false);
    expect(isRealSplit(null)).toBe(false);
    expect(isRealSplit({ type: "per_match", value: 3 })).toBe(false);
  });

  it("among placements, it is exactly the complement of isWinnerTakesAll", () => {
    for (const d of [ONE, TWO, { type: "placement" as const, values: [] as number[] }, { type: "placement" as const, values: [4, 2, 1] }]) {
      expect(isRealSplit(d), JSON.stringify(d)).toBe(!isWinnerTakesAll(d));
    }
  });
});

describe("a one-place split reads winner-takes-all on the non-golf page (#920)", () => {
  it("the draft normalizes [8] to null, as the stroke draft does; a real split passes through", () => {
    expect(configToNonGolfDraft({ ...GAME, points_distribution: ONE } as never, []).pointsDistribution).toBeNull();
    expect(configToNonGolfDraft({ ...GAME, points_distribution: TWO } as never, []).pointsDistribution).toEqual(TWO);
  });

  it("through the draft, the row says winner takes all", () => {
    const row = subtitle(configToNonGolfDraft(GAME as never, []));
    expect(row).toContain("Winner takes all");
    expect(row).not.toContain("Custom placement split");
  });

  it("even an UN-normalized [8] reaching the row says winner takes all", () => {
    const raw = { ...configToNonGolfDraft(GAME as never, []), pointsDistribution: ONE };
    const row = subtitle(raw);
    expect(row).toContain("Winner takes all");
    expect(row).not.toContain("Custom placement split");
    expect(usesPointsPool("match_play", ONE)).toBe(false);
  });

  it("CONTROL: a real two-place split still reads as a custom split", () => {
    const row = subtitle({ ...configToNonGolfDraft(GAME as never, []), pointsDistribution: TWO });
    expect(row).toContain("Custom placement split");
  });
});

describe("the row says a split has too many places, once, while it applies (#1679)", () => {
  const THREE: PointsDistribution = { type: "placement", values: [5, 3, 1] };
  const draft = (d: PointsDistribution | null) => ({ ...configToNonGolfDraft({ ...GAME, points_distribution: d, points_total: 9 } as never, []) });

  it("3 places over 2 teams: the subtitle is the warning, in the warning colour", () => {
    const row = subtitle(draft(THREE));
    expect(row).toContain('style="color:var(--color-bt-warning)" data-testid="split-places-warning">Awards 3 places — only 2 teams can finish.</span>');
    expect(row).not.toContain("Custom placement split");
  });

  it("CONTROL: a split that fits keeps its usual subtitle and no warning", () => {
    const row = subtitle(draft(TWO));
    expect(row).not.toContain('data-testid="split-places-warning"');
    expect(row).toContain("Custom placement split");
  });

  it("no row subtitle tells the reader to tap: the chevron says it", () => {
    for (const d of [null, TWO, THREE]) expect(subtitle(draft(d))).not.toMatch(/tap to/i);
  });
});

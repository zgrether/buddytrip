import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NonGolfSettingsRows } from "./NonGolfSettingsRows";
import type { NonGolfConfigDraft } from "@/lib/configDraft";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";

/**
 * Ruling 2 (PR 4): the picker never offers what the server refuses. In a Match
 * Play cup Bracket is not rendered at all — HIDDEN, not dimmed, because nothing a
 * person can do in that cup enables it, and the add-game menu already hides
 * incompatible types rather than disabling them. No exception for a game that is
 * already a bracket: a Match Play cup holds none (Zach deleted BBMI Test Cup's
 * three on 2026-09-26). A points race offers it as before.
 *
 * Absence is asserted on the tile's own `data-testid`, a value nothing else in
 * the markup emits, and each "present" case reads the tile's OWN button — every
 * tile carries `disabled:` in its classes, so a document-wide substring would be
 * satisfied by a neighbour (CLAUDE.md, the substring corollary). `disabled=""`
 * is the rendered attribute, not the word.
 */

const GAME: GameRow = {
  id: "g1",
  competition_id: "comp1",
  game_type_id: "gtt_generic_card",
  name: "Cards",
  status: "pending",
  points_distribution: null,
  points_total: 4,
  competition_format: null,
  rules_for_today: null,
  modifiers: null,
  scorecard_schema: null,
  course_id: null,
  back_course_id: null,
  schedule_item_id: null,
  corrections_open: false,
};

const DRAFT: NonGolfConfigDraft = {
  gameTypeId: "gtt_generic_card",
  name: "Cards",
  rulesForToday: null,
  competitionFormat: null,
  bracketConfig: null,
  scoringEnabled: false,
  pointsTotal: 4,
  pointsDistribution: null,
  delegates: [],
  bracketEntrants: [],
  matches: [],
};

const TILE = (key: string) => `data-testid="competition-format-tile-${key}"`;

function tile(html: string, key: string): string {
  const open = html.indexOf(TILE(key));
  expect(open, `no ${key} tile rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<button", open);
  const end = html.indexOf("</button>", open);
  return html.slice(start, end);
}

function render(scoringModel: ScoringModel) {
  return renderToStaticMarkup(
    <NonGolfSettingsRows
      game={GAME}
      scoringModel={scoringModel}
      draft={DRAFT}
      canEdit
      capacity={{ count: 2, source: "teams" }}
      onFormatChange={() => {}}
      onPointsTotalChange={() => {}}
      onPointsDistChange={() => {}}
    />,
  );
}

describe("the format picker in a Match Play cup", () => {
  it("does not render Bracket at all — not dimmed, absent", () => {
    const html = render("match_play");
    // The premise: the options row rendered, so an absent tile is not an absent row.
    expect(html).toContain('data-testid="competition-format-options"');
    expect(html).not.toContain(TILE("bracket"));
  });

  it("offers Simple and Matches, enabled — head to head between two teams", () => {
    const html = render("match_play");
    for (const key of ["head_to_head", "matches"]) {
      expect(tile(html, key), key).not.toContain('disabled=""');
    }
  });
});

describe("the format picker in a points race", () => {
  it("offers Bracket, enabled, as before", () => {
    expect(tile(render("points"), "bracket")).not.toContain('disabled=""');
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NonGolfSettingsRows } from "./NonGolfSettingsRows";
import type { NonGolfConfigDraft } from "@/lib/configDraft";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";
import { headToHeadResultRefusal } from "@/lib/headToHeadResult";

/**
 * Ruling 2 (PR 4): the picker never offers what the server refuses. In a Match
 * Play cup the Bracket tile is disabled, from the same predicate the server
 * refuses with (`headToHeadResultRefusal`) — EXCEPT on a game that is already a
 * bracket, which the server admits re-sent untouched and which must stay
 * reachable. A points race offers it as before.
 *
 * Each tile is read from its OWN button, not from the whole markup: every tile
 * carries `disabled:` in its classes and a Soon tile carries a badge too, so a
 * document-wide substring would be satisfied by a neighbour (CLAUDE.md, the
 * substring corollary). `disabled=""` is the rendered attribute, not the word.
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

function tile(html: string, key: string): string {
  const open = html.indexOf(`data-testid="competition-format-tile-${key}"`);
  expect(open, `no ${key} tile rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<button", open);
  const end = html.indexOf("</button>", open);
  return html.slice(start, end);
}

function render(scoringModel: ScoringModel, stored: string | null, drafted: NonGolfConfigDraft["competitionFormat"] = stored as NonGolfConfigDraft["competitionFormat"]) {
  return renderToStaticMarkup(
    <NonGolfSettingsRows
      game={{ ...GAME, competition_format: stored }}
      scoringModel={scoringModel}
      draft={{ ...DRAFT, competitionFormat: drafted }}
      canEdit
      capacity={{ count: 2, source: "teams" }}
      onFormatChange={() => {}}
      onPointsTotalChange={() => {}}
      onPointsDistChange={() => {}}
    />,
  );
}

describe("the format picker in a Match Play cup", () => {
  it("disables Bracket, says where it belongs, and carries the server's own sentence", () => {
    const bracket = tile(render("match_play", null), "bracket");
    expect(bracket).toContain('disabled=""');
    expect(bracket).toContain('data-refused="true"');
    expect(bracket).toContain(">Points cups only<");
    expect(bracket).not.toContain(">Soon<");
    expect(bracket).toContain(`title="${headToHeadResultRefusal("gtt_generic_card", "bracket")}"`);
  });

  it("still offers Simple and Matches — head to head between two teams", () => {
    const html = render("match_play", null);
    for (const key of ["head_to_head", "matches"]) {
      const t = tile(html, key);
      expect(t, key).not.toContain('disabled=""');
      expect(t, key).not.toContain("data-refused");
    }
  });

  it("keeps Bracket reachable on a game that is ALREADY one — even with the draft moved to Simple", () => {
    // The stored value is what the server admits re-sent; switching the draft
    // away and back must not strand the game.
    const bracket = tile(render("match_play", "bracket", "head_to_head"), "bracket");
    expect(bracket).not.toContain('disabled=""');
    expect(bracket).not.toContain("data-refused");
  });
});

describe("the format picker in a points race", () => {
  it("offers Bracket as before", () => {
    const bracket = tile(render("points", null), "bracket");
    expect(bracket).not.toContain('disabled=""');
    expect(bracket).not.toContain("data-refused");
  });
});

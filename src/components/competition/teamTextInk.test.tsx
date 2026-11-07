import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompletedRow, GridColumnHeader } from "./GameRow";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";
import { teamInk } from "@/lib/teamTextColor";

/**
 * Team-coloured TEXT takes the text ink (#1703); marks and fills keep the raw
 * colour, so each team stays recognisable. These four sites painted the raw colour
 * as text, which measured as low as 1.84 : 1 in light mode.
 */

const team = (id: string, short: string, color: string): LBTeam => ({ id, name: short, short_name: short, color });
const teams = [team("a", "BLU", "#3b82f6"), team("b", "GRN", "#22c55e")];

/** Every opening tag that carries `text`, so a test can read its style. */
const tagsBefore = (html: string, text: string) => {
  const out: string[] = [];
  for (let at = html.indexOf(`>${text}<`); at >= 0; at = html.indexOf(`>${text}<`, at + 1)) out.push(html.slice(html.lastIndexOf("<", at), at + 1));
  return out;
};

describe("the board's completed grid", () => {
  it("the column headers are text in the text ink; their underline mark keeps the raw colour", () => {
    const html = renderToStaticMarkup(<GridColumnHeader teams={teams} />);
    for (const t of teams) {
      const [label] = tagsBefore(html, t.short_name);
      expect(label).toContain(`color:${teamInk(t.color)}`);
      expect(label).not.toMatch(new RegExp(`color:${t.color}[;"]`));
    }
    expect(html).toContain("background:#3b82f6");
    expect(html).toContain("background:#22c55e");
  });

  it("the per-game numbers are text in the text ink; the winner's tint and ring keep the raw colour", () => {
    const cells = new Map<string, LBCell>([
      ["a", { points: 7, place: 1 } as LBCell],
      ["b", { points: 3, place: 2 } as LBCell],
    ]);
    const game: LBGame = { id: "g1", name: "Alternate Shot", distribution: null, status: "complete", gameTypeId: "gtt_match_play" };
    const html = renderToStaticMarkup(
      <CompletedRow game={game} teams={teams} cells={cells} scoringModel="match_play" tripId="t1" onPrefetch={() => {}} />
    );
    const [winner] = tagsBefore(html, "7");
    const [loser] = tagsBefore(html, "3");
    expect(winner).toContain(`color:${teamInk("#3b82f6")}`);
    expect(loser).toContain(`color:${teamInk("#22c55e")}`);
    expect(winner).toContain("color-mix(in srgb, #3b82f6 14%, transparent)");
    expect(winner).toContain("color-mix(in srgb, #3b82f6 45%, transparent)");
  });
});

describe("match setup's side labels", () => {
  // Nothing in the node suite renders MatchSetup, so this reads the one place the
  // label's colour is chosen: a team's colour goes through the text ink, and the
  // no-team fallback stays the dim token (inking a token would darken it).
  const src = readFileSync(join(process.cwd(), "src/components/games/matchSetup/MatchSetup.tsx"), "utf8");
  it("a team's label colour is chosen through teamInk", () => {
    expect(src).toContain("? { label: t.short_name, color: teamInk(t.color) }");
  });
  it("the no-team fallback stays the plain dim token", () => {
    expect(src).toContain(': { label: slot === "a" ? "Side A" : "Side B", color: "var(--color-bt-text-dim)" };');
  });
  it("the labels paint the chosen colour as given, not re-inked", () => {
    expect(src).toContain('color: a.color }} data-testid="match-setup-side-a"');
    expect(src).toContain('color: b.color }} data-testid="match-setup-side-b"');
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RackBoard } from "./RackBoard";
import { computeRack, type RackPlayer } from "@/lib/rackNStack";

/**
 * #1368 — a rostered player with no score is ON the board, reading as not
 * started, never as "E".
 *
 * A not-started player's value is 0, and `fmtToPar(0)` is "E" (level par), so
 * the obvious render shows a no-show as a player at level par. The score cell
 * carries `data-testid="rack-score-not-started"` only when the player has not
 * started, and "Not started" sits under the name (`rack-not-started`): anchors
 * nothing else on the board can produce, unlike a bare "E" or "—".
 */

const mk = (id: string, team: "A" | "B", thru: number): RackPlayer => ({
  id,
  team,
  stats: { netToPar: 0, netStrokes: thru * 4, gross: thru * 4, thru },
});

function render(players: RackPlayer[]) {
  const rack = computeRack(players, "current", 72);
  return renderToStaticMarkup(
    <RackBoard
      unitCount={18}
      teamA={{ name: "Alpha", color: "#3b82f6" }}
      teamB={{ name: "Bravo", color: "#ef4444" }}
      slots={rack.slots}
      sitOut={rack.sitOut}
      mode="current"
      onMode={() => {}}
      nameOf={(id) => `Name-${id}`}
    />
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("RackBoard shows a no-show as not started (#1368)", () => {
  it("a not-started player is on the board: a dash for the score and 'Not started' under the name", () => {
    const html = render([mk("a1", "A", 9), mk("a2", "A", 0), mk("b1", "B", 9), mk("b2", "B", 9)]);
    expect(html).toContain("Name-a2");
    expect(count(html, 'data-testid="rack-not-started"')).toBe(1);
    expect(html).toMatch(/data-testid="rack-score-not-started"[^>]*>—</);
    expect(count(html, 'data-testid="rack-score-not-started"')).toBe(1);
  });

  it("CONTROL: everyone started, level, renders no not-started marker (both cells read E)", () => {
    const html = render([mk("a1", "A", 9), mk("b1", "B", 9)]);
    expect(count(html, 'data-testid="rack-not-started"')).toBe(0);
    expect(count(html, 'data-testid="rack-score-not-started"')).toBe(0);
    expect(html).toMatch(/>E</);
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RackBoard } from "./RackBoard";
import { computeRack, type RackPlayer } from "@/lib/rackNStack";

/**
 * #1368 — a rostered player with no score is ON the board, and reads as not
 * started, never as "E".
 *
 * A not-started player's value is 0, and `fmtToPar(0)` is "E" (level par), so
 * the obvious render shows a no-show as a player at level par. Since Zach's
 * look on #1636 there are no words for it: the score is a dash and the name is
 * in the muted secondary colour. So the distinction lives in PAINT, and per
 * CLAUDE.md's tenth "empty is not unknown" instance it is asserted where it
 * lives: the colour, on anchors only these cells emit
 * (`rack-name-not-started`, `rack-score-not-started`).
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
const DIM = "color:var(--color-bt-text-dim)";

/** The opening tag of the element carrying `testid`. */
function tagOf(html: string, testid: string): string {
  const i = html.indexOf(`data-testid="${testid}"`);
  if (i < 0) return "";
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
}

describe("RackBoard shows a no-show as not started (#1368)", () => {
  const html = render([mk("a1", "A", 9), mk("a2", "A", 0), mk("b1", "B", 9), mk("b2", "B", 9)]);

  it("the not-started player is on the board, once", () => {
    expect(count(html, "Name-a2")).toBe(1);
    expect(count(html, 'data-testid="rack-name-not-started"')).toBe(1);
    expect(count(html, 'data-testid="rack-score-not-started"')).toBe(1);
  });

  it("their score is a muted dash, not E", () => {
    expect(html).toMatch(/data-testid="rack-score-not-started"[^>]*>—</);
    expect(tagOf(html, "rack-score-not-started")).toContain(DIM);
  });

  it("their name is in the muted secondary colour", () => {
    expect(html).toMatch(/data-testid="rack-name-not-started"[^>]*>Name-a2</);
    expect(tagOf(html, "rack-name-not-started")).toContain(DIM);
  });

  it("no words say it: the label was dropped for styling (Zach)", () => {
    expect(html).not.toMatch(/not started/i);
  });

  it("CONTROL: everyone started renders no not-started anchor, full-strength names, and E for level", () => {
    const started = render([mk("a1", "A", 9), mk("b1", "B", 9)]);
    expect(count(started, "rack-name-not-started")).toBe(0);
    expect(count(started, "rack-score-not-started")).toBe(0);
    expect(started).toMatch(/color:var\(--color-bt-text\)[^>]*>\s*Name-a1/);
    expect(started).toMatch(/>E</);
  });
});

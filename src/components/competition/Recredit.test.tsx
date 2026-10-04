import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecreditSheet, pointsChangeText } from "./Recredit";
import { RecreditedNote, recreditedNoteText } from "./GameRow";
import type { RecreditPreview } from "@/lib/recredit";

/**
 * The re-credit sheet (PR 8c). Copy is read by `data-testid`, never as a
 * substring of the whole sheet — it names the person, the teams and the games
 * several times over (CLAUDE.md's substring corollary).
 */

function decode(s: string) {
  return s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
function textOf(html: string, id: string): string | null {
  const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`));
  return m ? decode(m[1]) : null;
}
const allOf = (html: string, id: string) =>
  [...html.matchAll(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`, "g"))].map((m) => decode(m[1]));
/** The attributes of the element carrying `data-testid={id}`. */
function attrsOf(html: string, id: string): string | null {
  const m = html.match(new RegExp(`<[a-z]+([^>]*data-testid="${id}"[^>]*)>`));
  return m ? m[1] : null;
}

const RED = { teamId: "red", teamName: "Red" };
const BLUE = { teamId: "blue", teamName: "Blue" };
const preview = (over: Partial<RecreditPreview> = {}): RecreditPreview => ({
  personName: "Bill",
  toTeamId: "blue",
  toTeamName: "Blue",
  eligible: [
    {
      gameId: "d1", name: "Day 1 Stroke", fromTeamId: "red", fromTeamName: "Red", fingerprint: "f1",
      before: [{ ...RED, place: 1, points: 10 }, { ...BLUE, place: 2, points: 4 }],
      after: [{ ...RED, place: 2, points: 4 }, { ...BLUE, place: 1, points: 10 }],
    },
  ],
  standing: [],
  ...over,
});
const noop = () => undefined;
const render = (p: Partial<Parameters<typeof RecreditSheet>[0]> = {}) =>
  renderToStaticMarkup(
    <RecreditSheet
      personName="Bill"
      state={{ phase: "ready", preview: preview() }}
      selected={new Set()}
      onToggle={noop}
      onCancel={noop}
      onConfirm={noop}
      {...p}
    />
  );

describe("RecreditSheet", () => {
  it("every game starts UNCHECKED, and confirm waits for a pick (Zach: re-credit is for mistakes)", () => {
    const html = render();
    expect(attrsOf(html, "recredit-game")).toContain('aria-checked="false"');
    expect(textOf(html, "recredit-confirm")).toBe("Pick a game");
    expect(attrsOf(html, "recredit-confirm")).toContain('disabled=""');
    expect(textOf(html, "recredit-public")).toBeNull();
  });

  it("a ticked game counts toward the confirm, which names how many", () => {
    const html = render({ selected: new Set(["d1"]) });
    expect(attrsOf(html, "recredit-game")).toContain('aria-checked="true"');
    expect(textOf(html, "recredit-confirm")).toBe("Re-credit 1 game");
    expect(attrsOf(html, "recredit-confirm")).not.toContain('disabled=""');
    expect(textOf(html, "recredit-public")).toBe("Everyone on the trip will see these games marked as re-credited by you.");
  });

  it("names where the game counts now, and what moves", () => {
    const html = render();
    expect(textOf(html, "recredit-title")).toBe("Re-credit Bill’s games");
    expect(textOf(html, "recredit-intro")).toBe("For a game that counted Bill for the wrong team. Each game you tick will count for Blue.");
    // From → to, never "counts for Red now", which read both ways.
    expect(textOf(html, "recredit-game-direction")).toBe("Red → Blue");
    expect(html).not.toMatch(/ now</);
    expect(textOf(html, "recredit-game-change")).toBe("Points in this game: Red 10 → 4 · Blue 4 → 10");
  });

  it("to NO team, it says so plainly (Zach's ruling 3)", () => {
    const html = render({ state: { phase: "ready", preview: preview({ toTeamId: null, toTeamName: null }) } });
    expect(textOf(html, "recredit-game-direction")).toBe("Red → No team");
    expect(textOf(html, "recredit-intro")).toBe(
      "For a game that shouldn't have counted Bill for any team. Each game you tick will count for no team — Bill's own result stays, but no team scores it."
    );
  });

  it("games that stand are listed with their reason, and can't be ticked", () => {
    const html = render({
      state: {
        phase: "ready",
        preview: preview({
          standing: [
            { gameId: "m", name: "Hole 7 Match", reason: "team_dependent" },
            { gameId: "s", name: "Day 2 Stroke", reason: "in_review" },
          ],
        }),
      },
    });
    expect(allOf(html, "recredit-standing-reason")).toEqual([
      "Stands as played — its result depended on who was on which team.",
      "Open for score edits — finish the review, then re-credit it.",
    ]);
    // Only the eligible game is a checkbox.
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
  });

  it("a refused confirm shows the server's sentence and offers to review again", () => {
    const html = render({ selected: new Set(["d1"]), applyError: "Something changed since you opened this.", onReview: noop });
    expect(textOf(html, "recredit-apply-error")).toBe("Something changed since you opened this.");
    expect(textOf(html, "recredit-review-again")).toBe("Review again");
    expect(html).not.toContain('data-testid="recredit-confirm"');
  });

  it("nothing eligible: says so, and offers no confirm", () => {
    const html = render({ state: { phase: "ready", preview: preview({ eligible: [] }) } });
    expect(textOf(html, "recredit-none")).toBe("Nothing to re-credit — every finished game already counts Bill where they are now.");
    expect(html).not.toContain('data-testid="recredit-confirm"');
  });
});

describe("pointsChangeText", () => {
  it("only teams whose points move; null when none do", () => {
    expect(
      pointsChangeText(
        [{ ...RED, place: 1, points: 10 }, { ...BLUE, place: 2, points: 4 }],
        [{ ...RED, place: 1, points: 10 }, { ...BLUE, place: 2, points: 4 }]
      )
    ).toBeNull();
    expect(
      pointsChangeText(
        [{ ...RED, place: 1, points: 7 }, { ...BLUE, place: 1, points: 7 }],
        [{ ...RED, place: 1, points: 10 }, { ...BLUE, place: 2, points: 4 }]
      )
    ).toBe("Red 7 → 10 · Blue 7 → 4");
  });
});

describe("the board's note", () => {
  it("says who and when — and never 'Corrected', which the In review badge means", () => {
    expect(recreditedNoteText({ byName: "Zach", at: "2026-10-04T12:00:00Z" })).toBe("Re-credited by Zach · Oct 4");
    const html = renderToStaticMarkup(<RecreditedNote recredited={{ byName: "Zach", at: "2026-10-04T12:00:00Z" }} />);
    expect(textOf(html, "recredited-note")).toBe("Re-credited by Zach · Oct 4");
    expect(html).not.toMatch(/correct/i);
  });
});

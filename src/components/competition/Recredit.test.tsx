import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecreditSheet, pointsChangeText } from "./Recredit";
import { RecreditedNote, recreditedNoteText } from "./GameRow";
import { unevenTeamsExplanation, type RecreditPreview, type UnevenTeams } from "@/lib/recredit";

/**
 * The re-credit sheet (PR 8c), trimmed to Zach's version (2026-10-08): a one-line
 * intro, per game "{from} → {to}" beside the title, the points line with no
 * label, a short uneven-teams tag, and the explanation ONCE at the bottom.
 *
 * Copy is read by `data-testid`, never as a substring of the whole sheet — it
 * names the person, the teams and the games several times over (CLAUDE.md's
 * substring corollary).
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
const game = (over: Partial<RecreditPreview["eligible"][number]> = {}): RecreditPreview["eligible"][number] => ({
  gameId: "d1", name: "Day 1 Stroke", fromTeamId: "red", fromTeamName: "Red", fingerprint: "f1", uneven: null,
  before: [{ ...RED, place: 1, points: 10 }, { ...BLUE, place: 2, points: 4 }],
  after: [{ ...RED, place: 2, points: 4 }, { ...BLUE, place: 1, points: 10 }],
  ...over,
});
const preview = (over: Partial<RecreditPreview> = {}): RecreditPreview => ({
  personName: "Bill",
  toTeamId: "blue",
  toTeamName: "Blue",
  eligible: [game()],
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
const ready = (p: RecreditPreview) => ({ state: { phase: "ready" as const, preview: p } });

describe("RecreditSheet", () => {
  it("every game starts UNSELECTED, and confirm waits for one (Zach: re-credit is for mistakes)", () => {
    const html = render();
    expect(attrsOf(html, "recredit-game")).toContain('aria-checked="false"');
    expect(textOf(html, "recredit-confirm")).toBe("Select a game");
    expect(attrsOf(html, "recredit-confirm")).toContain('disabled=""');
    expect(textOf(html, "recredit-public")).toBeNull();
  });

  it("a selected game counts toward the confirm, which names how many", () => {
    const html = render({ selected: new Set(["d1"]) });
    expect(attrsOf(html, "recredit-game")).toContain('aria-checked="true"');
    expect(textOf(html, "recredit-confirm")).toBe("Re-credit 1 game");
    expect(attrsOf(html, "recredit-confirm")).not.toContain('disabled=""');
    expect(textOf(html, "recredit-public")).toBe("Everyone on the trip will see these games marked as re-credited by you.");
  });

  it("one-line intro with no destination; the game row says from → to, and the points without a label", () => {
    const html = render();
    expect(textOf(html, "recredit-title")).toBe("Re-credit Bill’s games");
    expect(textOf(html, "recredit-intro")).toBe("Select any game that counted Bill for the wrong team.");
    expect(textOf(html, "recredit-game-direction")).toBe("Red → Blue");
    expect(textOf(html, "recredit-game-change")).toBe("Red 10 → 4 · Blue 4 → 10");
    // The trimmed words, gone.
    expect(html).not.toMatch(/Points in this game|Each game you|tick|counts for Red now/);
  });

  it("to NO team, the game row says so (Zach's ruling 3) — the intro does not change", () => {
    const html = render(ready(preview({ toTeamId: null, toTeamName: null })));
    expect(textOf(html, "recredit-game-direction")).toBe("Red → No team");
    expect(textOf(html, "recredit-intro")).toBe("Select any game that counted Bill for the wrong team.");
  });

  it("games that stand are listed by name and state only, and can't be selected", () => {
    const html = render(ready(preview({
      standing: [
        { gameId: "m", name: "Cornhole", reason: "team_dependent" },
        { gameId: "s", name: "Day 2 Stroke", reason: "in_review" },
      ],
    })));
    expect(allOf(html, "recredit-standing-reason")).toEqual(["Stands as played", "Open for score edits"]);
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
  });

  it("a refused confirm shows the server's sentence and offers to review again", () => {
    const html = render({ selected: new Set(["d1"]), applyError: "Something changed since you opened this.", onReview: noop });
    expect(textOf(html, "recredit-apply-error")).toBe("Something changed since you opened this.");
    expect(textOf(html, "recredit-review-again")).toBe("Review again");
    expect(html).not.toContain('data-testid="recredit-confirm"');
  });

  it("nothing eligible: says so, and offers no confirm", () => {
    const html = render(ready(preview({ eligible: [] })));
    expect(textOf(html, "recredit-none")).toBe("Nothing to re-credit — every finished game already counts Bill where they are now.");
    expect(html).not.toContain('data-testid="recredit-confirm"');
  });
});

describe("uneven teams: a short tag per game, the explanation ONCE (#1561: warn, never block)", () => {
  const stroke: UnevenTeams = { tag: "Uneven teams: Blue 2, Red 1", explanation: unevenTeamsExplanation("traditional") };
  const skins: UnevenTeams = { tag: "Uneven teams: Blue 2, Red 1", explanation: unevenTeamsExplanation("skins") };

  it("two stroke rounds, both uneven: two tags, ONE explanation", () => {
    const html = render(ready(preview({
      eligible: [game({ uneven: stroke }), game({ gameId: "d2", name: "Day 2 Stroke", uneven: stroke })],
    })));
    expect(allOf(html, "recredit-game-uneven")).toEqual(["Uneven teams: Blue 2, Red 1", "Uneven teams: Blue 2, Red 1"]);
    expect(allOf(html, "recredit-uneven-explanation")).toEqual([
      "In stroke play a team's total adds up its players' strokes, so the bigger team is at a disadvantage.",
    ]);
  });

  it("a stroke round and a skins round cut OPPOSITE ways, so each direction is said once", () => {
    const html = render(ready(preview({
      eligible: [game({ uneven: stroke }), game({ gameId: "sk", name: "Skins", uneven: skins })],
    })));
    expect(allOf(html, "recredit-uneven-explanation")).toEqual([
      "In stroke play a team's total adds up its players' strokes, so the bigger team is at a disadvantage.",
      "In skins a team's total adds up its players' skins, so the bigger team is at an advantage.",
    ]);
  });

  it("an even round: no tag and no explanation — and the game can still be selected", () => {
    const html = render();
    expect(html).not.toContain('data-testid="recredit-game-uneven"');
    expect(html).not.toContain('data-testid="recredit-uneven-explanation"');
    expect(html.match(/role="checkbox"/g)).toHaveLength(1);
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

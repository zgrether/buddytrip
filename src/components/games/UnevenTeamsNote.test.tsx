import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { UnevenTeamsNote } from "./UnevenTeamsNote";

/**
 * #1562 — the uneven-teams note in stroke and skins SETUP. Each sentence is
 * pinned whole, by the element that carries it, in BOTH directions: a note that
 * says the wrong direction is worse than none (it tells the organizer the
 * opposite of what will happen).
 */

const TEAMS = [
  { teamId: "sp", teamName: "Spartans" },
  { teamId: "ce", teamName: "Centurions" },
];
const ROSTER = { a: "sp", b: "sp", c: "sp", d: "ce", e: "ce", f: "ce" };

const STROKE_WHY = "In stroke play a team's total adds up its players' strokes, so the bigger team is at a disadvantage.";
const STABLEFORD_WHY = "In Stableford a team's total adds up its players' points, so the bigger team is at an advantage.";
const SKINS_WHY = "In skins a team's total adds up its players' skins, so the bigger team is at an advantage.";

/** The text of the ONE element carrying `data-testid={id}`, or null. */
function textOf(html: string, id: string): string | null {
  const m = html.match(new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`));
  return m ? m[1].replace(/&#x27;/g, "'") : null;
}

const render = (props: Parameters<typeof UnevenTeamsNote>[0]) => renderToStaticMarkup(<UnevenTeamsNote {...props} />);

describe("UnevenTeamsNote — the tag, and the explanation in the format's direction", () => {
  it("traditional stroke: 3 v 2 is tagged, biggest first, and the bigger team is at a DISADVANTAGE", () => {
    const html = render({ scoring: "traditional", playerIds: ["a", "b", "c", "d", "e"], roster: ROSTER, teams: TEAMS });
    expect(textOf(html, "setup-uneven-tag")).toBe("Uneven teams: Spartans 3, Centurions 2");
    expect(textOf(html, "setup-uneven-explanation")).toBe(STROKE_WHY);
  });

  it("Stableford: the same counts, the OTHER direction", () => {
    const html = render({ scoring: "stableford", playerIds: ["a", "b", "c", "d", "e"], roster: ROSTER, teams: TEAMS });
    expect(textOf(html, "setup-uneven-explanation")).toBe(STABLEFORD_WHY);
  });

  it("skins: an ADVANTAGE too", () => {
    const html = render({ scoring: "skins", playerIds: ["a", "d", "e"], roster: ROSTER, teams: TEAMS });
    expect(textOf(html, "setup-uneven-tag")).toBe("Uneven teams: Centurions 2, Spartans 1");
    expect(textOf(html, "setup-uneven-explanation")).toBe(SKINS_WHY);
  });

  it("even teams: no note at all", () => {
    const html = render({ scoring: "traditional", playerIds: ["a", "b", "d", "e"], roster: ROSTER, teams: TEAMS });
    expect(html).toBe("");
  });

  it("evening the groups clears it — the same round, one more Centurion", () => {
    const before = render({ scoring: "traditional", playerIds: ["a", "b", "c", "d", "e"], roster: ROSTER, teams: TEAMS });
    const after = render({ scoring: "traditional", playerIds: ["a", "b", "c", "d", "e", "f"], roster: ROSTER, teams: TEAMS });
    expect(textOf(before, "setup-uneven-tag")).not.toBeNull(); // premise
    expect(after).toBe("");
  });

  it("someone on no team counts for none, and nobody counts twice", () => {
    // Two Spartans, two Centurions, one guest on no team, and a duplicated id.
    const html = render({ scoring: "traditional", playerIds: ["a", "b", "d", "e", "guest", "a"], roster: ROSTER, teams: TEAMS });
    expect(html).toBe("");
  });

  it("a team with nobody playing is listed at 0", () => {
    const html = render({ scoring: "traditional", playerIds: ["a"], roster: ROSTER, teams: TEAMS });
    expect(textOf(html, "setup-uneven-tag")).toBe("Uneven teams: Spartans 1, Centurions 0");
  });
});

/**
 * Both setup screens render it from the DRAFT groups. A per-component test
 * cannot see the composition, so this reads the source: a view that stops
 * rendering the note, or feeds it the server's participants (stale until Save),
 * fails here.
 */
describe("both setup screens render the note from the draft groups", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  for (const [view, scoring] of [
    ["src/components/games/StrokeGameView.tsx", "configDraft.scoring.type"],
    ["src/components/games/skins/SkinsGameView.tsx", `"skins"`],
  ] as const) {
    it(view, () => {
      const src = readFileSync(join(ROOT, view), "utf8").split("\r\n").join("\n");
      const at = src.indexOf("<UnevenTeamsNote");
      expect(at, "the view renders the note").toBeGreaterThan(-1);
      const props = src.slice(at, src.indexOf("/>", at));
      expect(props).toContain(`scoring={${scoring}}`.replace(`{"skins"}`, `"skins"`));
      expect(props).toContain("playerIds={configDraft.groups.flat()}");
    });
  }
});

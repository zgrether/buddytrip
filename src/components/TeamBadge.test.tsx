import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MIN_LETTER_PX, TeamBadge, badgeLetterPx } from "./TeamBadge";
import { teamBadgeLabels, teamInitial, teamTwoLetters } from "@/lib/teamInitial";
import { TeamBadgeLabelsForTest } from "./TeamBadgeLabels";
import { teamTextColor } from "@/lib/teamTextColor";

/**
 * The team badge (Zach, 2026-10-20): squares are always teams, circles always
 * people. These pin the SHAPE, the LETTER and its contrast — the three things
 * the badge exists to make the same everywhere.
 */

describe("teamInitial", () => {
  it("short_name first", () => {
    expect(teamInitial({ name: "Alpha", shortName: "BRV" })).toBe("B");
  });

  it("a seeded \"Team A\" is A, not T", () => {
    expect(teamInitial({ name: "Team A" })).toBe("A");
    expect(teamInitial({ name: "team bravo" })).toBe("B");
  });

  it("otherwise the name's first letter, upper-cased", () => {
    expect(teamInitial({ name: "alpha" })).toBe("A");
    expect(teamInitial({ name: "  Eagles " , shortName: "  " })).toBe("E");
  });

  it("CONTROL: a team literally named \"Team\" keeps its letter rather than vanishing", () => {
    expect(teamInitial({ name: "Team" })).toBe("T");
  });
});

describe("TeamBadge", () => {
  const html = renderToStaticMarkup(<TeamBadge name="Team Red" shortName="RED" color="#ef4444" size={20} />);

  it("is a rounded SQUARE, never a circle", () => {
    expect(html).toContain("width:20px");
    expect(html).toContain("height:20px");
    expect(html).not.toContain("border-radius:50%");
    expect(html).toMatch(/border-radius:\d+px/);
  });

  it("shows the team's initial, in the readable colour for its fill", () => {
    expect(html).toContain(">R</span>");
    expect(html).toContain(`color:${teamTextColor("#ef4444")}`);
    expect(html).toContain("background:#ef4444");
  });

  it("labels itself with the team's name", () => {
    expect(html).toContain('aria-label="Team Red"');
  });
});

describe("two letters when two teams in the competition would share one (Zach, 2026-10-20)", () => {
  const teams = [
    { id: "b1", name: "Bravo" },
    { id: "b2", name: "Blue" },
    { id: "r", name: "Red" },
  ];

  it("both clashing teams switch to two letters; a team with its own letter keeps one", () => {
    const labels = teamBadgeLabels(teams);
    expect(labels.get("b1")).toBe("BR");
    expect(labels.get("b2")).toBe("BL");
    expect(labels.get("r")).toBe("R");
  });

  it("CONTROL: no clash, single letters everywhere", () => {
    const labels = teamBadgeLabels([{ id: "a", name: "Alpha" }, { id: "b", name: "Bravo" }]);
    expect([...labels.values()]).toEqual(["A", "B"]);
  });

  it("two letters come from the short name first, then two words, then the name", () => {
    expect(teamTwoLetters({ name: "Bravo", shortName: "BRV" })).toBe("BR");
    expect(teamTwoLetters({ name: "Red Devils" })).toBe("RD");
    expect(teamTwoLetters({ name: "Team Red Sox" })).toBe("RS");
    expect(teamTwoLetters({ name: "Rovers" })).toBe("RO");
  });

  it("a badge reads the competition's label, by id or by name", () => {
    const byId = renderToStaticMarkup(
      <TeamBadgeLabelsForTest teams={teams}>
        <TeamBadge teamId="b1" name="Bravo" color="#3b82f6" size={20} />
      </TeamBadgeLabelsForTest>
    );
    expect(byId).toContain(">BR</span>");
    const byName = renderToStaticMarkup(
      <TeamBadgeLabelsForTest teams={teams}>
        <TeamBadge name="Blue" color="#3b82f6" size={20} />
      </TeamBadgeLabelsForTest>
    );
    expect(byName).toContain(">BL</span>");
  });

  it("CONTROL: outside a competition the same badge shows its plain initial", () => {
    expect(renderToStaticMarkup(<TeamBadge teamId="b1" name="Bravo" color="#3b82f6" size={20} />)).toContain(">B</span>");
  });
});

describe("below a readable size the badge is the coloured square alone (Zach, 2026-10-20)", () => {
  const letter = (html: string) => html.match(/<span[^>]*data-testid="team-badge"[^>]*>([^<]*)<\/span>/)![1];

  it("a finished-game tile's 11px badge draws no letter, but keeps its colour and its name", () => {
    const html = renderToStaticMarkup(<TeamBadge name="Bravo" shortName="BRA" color="#ef4444" size={11} />);
    expect(letter(html)).toBe("");
    expect(html).toContain("background:#ef4444");
    expect(html).toContain('aria-label="Bravo"');
  });

  it("the floor is the letter's size: one letter from 14px, two letters from 18px", () => {
    expect(badgeLetterPx(13, "B")).toBeLessThan(MIN_LETTER_PX);
    expect(badgeLetterPx(14, "B")).toBeGreaterThanOrEqual(MIN_LETTER_PX);
    expect(badgeLetterPx(16, "BR")).toBeLessThan(MIN_LETTER_PX);
    expect(badgeLetterPx(18, "BR")).toBeGreaterThanOrEqual(MIN_LETTER_PX);
  });

  it("CONTROL: at 14px a single letter is drawn", () => {
    expect(letter(renderToStaticMarkup(<TeamBadge name="Bravo" color="#ef4444" size={14} />))).toBe("B");
  });

  it("two letters at 16px are dropped, at 18px drawn", () => {
    const teams = [{ id: "b1", name: "Bravo" }, { id: "b2", name: "Blue" }];
    const at = (size: number) =>
      letter(renderToStaticMarkup(<TeamBadgeLabelsForTest teams={teams}><TeamBadge teamId="b1" name="Bravo" color="#3b82f6" size={size} /></TeamBadgeLabelsForTest>));
    expect(at(16)).toBe("");
    expect(at(18)).toBe("BR");
  });
});

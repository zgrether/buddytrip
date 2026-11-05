import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamColorPicker } from "./TeamColorPicker";
import { firstFreeColorIndex, TEAM_CAP_LINE, TEAM_COLORS, takenTeamColors } from "@/lib/teamColors";

/**
 * Taken colors (Zach, 2026-11-05): disabled, not hidden, with the owning team's
 * short name on the swatch. The team's own color stays selectable.
 */

const blue = TEAM_COLORS[0].color;
const red = TEAM_COLORS[4].color;
const teams = [
  { id: "a", color: blue, short_name: "BLU" },
  { id: "b", color: red, short_name: "RED" },
];

/** One swatch's whole element, by its testid. */
function swatch(html: string, label: string): string {
  const at = html.indexOf(`data-testid="team-color-${label}"`);
  return html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
}

const render = (ownTeamId: string | null, selectedIndex = 1) =>
  renderToStaticMarkup(<TeamColorPicker selectedIndex={selectedIndex} taken={takenTeamColors(teams, ownTeamId)} onSelect={() => {}} />);

describe("the swatches", () => {
  it("all eight stay on show, taken or not", () => {
    expect(render(null).match(/data-testid="team-color-/g)).toHaveLength(TEAM_COLORS.length);
  });
  it("a taken color is disabled, with the owner's short name on it", () => {
    const html = swatch(render(null), "blue");
    expect(html).toContain('disabled=""');
    expect(html).toContain(">BLU<");
    expect(html).toContain('aria-label="Blue (taken by BLU)"');
    expect(html).toContain("cursor:not-allowed");
  });
  it("a free color is neither", () => {
    const html = swatch(render(null), "green");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("<span");
  });
  it("the team's own color stays selectable, with no name on it", () => {
    const html = swatch(render("a", 0), "blue");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain(">BLU<");
    expect(html).toContain('aria-label="Blue (selected)"');
  });
  it("taken and free are painted apart, not only labelled", () => {
    const html = render(null);
    expect(swatch(html, "blue")).toContain(`color-mix(in srgb, ${blue} 45%, transparent)`);
    expect(swatch(html, "green")).toContain(`background:${TEAM_COLORS[1].color}`);
  });
  it("a taken color never reads as selected, even if the index lands on it", () => {
    const html = swatch(render(null, 0), "blue");
    expect(html).not.toContain("scale(1.15)");
  });
});

describe("takenTeamColors", () => {
  it("ignores case and spaces, as the database index does", () => {
    const taken = takenTeamColors([{ id: "a", color: " #3B82F6 ", short_name: "BLU" }], null);
    expect(taken.get(blue)).toBe("BLU");
  });
  it("leaves the team being edited out", () => {
    expect(takenTeamColors(teams, "a").has(blue)).toBe(false);
    expect(takenTeamColors(teams, "a").has(red)).toBe(true);
  });
});

describe("firstFreeColorIndex", () => {
  it("skips what is taken", () => {
    expect(firstFreeColorIndex(takenTeamColors(teams, null))).toBe(1);
  });
  it("nothing free falls back to the first swatch: the cap refuses the save", () => {
    const all = TEAM_COLORS.map((c, i) => ({ id: String(i), color: c.color, short_name: "T" }));
    expect(firstFreeColorIndex(takenTeamColors(all, null))).toBe(0);
  });
});

describe("the cap", () => {
  it("one team per color, in the approved words", () => {
    expect(TEAM_COLORS).toHaveLength(8);
    expect(TEAM_CAP_LINE).toBe("A cup can have 8 teams, one per colour.");
  });
});

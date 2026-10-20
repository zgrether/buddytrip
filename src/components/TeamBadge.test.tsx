import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamBadge } from "./TeamBadge";
import { teamInitial } from "@/lib/teamInitial";
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

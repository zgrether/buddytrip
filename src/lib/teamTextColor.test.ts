import { describe, it, expect } from "vitest";
import { teamTextColor, TEAM_TEXT_DARK, TEAM_TEXT_LIGHT } from "./teamTextColor";

// The full team palette (TeamsPanel TEAM_COLORS). Max-contrast crossover picks
// dark on every one of these vibrant colors (dark beats white on all — the
// bright green/cyan/amber/orange were the failing-on-white culprits).
describe("teamTextColor — the team palette", () => {
  const palette = [
    ["#3b82f6", "Blue"],
    ["#22c55e", "Green"],
    ["#a855f7", "Purple"],
    ["#06b6d4", "Cyan"],
    ["#ef4444", "Red"],
    ["#f59e0b", "Amber"],
    ["#ec4899", "Pink"],
    ["#f97316", "Orange"],
  ] as const;

  for (const [hex, name] of palette) {
    it(`${name} (${hex}) → dark text (higher contrast)`, () => {
      expect(teamTextColor(hex)).toBe(TEAM_TEXT_DARK);
    });
  }
});

describe("teamTextColor — light vs dark boundary", () => {
  it("a very dark background → light (white) text", () => {
    expect(teamTextColor("#0a1a2a")).toBe(TEAM_TEXT_LIGHT); // a dim variant
    expect(teamTextColor("#000000")).toBe(TEAM_TEXT_LIGHT);
  });
  it("a very light background → dark text", () => {
    expect(teamTextColor("#ffffff")).toBe(TEAM_TEXT_DARK);
    expect(teamTextColor("#eeeeee")).toBe(TEAM_TEXT_DARK);
  });
  it("accepts shorthand hex and a missing #", () => {
    expect(teamTextColor("#fff")).toBe(TEAM_TEXT_DARK);
    expect(teamTextColor("3b82f6")).toBe(TEAM_TEXT_DARK);
  });
});

describe("teamTextColor — safe fallback", () => {
  it("unparseable input → light (safe on dark surfaces), never throws", () => {
    expect(teamTextColor("var(--color-bt-accent)")).toBe(TEAM_TEXT_LIGHT);
    expect(teamTextColor("rebeccapurple")).toBe(TEAM_TEXT_LIGHT);
    expect(teamTextColor("")).toBe(TEAM_TEXT_LIGHT);
    expect(teamTextColor(null)).toBe(TEAM_TEXT_LIGHT);
    expect(teamTextColor(undefined)).toBe(TEAM_TEXT_LIGHT);
  });
});

import { describe, it, expect } from "vitest";
import { BRACKET_LINE, FORMAT_LINE, MATCH_PLAY_WAYS, formatLine } from "./formatLines";
import { GAME_TYPE_DEFINITIONS } from "./gameTypes";

/**
 * One plain line per format (Zach, 2026-10-21). The catalog is keyed by plain
 * strings, so the type checker cannot require a line per format: this does.
 * A new format with no line, a line for a format that does not exist, or a
 * line that grows past one short line all fail here.
 */

const ONE_LINE = 80;

describe("every format has one plain line", () => {
  it("each format in the catalog has a line, and no line names a missing format", () => {
    expect(Object.keys(FORMAT_LINE).sort()).toEqual(Object.keys(GAME_TYPE_DEFINITIONS).sort());
  });

  it("each line is a single short line", () => {
    for (const line of [...Object.values(FORMAT_LINE), BRACKET_LINE, ...MATCH_PLAY_WAYS.map((w) => w.line)]) {
      expect(line, line).not.toMatch(/\n/);
      expect(line.length, line).toBeLessThanOrEqual(ONE_LINE);
    }
  });

  it("a manual game played as a bracket reads the bracket's line", () => {
    expect(formatLine("gtt_generic_bar", "bracket")).toBe(BRACKET_LINE);
    expect(formatLine("gtt_generic_bar", null)).toBe(FORMAT_LINE.gtt_generic_bar);
    expect(formatLine("gtt_unknown")).toBeNull();
  });
});

describe("Match Play's ways to play it", () => {
  it("are the four Zach named, in his order", () => {
    expect(MATCH_PLAY_WAYS.map((w) => w.name)).toEqual(["Singles", "Best Ball", "Alternate Shot", "Scramble"]);
  });
});

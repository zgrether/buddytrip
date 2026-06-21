import { describe, it, expect } from "vitest";
import { initialsFor } from "./initials";

/**
 * The one initials algorithm. Pins the deterministic abbreviation so renames
 * don't regress how names show in pickers, scorecards, and competition rows.
 */
describe("initialsFor", () => {
  it("uppercases the first letter of a single-word name", () => {
    expect(initialsFor("Llama")).toBe("L");
  });

  it("returns two initials for a two-word name", () => {
    expect(initialsFor("Zach Grether")).toBe("ZG");
  });

  it("caps at two initials even for longer names", () => {
    expect(initialsFor("First Middle Last")).toBe("FM");
  });

  it("collapses multiple internal spaces", () => {
    expect(initialsFor("Zach   Grether")).toBe("ZG");
  });

  it("trims surrounding whitespace before deriving", () => {
    expect(initialsFor("   Zach Grether   ")).toBe("ZG");
  });

  it("returns ? for empty input", () => {
    expect(initialsFor("")).toBe("?");
  });

  it("returns ? for whitespace-only input", () => {
    expect(initialsFor("   ")).toBe("?");
  });

  it("preserves uppercasing of already-uppercase initials", () => {
    expect(initialsFor("ZG")).toBe("Z");
  });

  it("handles lowercase input", () => {
    expect(initialsFor("zach grether")).toBe("ZG");
  });
});

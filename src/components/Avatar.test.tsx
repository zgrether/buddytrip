import { describe, it, expect } from "vitest";
import { initialsFor } from "./Avatar";

/**
 * Avatar — initials derivation
 *
 * The visual rendering (icon vs initials, default vs team-color) is
 * better covered by Playwright. This file pins the deterministic
 * initials algorithm so renames don't accidentally regress how user
 * names abbreviate in the picker preview row and competition contexts.
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

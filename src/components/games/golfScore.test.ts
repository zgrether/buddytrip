import { describe, it, expect } from "vitest";
import { golfResult, golfWord } from "./golfScore";

describe("golfResult", () => {
  it("classifies relative to par", () => {
    expect(golfResult(3, 5)).toBe("eagle"); // −2
    expect(golfResult(2, 5)).toBe("eagle"); // −3 (better than eagle still 'eagle')
    expect(golfResult(3, 4)).toBe("birdie"); // −1
    expect(golfResult(4, 4)).toBe("par"); // 0
    expect(golfResult(5, 4)).toBe("bogey"); // +1
    expect(golfResult(6, 4)).toBe("double"); // +2
    expect(golfResult(8, 4)).toBe("double"); // triple+ folds into 'double'
  });

  it("returns null for an unscored hole", () => {
    expect(golfResult(null, 4)).toBeNull();
    expect(golfResult(undefined, 4)).toBeNull();
  });

  it("golfWord maps the result to a label", () => {
    expect(golfWord(3, 4)).toBe("Birdie");
    expect(golfWord(4, 4)).toBe("Par");
    expect(golfWord(7, 4)).toBe("Double");
    expect(golfWord(null, 4)).toBeNull();
  });
});

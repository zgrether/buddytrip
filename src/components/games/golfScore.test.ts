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

  // The WORD is named from the difference, NOT from the style bucket. Naming
  // through the bucket made a triple say "Double" and an albatross say "Eagle",
  // and with a stroke in play both halves of "X · net Y" showed the error at once.
  it("golfWord names the score from the difference, not the style bucket", () => {
    expect(golfWord(1, 4)).toBe("Albatross"); // −3, where the bucket says 'eagle'
    expect(golfWord(2, 4)).toBe("Eagle"); // −2
    expect(golfWord(3, 4)).toBe("Birdie"); // −1
    expect(golfWord(4, 4)).toBe("Par"); // 0
    expect(golfWord(5, 4)).toBe("Bogey"); // +1
    expect(golfWord(6, 4)).toBe("Double"); // +2
    expect(golfWord(7, 4)).toBe("Triple"); // +3, where the bucket says 'double'
    expect(golfWord(null, 4)).toBeNull();
  });

  it("declines to name a score past ±3 rather than inventing a term", () => {
    expect(golfWord(8, 4)).toBeNull(); // +4
    expect(golfWord(12, 4)).toBeNull(); // +8
    expect(golfWord(0, 4)).toBeNull(); // −4
  });

  it("names gross and net independently — the pair that read as an echo", () => {
    // A triple that nets to a double: was "Double · net Double".
    expect(golfWord(7, 4)).toBe("Triple");
    expect(golfWord(6, 4)).toBe("Double");
    // An eagle that nets to an albatross: was "Eagle · net Eagle".
    expect(golfWord(2, 4)).toBe("Eagle");
    expect(golfWord(1, 4)).toBe("Albatross");
  });

  it("keeps the STYLE buckets grouped — only the words changed", () => {
    expect(golfResult(7, 4)).toBe("double"); // triple still styled as double
    expect(golfResult(1, 4)).toBe("eagle"); // albatross still styled as eagle
  });
});

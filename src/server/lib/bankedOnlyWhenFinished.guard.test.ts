import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — every arm's return in the leaderboard's per-game step goes
 * through `bankedOnlyWhenFinished` (#1416).
 *
 * A source check, and on purpose, because the arm it exists for cannot be
 * reached behaviourally: the BRACKET arm returns a finished `LiveGame` early,
 * before the shared step, and a bracket only writes rows inside `games.finish`.
 * A live bracket holding rows exists only in `finish`'s failure window (results
 * written, the status update failing), which no test can produce through the
 * app. So "a rule that every arm but one obeys" would be invisible to every
 * behavioural test — the next writer would get through exactly there.
 *
 * What makes it fail: removing the wrapper from either return. Proven in the
 * PR's mutant harness.
 */

const SRC = readFileSync(resolve(__dirname, "competitionLeaderboard.ts"), "utf8");

describe("the per-game step applies bankedOnlyWhenFinished to every arm", () => {
  const start = SRC.indexOf("const liveGames: LiveGame[] = allGames.map((g) => {");
  const end = SRC.indexOf("\n  });", start);
  const step = SRC.slice(start, end);

  it("the step can be found — a guard that finds nothing guards nothing", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("the bracket arm's early return is wrapped", () => {
    expect(step).toMatch(/if \(!\("expects" in armed\)\) return bankedOnlyWhenFinished\(armed, status\);/);
  });

  it("the team arms' return is wrapped", () => {
    expect(step).toMatch(/return bankedOnlyWhenFinished\(\s*\{\s*\.\.\.reconciled,/);
  });

  it("no return in the step bypasses it", () => {
    const returns = step.match(/\breturn\b[^;]*/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const r of returns) expect(r, r).toMatch(/bankedOnlyWhenFinished/);
  });
});

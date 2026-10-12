import { describe, it, expect } from "vitest";
import { retriedFrom, summaryLines } from "../../../e2e/retryReporter";

/**
 * The E2E `[retries]` reporter (#1552, #1590): a test that fails and then
 * passes on retry is green and otherwise invisible, so this must NAME it — and
 * must print its line at zero too, or "no line" could mean "did not run".
 *
 * Fed the shapes Playwright hands a reporter: one `onTestEnd` per ATTEMPT, each
 * with a `retry` index (0 = first attempt). The decisive case is the spine's
 * real history — failed attempt 0, passed attempt 1.
 */

const test = (title: string, line = 10) => ({
  titlePath: () => ["", "critical-path", "match-play.spec.ts", title],
  location: { file: "C:\\repo\\e2e\\match-play.spec.ts", line, column: 5 },
  outcome: () => "flaky" as const,
});
const attempt = (retry: number, status: "passed" | "failed" | "timedOut", error?: string) => ({
  retry,
  status,
  errors: error ? [{ message: error }] : [],
});

describe("retriedFrom — which tests needed a retry, read from every attempt", () => {
  it("the spine's case: failed first, passed on retry — named, with its FIRST error", () => {
    const spine = test("match-play spine");
    const out = retriedFrom([
      { test: spine, result: attempt(0, "timedOut", "locator.click: Test timeout of 60000ms exceeded.\nCall log: …") },
      { test: spine, result: attempt(1, "passed") },
    ]);
    expect(out).toEqual([
      {
        file: "e2e/match-play.spec.ts",
        name: "match-play spine",
        retries: 1,
        outcome: "passed on retry",
        firstError: "locator.click: Test timeout of 60000ms exceeded.",
      },
    ]);
  });

  it("failed every attempt: still named, as failed after retries", () => {
    const chat = test("desktop: opening chat from Cup", 89);
    const out = retriedFrom([
      { test: chat, result: attempt(0, "failed", "expect(locator).toBeVisible() failed") },
      { test: chat, result: attempt(1, "failed", "x") },
      { test: chat, result: attempt(2, "failed", "y") },
    ]);
    expect(out.map((r) => [r.name, r.retries, r.outcome])).toEqual([["desktop: opening chat from Cup", 2, "failed after retries"]]);
  });

  it("CONTROL: a test that passed first time is not reported", () => {
    expect(retriedFrom([{ test: test("clean"), result: attempt(0, "passed") }])).toEqual([]);
  });
});

describe("summaryLines — always one line, and the vitest reporter's shape", () => {
  it("prints the line at ZERO — an absent line would look like a reporter that never ran", () => {
    expect(summaryLines([])).toEqual(["[retries] 0 e2e tests needed a retry"]);
  });

  it("names each retried test under the count", () => {
    const lines = summaryLines([
      { file: "e2e/match-play.spec.ts", name: "match-play spine", retries: 1, outcome: "passed on retry", firstError: "Test timeout" },
    ]);
    expect(lines).toEqual([
      "[retries] 1 e2e test(s) needed a retry (1 passed on retry, 0 failed anyway):",
      "  e2e/match-play.spec.ts > match-play spine  [passed on retry, 1 retry]  — Test timeout",
    ]);
  });
});

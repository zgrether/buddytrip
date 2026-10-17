import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import E2eRetryReporter, { retriedFrom, summaryLines } from "../../../e2e/retryReporter";

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

describe("the `retried` step output — what keeps CI's report when a test passed only on retry (#1655)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function runReporter(entries: Parameters<typeof retriedFrom>[0]) {
    const dir = mkdtempSync(join(tmpdir(), "retry-reporter-"));
    const output = join(dir, "output");
    writeFileSync(output, "");
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("GITHUB_OUTPUT", output);
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const reporter = new E2eRetryReporter();
    for (const e of entries) reporter.onTestEnd(e.test as never, e.result as never);
    reporter.onEnd({} as never);
    return readFileSync(output, "utf8");
  }

  it("a test that passed on retry writes retried=1, which the upload step reads", () => {
    const spine = test("side game spine");
    expect(runReporter([
      { test: spine, result: attempt(0, "failed", "strict mode violation") },
      { test: spine, result: attempt(1, "passed") },
    ])).toBe("retried=1\n");
  });

  it("CONTROL: a clean run writes retried=0, so the upload step skips", () => {
    expect(runReporter([{ test: test("clean"), result: attempt(0, "passed") }])).toBe("retried=0\n");
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

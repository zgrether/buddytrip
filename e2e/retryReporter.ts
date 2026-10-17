/**
 * Names every END-TO-END test that needed a retry — the reading CI's
 * `retries: 2` otherwise hides. The Playwright twin of
 * `src/__tests__/helpers/retryReporter.ts` (#1551), with the same output, so
 * one `[retries]` reading covers both suites (#1552).
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The match-play spine failed on its first attempt on every CI run for weeks
 * and passed on retry, after a worker restart handed it a fresh, empty trip
 * (2026-10-11, #1590). Playwright marks such a test "flaky", but the job goes
 * green and nothing on the PR says so — the retry was hiding a broken test,
 * exactly as vitest's retry hid the Kong 502s (#1527). A retry with no known
 * job left only gives new problems somewhere to hide, and nobody can tell
 * whether it has a job left without this count.
 *
 * So this ALWAYS prints one summary line, including at zero — an absent line
 * would be indistinguishable from a reporter that did not run. In GitHub
 * Actions it also writes a warning annotation per retried test and a table to
 * the job summary, so a retry shows on the PR without opening the log.
 *
 * It reports, it never fails the run: whether retries should exist at all is
 * #1552's decision, made from this count.
 */

import { appendFileSync } from "fs";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export interface E2eRetried {
  file: string;
  name: string;
  retries: number;
  outcome: "passed on retry" | "failed after retries";
  firstError: string | null;
}

/** The retried tests from each test's final attempt. Exported for tests. */
export function retriedFrom(entries: { test: Pick<TestCase, "titlePath" | "location" | "outcome">; result: Pick<TestResult, "retry" | "status" | "errors"> }[]): E2eRetried[] {
  // A test's LAST result is its final word; earlier attempts carry its first error.
  const byTest = new Map<string, { test: (typeof entries)[number]["test"]; results: (typeof entries)[number]["result"][] }>();
  for (const { test, result } of entries) {
    const key = `${test.location.file}:${test.location.line}:${test.titlePath().join(" > ")}`;
    const e = byTest.get(key) ?? { test, results: [] };
    e.results.push(result);
    byTest.set(key, e);
  }
  const out: E2eRetried[] = [];
  for (const { test, results } of byTest.values()) {
    const last = results.reduce((a, b) => (b.retry > a.retry ? b : a));
    if (last.retry === 0) continue;
    const first = results.reduce((a, b) => (b.retry < a.retry ? b : a));
    const err = first.errors?.[0]?.message ?? null;
    out.push({
      file: test.location.file.replace(/\\/g, "/").replace(/^.*?\/e2e\//, "e2e/"),
      name: test.titlePath().filter(Boolean).slice(-1)[0] ?? "",
      retries: last.retry,
      outcome: last.status === "passed" ? "passed on retry" : "failed after retries",
      firstError: err ? err.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200) : null,
    });
  }
  return out;
}

/** The lines printed for a run — the same shape as the vitest reporter's. */
export function summaryLines(retried: E2eRetried[]): string[] {
  const n = retried.length;
  const passed = retried.filter((r) => r.outcome === "passed on retry").length;
  const head =
    n === 0
      ? "[retries] 0 e2e tests needed a retry"
      : `[retries] ${n} e2e test(s) needed a retry (${passed} passed on retry, ${n - passed} failed anyway):`;
  return [
    head,
    ...retried.map(
      (r) => `  ${r.file} > ${r.name}  [${r.outcome}, ${r.retries} retr${r.retries === 1 ? "y" : "ies"}]${r.firstError ? `  — ${r.firstError}` : ""}`
    ),
  ];
}

export default class E2eRetryReporter implements Reporter {
  private entries: { test: TestCase; result: TestResult }[] = [];

  printsToStdio() {
    return true;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.entries.push({ test, result });
  }

  onEnd(_result: FullResult) {
    const retried = retriedFrom(this.entries);
    for (const line of summaryLines(retried)) console.log(line);

    if (process.env.GITHUB_ACTIONS !== "true") return;
    for (const r of retried) {
      const msg = `${r.name} ${r.outcome} (${r.retries} retr${r.retries === 1 ? "y" : "ies"})${r.firstError ? `: ${r.firstError}` : ""}`;
      console.log(`::warning file=${r.file},title=Retried e2e test::${msg.replace(/\r?\n/g, "%0A")}`);
    }
    // A step output, so the workflow can keep the report when a test passed only
    // on retry. The job is green then and the upload-on-failure step skips, which
    // is how every first attempt's trace was thrown away (#1655).
    const output = process.env.GITHUB_OUTPUT;
    if (output) appendFileSync(output, `retried=${retried.length}\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const rows = retried.map(
      (r) => `| \`${r.file}\` | ${r.name.replace(/\|/g, "\\|")} | ${r.outcome} | ${r.retries} | ${(r.firstError ?? "").replace(/\|/g, "\\|")} |`
    );
    appendFileSync(
      summary,
      [
        `### Retried e2e tests: ${retried.length}`,
        "",
        ...(retried.length === 0
          ? ["No end-to-end test needed a retry in this run."]
          : ["| file | test | outcome | retries | first error |", "|---|---|---|---|---|", ...rows]),
        "",
      ].join("\n")
    );
  }
}

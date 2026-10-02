/**
 * Names every test that needed a retry — the reading CI's `retry: 2` otherwise
 * hides.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A test that fails once and passes on retry prints NOTHING in vitest's default
 * reporter, so a green run with ten absorbed failures looks identical to a green
 * run with none. That is how the Kong 502s (#1527) were absorbed for months, and
 * why #1550's fix could not be measured in CI: the instrument hid its own
 * readings. Whatever flakes next would be absorbed the same way.
 *
 * So this reporter ALWAYS prints one summary line, including when the count is
 * zero — an absent line would be indistinguishable from a reporter that did not
 * run. In GitHub Actions it also writes a warning annotation per retried test
 * and a table to the job summary, so a retry shows on the PR without anyone
 * opening the log.
 *
 * It reports, it never fails the run: whether retries should exist at all is a
 * separate decision (retries go once this count stays at zero for a while).
 */

import { appendFileSync } from "fs";
import type { Reporter, TestCase } from "vitest/node";

interface Retried {
  file: string;
  name: string;
  retries: number;
  outcome: "passed on retry" | "failed after retries";
  firstError: string | null;
}

export default class RetryReporter implements Reporter {
  private retried: Retried[] = [];

  onTestCaseResult(testCase: TestCase) {
    const diagnostic = testCase.diagnostic();
    if (!diagnostic || diagnostic.retryCount === 0) return;
    const result = testCase.result();
    const firstError = result.errors?.[0]?.message ?? null;
    this.retried.push({
      file: testCase.module.relativeModuleId,
      name: testCase.fullName,
      retries: diagnostic.retryCount,
      outcome: result.state === "passed" ? "passed on retry" : "failed after retries",
      firstError: firstError ? firstError.split("\n")[0].slice(0, 200) : null,
    });
  }

  onTestRunEnd() {
    const n = this.retried.length;
    const passed = this.retried.filter((r) => r.outcome === "passed on retry").length;
    console.log(
      n === 0
        ? "[retries] 0 tests needed a retry"
        : `[retries] ${n} test(s) needed a retry (${passed} passed on retry, ${n - passed} failed anyway):`
    );
    for (const r of this.retried) {
      console.log(`  ${r.file} > ${r.name}  [${r.outcome}, ${r.retries} retr${r.retries === 1 ? "y" : "ies"}]${r.firstError ? `  — ${r.firstError}` : ""}`);
    }

    if (process.env.GITHUB_ACTIONS !== "true") return;
    for (const r of this.retried) {
      // Annotation text must stay on one line; `%0A` is the Actions newline escape.
      const msg = `${r.name} ${r.outcome} (${r.retries} retr${r.retries === 1 ? "y" : "ies"})${r.firstError ? `: ${r.firstError}` : ""}`;
      console.log(`::warning file=${r.file},title=Retried test::${msg.replace(/\r?\n/g, "%0A")}`);
    }
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const rows = this.retried.map(
      (r) => `| \`${r.file}\` | ${r.name.replace(/\|/g, "\\|")} | ${r.outcome} | ${r.retries} | ${(r.firstError ?? "").replace(/\|/g, "\\|")} |`
    );
    appendFileSync(
      summary,
      [
        `### Retried tests: ${n}`,
        "",
        ...(n === 0
          ? ["No test needed a retry in this run."]
          : ["| file | test | outcome | retries | first error |", "|---|---|---|---|---|", ...rows]),
        "",
      ].join("\n")
    );
  }
}

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * `games.status` is read through `gameLifecycle`, not compared to a literal.
 *
 * ── The rule this enforces ──────────────────────────────────────────────────
 * CLAUDE.md #24 states it: golf's lock state has ONE home, and "any new
 * per-format behaviour that reads `status` / `corrections_open` directly,
 * anywhere outside this module, is the eighth instance arriving." It was written
 * after seven incidents. It has since been the ninth, tenth, eleventh and
 * twelfth as well — twice AFTER being written down. A rule that has failed to
 * hold four times since it was documented does not need restating; it needs a
 * mechanism.
 *
 * The twelfth is the sharpest example: `RackGameView` hid its settings gear
 * behind `!final`, where `final` was a local `status === "complete"` a few
 * hundred lines up. Nothing about the guard line named the column, so no amount
 * of reading for `status` would have found it — but the DERIVATION was right
 * there in the same file, and this test would have failed on it.
 *
 * ── Why source, not types ───────────────────────────────────────────────────
 * A compile error would be better, and it isn't available: `status` is a plain
 * `string` on every row type (`games.status` is `text`, per the ID/type
 * conventions), so `status === "complete"` is a legal string comparison
 * everywhere. Branding it would mean changing the generated DB types and every
 * server read, which is a much larger change than the problem justifies — and
 * the server SHOULD keep comparing literals (see the scope note below).
 *
 * A test that reads source is the next best thing and cannot go stale: it finds
 * violations by shape, so a fifth format's new comparison is caught the moment
 * it is written, with nobody having to remember this file exists.
 *
 * ── Scope: client only, deliberately ────────────────────────────────────────
 * `src/components` + `src/hooks`. NOT `src/server`, and that is a decision
 * rather than an oversight. The server is the AUTHORITY on lifecycle: its reads
 * are refusals (`scores.ts`, `matchOutcomes.ts`, `playGroups.ts`, `games.ts`),
 * each raising a distinct, user-facing message. Routing those through a
 * client-safe predicate would move the refusal one layer away from the message
 * that explains it and make the enforcement point harder to find, which is the
 * opposite of what this is for.
 *
 * ── The escape hatch ────────────────────────────────────────────────────────
 * `// lifecycle-guard-allow: <reason>` on the line above. A reason is REQUIRED —
 * a bare marker fails. Two sites use it today and both are the same kind of
 * thing: a question `gameLifecycle` deliberately does not model.
 */

const SCANNED = ["components", "hooks"];
const SRC = resolve(__dirname, "..");

/** A game status compared to one of its literals — the derivation, in any shape. */
const VIOLATION = /\bstatus\s*[!=]==\s*["'](complete|active|pending)["']|["'](complete|active|pending)["']\s*[!=]==\s*[\w.?]*\bstatus\b/;
// No `$` anchor: the repo checks out CRLF on Windows, so every line carries a
// trailing `\r` and anchoring the reason to end-of-line is one more thing that
// can silently stop matching. The reason runs to the end of the line either way.
const ALLOW = /\/\/\s*lifecycle-guard-allow:\s*(\S.*)/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
  allowedBecause: string | null;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCANNED) {
    for (const file of sourceFiles(join(SRC, dir))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Prose about the rule is not a violation of it — this file, and the
        // comments explaining why a site is excused, both name the literals.
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (!VIOLATION.test(line)) return;
        const prev = lines[i - 1] ?? "";
        const allow = prev.match(ALLOW);
        hits.push({
          file: file.replace(SRC, "src"),
          line: i + 1,
          text: trimmed,
          allowedBecause: allow ? allow[1].trim() : null,
        });
      });
    }
  }
  return hits;
}

describe("lifecycle state is read through gameLifecycle", () => {
  it("the scan finds real code (it is not passing vacuously)", () => {
    // Every hit is currently allowed, so an empty result would look identical to
    // a broken scanner. Assert the scanner still SEES the allowed sites.
    expect(scan().length).toBeGreaterThan(0);
  });

  it("no unexplained comparison of a game status to a literal", () => {
    const offenders = scan().filter((h) => h.allowedBecause === null);
    expect(
      offenders.map((h) => `${h.file}:${h.line}  ${h.text}`),
      "Compare `status` through `gameLifecycle` (`gameLockState` for " +
        "final/locked/correcting, `isPreScoring` for has-setup-ended) rather than " +
        "to a literal. If this genuinely asks something the module does not model, " +
        "add `// lifecycle-guard-allow: <why>` on the line above — the reason is " +
        "required, and it is the thing the next reader needs.",
    ).toEqual([]);
  });

  it("every allowance carries a reason", () => {
    // A marker with no reason is how an escape hatch becomes a rubber stamp.
    const bare = scan().filter((h) => h.allowedBecause !== null && h.allowedBecause.length < 12);
    expect(bare.map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });
});

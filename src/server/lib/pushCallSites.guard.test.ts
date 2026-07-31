import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

/**
 * SOURCE GUARD — which files may send a push.
 *
 * NOTIFICATIONS.md marks a set of write sites **NEVER**: `scores.upsertEntry`
 * (~540/day), `scores.deleteEntry`, `matches.setPairings` / `assignPlayer` /
 * `reorder`, `matches.setHandicap` / `setPointValue`. That marking is a
 * permanent property of those events, not a Phase 3 judgment call — wiring one
 * is how you nuke delivery reputation across 30 phones in an afternoon, and the
 * people who then disable notifications at the OS level never come back.
 *
 * "Don't wire those" is exactly the kind of rule that holds right up until
 * someone adds a notification to the router they happen to be editing. So it is
 * enforced mechanically instead of remembered: only the files below may import a
 * send helper, and adding a new one is a deliberate, reviewed act rather than an
 * import that slips through.
 *
 * This is a compile-free, DB-free grep over the source tree — it runs in every
 * environment, including one with no Supabase stack.
 */

const SRC = resolve(__dirname, "../..");

/** The send helpers. Any import of these is a potential push. */
const SEND_HELPERS = ["sendPush", "sendPushToUsers"];

/**
 * Files permitted to import a send helper, with the reason each is allowed.
 * Adding a line here should require justifying the volume, the audience, and
 * the eligibility marking in NOTIFICATIONS.md.
 */
const ALLOWED: Record<string, string> = {
  "server/lib/sendPush.ts": "the single-user send helper itself",
  "server/lib/sendPushToUsers.ts": "the batched fan-out helper itself",
  "server/lib/gameFinishNotify.ts":
    "the ONE domain wire point — games.finish (all four formats) + cup clinched",
  "server/routers/notifications.ts":
    "testSend — a self-only diagnostic; can never reach another user",
};

/** Routers that own NEVER-marked write sites. Named explicitly so the failure
 *  message can say WHICH prohibition was breached, not just "not allowed". */
const NEVER_ROUTERS: Record<string, string> = {
  "server/routers/scores.ts": "scores.upsertEntry / deleteEntry (~540/day, mechanical)",
  "server/routers/matches.ts":
    "matches.setPairings / assignPlayer / reorder / setHandicap / setPointValue (setup churn)",
  "server/routers/matchOutcomes.ts": "per-hole outcome entry (mechanical)",
  "server/routers/playGroups.ts": "grouping setup (mechanical)",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Does this file import one of the send helpers? Matches the import statement
 *  specifically, so a passing mention in a comment doesn't trip the guard. */
function importsSendHelper(source: string): boolean {
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*(?:sendPush|sendPushToUsers)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    const named = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    // A type-only import (e.g. `PushPayload`) is not a send.
    if (named.some((n) => SEND_HELPERS.includes(n))) return true;
  }
  return false;
}

describe("push call-site allowlist", () => {
  const files = walk(SRC);
  const offenders = files
    .map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), src: readFileSync(f, "utf8") }))
    .filter(({ src }) => importsSendHelper(src))
    .map(({ rel }) => rel)
    .filter((rel) => !(rel in ALLOWED));

  it("only allowlisted files import a send helper", () => {
    expect(
      offenders,
      `Unlisted push call site(s). A push from a high-frequency write site is a ` +
        `permanent reputation cost, not a bug you can hotfix. If this is genuinely ` +
        `a milestone event, add it to ALLOWED here AND to NOTIFICATIONS.md with an ` +
        `eligibility marking and a volume estimate.`
    ).toEqual([]);
  });

  it("no NEVER-marked router sends a push", () => {
    const breached = Object.keys(NEVER_ROUTERS).filter((rel) => offenders.includes(rel));
    expect(
      breached.map((r) => `${r} — ${NEVER_ROUTERS[r]}`),
      "A NEVER-marked write site is wired to push. This is the check that protects delivery reputation."
    ).toEqual([]);
  });

  it("every allowlisted file still exists (no stale entries)", () => {
    const present = new Set(files.map((f) => relative(SRC, f).replace(/\\/g, "/")));
    const stale = Object.keys(ALLOWED).filter((rel) => !present.has(rel));
    expect(stale, "stale ALLOWED entry — file moved or deleted").toEqual([]);
  });

  it("the wire point is actually wired (the guard can't pass by everything being dead)", () => {
    // Without this, deleting the wiring entirely would make the guard go green —
    // an allowlist proves nothing extra is sending, not that anything is.
    const games = readFileSync(join(SRC, "server/routers/games.ts"), "utf8");
    expect(games).toContain("notifyGameFinished");
    expect(games).toContain("notifyCupClinchedIfDecided");
  });
});

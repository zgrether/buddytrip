import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * The settings gear is gated on ROLE, never on lifecycle state.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 * #882 opened settings on completed games and removed the `status === "complete"`
 * gate from the gear each view publishes to `GameChrome` (the panel path). Every
 * view ALSO renders a second gear in its own standalone-route header, and there
 * the gate survived — in match and rack, the same two formats. Rack ended up
 * disagreeing with itself: its setup-screen gear had never had the gate, its
 * play-screen gear did.
 *
 * That is the twelfth instance of CLAUDE.md #24's pattern, and its distinguishing
 * feature is that it was created by the FIX for the eleventh. A shared shell with
 * two render paths means a behaviour can be corrected in one and left in the
 * other, and nothing says so.
 *
 * ── Why a source scan rather than a render test ─────────────────────────────
 * The gate is a JSX condition on a header that only appears on a standalone
 * route, on a specific screen, for a configured game — three coincidences to
 * arrange before a render test can even look at it, per format, which is
 * precisely why nobody had. The condition itself is a few characters of source,
 * and reading the source is the cheapest thing that could have caught this.
 *
 * A source scan cannot go stale the way a hand-maintained list does: it finds
 * gear sites by their test id, so a NEW gear in a fifth format is checked the
 * moment it is written, without anyone remembering to add it here.
 */

const GAMES_DIR = resolve(__dirname);
const GEAR_TESTID = 'data-testid="game-settings-gear"';

/** Lifecycle words that must not appear in a gear's guard. `final` catches the
 *  local aliases (`const final = status === "complete"`) that are how the gate
 *  hid in rack — the raw column name never appeared on the guard line itself. */
const LIFECYCLE = /\b(status|final|complete|corrections_open|correctionsOpen|isFinal|isLocked)\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * The guard for a gear is the source between the enclosing `right={` / `{` and
 * the gear's own test id — i.e. the condition that decides whether it renders.
 * Six lines back is comfortably more than any current guard spans and stops the
 * scan swallowing unrelated code above it.
 */
function guardsForGear(source: string): string[] {
  const lines = source.split("\n");
  const guards: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(GEAR_TESTID)) return;
    // Walk back to the nearest line opening a conditional render, skipping
    // comment lines — the explanation of WHY there is no gate legitimately
    // mentions `complete`, and commentary must not fail the test.
    const window = lines
      .slice(Math.max(0, i - 6), i)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    guards.push(window);
  });
  return guards;
}

describe("the settings gear is role-gated, never lifecycle-gated", () => {
  const files = tsxFiles(GAMES_DIR);

  it("finds every gear render site (the scan itself is working)", () => {
    // A guard that finds nothing passes vacuously forever. Pin the count's
    // floor so deleting the test ids — or renaming them — fails loudly here
    // rather than silently disarming this.
    const total = files.reduce(
      (n, f) => n + guardsForGear(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it("no gear's guard reads lifecycle state", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const guard of guardsForGear(readFileSync(file, "utf8"))) {
        const hit = guard.match(LIFECYCLE);
        if (hit) offenders.push(`${file.replace(GAMES_DIR, "")} — "${hit[0]}" in:\n${guard}`);
      }
    }
    expect(
      offenders,
      "A settings gear is gated on lifecycle state. Settings stay reachable on a " +
        "completed game (#882) — the standings-affecting edits are refused " +
        "SERVER-side by save_game_config's FINAL_LOCKED guard, which explains " +
        "itself; an invisible gear does not. Gate on `canEdit` only.\n\n" +
        offenders.join("\n\n"),
    ).toEqual([]);
  });
});

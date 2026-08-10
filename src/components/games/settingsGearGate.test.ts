import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * The settings gear is gated on ROLE, never on lifecycle state.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 * #882 opened settings on completed games and removed the `status === "complete"`
 * gate from the gear each view published to `GameChrome` (the panel path). Every
 * view ALSO rendered a second gear in its own route header, and there the gate
 * survived — in match and rack, the same two formats. Rack disagreed with
 * itself: the gear on its setup screen never had the gate, the one on its play
 * screen did. #883 fixed both.
 *
 * ── Where the gate lives NOW ────────────────────────────────────────────────
 * There used to be FIVE gear render sites, and the gate was the JSX condition
 * wrapped around each. Phase 2 collapsed them: there is ONE gear, in
 * `GameChromeActions`, rendering on `chrome.onSettings`. So the condition that
 * decides whether an editor sees settings moved out of five pieces of markup and
 * into the one `onSettings:` expression each surface publishes.
 *
 * This scan followed it, and had to. Checking the gear's JSX now would pass
 * forever while saying nothing, because that guard is simply
 * `chrome.onSettings &&`; the interesting expression is upstream. A guard that
 * survives a refactor by going vacuous is worse than no guard, because it still
 * looks like coverage. (Its old floor of "at least 5 gear sites" is what caught
 * this — the collapse dropped it to 1 and the assertion failed loudly.)
 *
 * It matches `final` as well as `status`, because that is how the gate hid in
 * rack: the guard read `!final`, where `final` was a local
 * `status === "complete"` a few hundred lines up. Nothing on the line named the
 * column.
 */

const GAMES = resolve(__dirname);

/** Lifecycle words that must not appear in the gate. */
const LIFECYCLE = /\b(status|final|complete|corrections_open|correctionsOpen|isFinal|isLocked|isCorrecting)\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Every `onSettings:` expression, comment lines stripped — prose explaining
 *  why there is NO gate legitimately says "complete". */
function onSettingsExpressions(source: string): string[] {
  const lines = source.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!/\bonSettings:/.test(line)) return;
    out.push(
      lines
        .slice(i, i + 4)
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .join("\n"),
    );
  });
  return out;
}

describe("the settings gear is role-gated, never lifecycle-gated", () => {
  const files = tsxFiles(GAMES);

  it("finds every surface's onSettings expression (the scan is working)", () => {
    // One per game surface. A scan that finds nothing passes vacuously forever,
    // and this one has already had to move once — pin the floor to the number of
    // formats so a rename, or a refactor that orphans it, fails loudly here.
    const total = files.reduce((n, f) => n + onSettingsExpressions(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("no surface gates its settings gear on lifecycle state", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const expr of onSettingsExpressions(readFileSync(file, "utf8"))) {
        const hit = expr.match(LIFECYCLE);
        if (hit) offenders.push(`${file.replace(GAMES, "")} — "${hit[0]}" in:\n${expr}`);
      }
    }
    expect(
      offenders,
      "Settings stay reachable on a completed game (#882) — the " +
        "standings-affecting edits are refused SERVER-side by save_game_config's " +
        "FINAL_LOCKED guard, which explains itself; an invisible gear does not. " +
        "Gate `onSettings` on role and screen only.\n\n" +
        offenders.join("\n\n"),
    ).toEqual([]);
  });
});

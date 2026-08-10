import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * A game surface has ONE header per host, and its actions come from the chrome.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Four hand-written route headers — rack's `Shell`, match's `SetupHeader`, and
 * inline `<header>` blocks in stroke and non-golf — identical to the character
 * except stroke's, which had quietly lost its `backdrop-filter`. Each took a
 * `right` slot, so each view decided for itself which actions to show, and in
 * two formats that decision drifted from what the panel showed (#883,
 * divergence #12: the settings gear).
 *
 * The fix is structural — `GameStandaloneHeader` renders `GameChromeActions`
 * from the same `GameChromeData` the view publishes — so the two hosts cannot
 * carry different actions. These tests keep it that way.
 *
 * ── Why the action-button check is the important one ────────────────────────
 * A fifth format copying a header is a nuisance; a fifth format hand-rolling an
 * action button is the divergence returning. `game-settings-gear`,
 * `game-scorecard` and `game-rules` may exist in exactly one place each, and
 * that place is the shared cluster.
 */

const GAMES = resolve(__dirname);
const SHELL = resolve(__dirname, "../shell");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx$/.test(e) && !e.includes(".test.")) out.push(full);
  }
  return out;
}

const ALL = [...files(GAMES), ...files(SHELL)];

/** The one component allowed to render an action button. */
const CLUSTER = "GameChromeActions.tsx";

describe("one header, one action cluster", () => {
  it.each(["game-settings-gear", "game-rules", "game-scorecard"])(
    "%s is rendered in exactly one place",
    (testId) => {
      const owners = ALL.filter((f) => readFileSync(f, "utf8").includes(`data-testid="${testId}"`))
        .map((f) => f.split(/[\\/]/).pop()!);
      expect(
        owners,
        `Game action buttons live in ${CLUSTER}, which BOTH hosts render — the ` +
          `panel via GameActionRow and the standalone route via ` +
          `GameStandaloneHeader. A second copy is how the gear ended up present ` +
          `on one host and absent on the other (#883).`,
      ).toEqual([CLUSTER]);
    },
  );

  it("no game SURFACE hand-rolls its route header", () => {
    // Scoped to files with the panel/standalone duality — the ones that call
    // `useGameSurfaceChrome`. That is what makes a file a game SURFACE rather
    // than an in-page screen: `ScoreEntryView`, `CoursePicker`, `HandicapRoster`
    // and the match entry views all carry a 52px header too, but theirs heads a
    // sub-screen inside one host, has no second copy to drift from, and is not
    // what #12 was about. Deriving the set from the hook rather than naming the
    // four views keeps a fifth format in scope automatically.
    const surfaces = ALL.filter((f) => readFileSync(f, "utf8").includes("useGameSurfaceChrome"));
    expect(surfaces.length, "the surface scan found nothing — did the hook get renamed?")
      .toBeGreaterThanOrEqual(4);

    const offenders = surfaces
      .filter((f) => /<header[\s\S]{0,400}?height:\s*52/.test(readFileSync(f, "utf8")))
      .map((f) => f.split(/[\\/]/).pop()!);

    expect(
      offenders,
      "Use `GameStandaloneHeader` for a game surface's own-route header. Four " +
        "copies of this markup is what made a per-format action set possible.",
    ).toEqual([]);
  });

  it("the scan sees the real files (not passing vacuously)", () => {
    expect(ALL.length).toBeGreaterThan(20);
    expect(ALL.some((f) => f.endsWith(CLUSTER))).toBe(true);
  });
});

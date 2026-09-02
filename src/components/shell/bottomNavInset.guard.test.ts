import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

/**
 * SOURCE GUARD — the bottom-nav clearance is MEASURED, never a constant.
 *
 * ── What this protects ──────────────────────────────────────────────────────
 *
 * `AppTabBar` publishes its own `offsetHeight` to `--bt-bottomnav-height` via a
 * ResizeObserver, and REMOVES the property on unmount — so the variable is `0px`
 * exactly when there is no bar (a focused entry surface, or a standalone game
 * route, which mounts none at all). Anything clearing that bar reads the
 * variable and is correct in every one of those states for free.
 *
 * A literal is wrong in all of them at once. Before this guard the codebase
 * carried THREE numbers for one bar:
 *
 *   64px   the game panel's `paddingBottom` (CompetitionFace)
 *   64px   pick'em's own compensating inset (PickemGameView)
 *   58px   what the comment next to the first one said
 *   57px   what the bar actually measures
 *
 * None of them agreed, and the two 64s were also being applied to surfaces with
 * no bottom nav on them. This is the class CLAUDE.md calls out repeatedly — a
 * derived value snapshotted as a constant, which is right until the thing it was
 * measured from changes and then silently wrong forever.
 *
 * ── Why a source guard rather than a layout test ────────────────────────────
 *
 * Layout is not assertable in this harness: `renderToStaticMarkup` has no layout
 * engine, so "the last card clears the nav" cannot be written here at all — that
 * measurement lives in the PR body and in Zach's look on a device. What IS
 * assertable, mechanically and cheaply, is that no surface has gone back to a
 * hardcoded number. That is the thing a person would otherwise have to remember.
 *
 * Modelled on `src/server/lib/pushCallSites.guard.test.ts` — same shape
 * (allowlist with a stated reason per entry, compile-free, DB-free grep over the
 * tree), because that guard exists for the same reason: a rule that holds right
 * up until someone edits the file they happen to be in.
 */

const SRC = resolve(__dirname, "../..");

/**
 * A hardcoded bottom-nav clearance. The tell is a pixel literal added to
 * `env(safe-area-inset-bottom)` — that combination only ever means "get above
 * the bottom bar", which is precisely what the variable already answers.
 *
 * Deliberately NOT a general "no px literals" rule: padding, gaps and type sizes
 * are literals everywhere and correctly so. This matches the one shape that has
 * a measured source available.
 */
const HARDCODED_NAV_CLEARANCE = /calc\(\s*\d+px\s*\+\s*env\(\s*safe-area-inset-bottom/;

/** The variable every such surface should read instead. */
const MEASURED = "--bt-bottomnav-height";

/**
 * Files allowed to mention a bottom-inset literal, with the reason.
 *
 * Adding a line here should require explaining why a measured value will not do.
 * "It was easier" is not a reason; `--bt-bottomnav-height` is one `var()` away
 * in every component in this tree.
 */
const ALLOWED: Record<string, string> = {
  // ── Publishers: the source of the measurement, not consumers of it ────────
  "components/shell/AppTabBar.tsx": "publishes --bt-bottomnav-height; its own safe-area padding is the bar's",
  "components/BottomNav.tsx": "the legacy bar, same role — publisher, not consumer",

  // ── NOT nav clearances at all: home-indicator clearance where no bar exists ─
  //
  // Both were flagged when this guard was first run, and both are correct. The
  // pattern `Npx + env(safe-area-inset-bottom)` is not unique to nav clearance —
  // it also spells "keep this off the home indicator under viewport-fit=cover",
  // which is a different problem with the same syntax. Kept as an allowlist with
  // stated reasons rather than narrowed by a size heuristic (">40px means nav"),
  // because the distinguishing fact is WHERE THE SURFACE RENDERS, which no
  // regex over one line can see.
  "components/games/entryChrome.tsx":
    "renders ONLY on focused entry surfaces, where focusedEntry hides the tab bar and the " +
    "variable is REMOVED — there is no measured height to prefer and nothing to double-count " +
    "against (its own comment says exactly this). The 24px is the CTA's gutter; the env() is " +
    "the home indicator.",
  "components/SiteFooter.tsx":
    "suppressed on every AppShell route — i.e. on every route that HAS a bottom nav. The 18px " +
    "is the footer's own padding; the env() is the home indicator.",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments — this file's own prose quotes the forbidden shape to explain
 *  it, and so does the code it guards. Same reason as TripIdProvider's `codeOf`. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = walk(SRC).map((f) => ({ rel: relative(SRC, f).replace(/\\/g, "/"), code: codeOf(f) }));

describe("bottom-nav clearance is measured, not hardcoded", () => {
  it("finds source files to check (the guard can actually see the tree)", () => {
    // Absence of matches is absence of search — CLAUDE.md. A walk that returned
    // nothing would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.rel === "components/competition/CompetitionFace.tsx")).toBe(true);
  });

  it("no surface hardcodes a pixel clearance over the bottom nav", () => {
    const offenders = files
      .filter((f) => HARDCODED_NAV_CLEARANCE.test(f.code))
      .filter((f) => !(f.rel in ALLOWED))
      .map((f) => f.rel);
    expect(
      offenders,
      offenders.length
        ? `Hardcoded bottom-nav clearance in:\n  ${offenders.join("\n  ")}\n` +
            `Use calc(var(${MEASURED}, env(safe-area-inset-bottom, 0px)) + <gap>) instead — ` +
            `AppTabBar publishes its measured height and removes the property when there is no bar, ` +
            `so the variable is already correct on entry surfaces and standalone routes.`
        : undefined,
    ).toEqual([]);
  });

  it("the game panel's scroller reads the measured variable", () => {
    // The positive half. Without it, deleting the inset entirely would pass the
    // assertion above — zero offenders and zero clearance look identical to a
    // guard that only forbids.
    const face = files.find((f) => f.rel === "components/competition/CompetitionFace.tsx")!;
    expect(face.code).toContain(MEASURED);
  });

  it("the allowlist names only publishers, and each entry still exists", () => {
    // A stale allowlist silently widens the rule. Every entry must be a real
    // file, so a rename or deletion surfaces here rather than quietly excusing
    // some other file that later takes the same path.
    for (const rel of Object.keys(ALLOWED)) {
      expect(files.some((f) => f.rel === rel), `allowlisted file is gone: ${rel}`).toBe(true);
    }
  });
});

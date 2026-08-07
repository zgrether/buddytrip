import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * Source guard — a shell-hosted `TopNav` must be told the viewer's team colour.
 *
 * ── The regression this exists for ───────────────────────────────────────────
 * The account avatar renders in the user's team colour. The ONLY call site that
 * ever supplied that colour was `LiveFaceClient`'s own `TopNav`, back when the
 * competition face owned the route `/trips/[tripId]/leaderboard`.
 *
 * The four-tab shell (#728) moved the Cup surface into `AppShell` and turned that
 * route into a redirect alias. From that commit the face rendered under the
 * SHARED bar supplied by the trip page's `topBar` render prop — which was never
 * wired for `avatarTeamColor`. Nothing errored. `tsc` was clean, because the prop
 * is optional. The colour simply stopped appearing, and stayed gone for weeks.
 * #759 then removed the orphaned implementation as dead code, which it correctly
 * was — leaving a prop with no setter anywhere and no history of one in a live
 * path.
 *
 * That is the failure mode this guard catches, and it is not specific to this
 * prop: an OPTIONAL prop on a SHARED component, supplied by a host that a shell
 * restructure replaces. Nothing about it is visible to the type checker.
 *
 * ── Why `topBar` is the right scope ──────────────────────────────────────────
 * A `TopNav` inside a `topBar={…}` render prop is a shell-hosted bar spanning
 * Home · Trip · Cup · Chat, and it always has a current trip in hand (directly,
 * or as the dashboard's `remoteTripId`). The standalone bars — profile, archived
 * ideas, /trips/new — are context-free routes with no trip and no team, and are
 * correctly excluded rather than exempted.
 */

const ROOT = resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so prose ABOUT the prop can't satisfy a guard on the prop. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every `<TopNav …>` element in `src`, as raw JSX text, with its file. */
function topNavElements(): Array<{ file: string; jsx: string }> {
  const out: Array<{ file: string; jsx: string }> = [];
  for (const file of walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))) {
    const code = codeOf(file);
    const re = /<TopNav\b[\s\S]*?\/>/g;
    for (const m of code.matchAll(re)) {
      out.push({ file: file.slice(ROOT.length + 1).replace(/\\/g, "/"), jsx: m[0] });
    }
  }
  return out;
}

describe("TopNav — the shell-hosted app bar always receives avatarTeamColor", () => {
  it("finds the shell hosts at all (the scan itself must not silently match nothing)", () => {
    // A guard that matches zero call sites passes forever and protects nothing —
    // the same "reads as coverage" failure a silently-skipped test has.
    const hosts = topNavElements().filter((e) => codeOf(join(ROOT, e.file)).includes("topBar={"));
    expect(hosts.length).toBeGreaterThanOrEqual(2); // dashboard + trip page
  });

  it("every TopNav in a topBar render prop passes avatarTeamColor", () => {
    const offenders = topNavElements()
      .filter((e) => codeOf(join(ROOT, e.file)).includes("topBar={"))
      .filter((e) => !e.jsx.includes("avatarTeamColor"))
      .map((e) => e.file);

    expect(
      offenders,
      `These shell-hosted <TopNav> call sites don't pass avatarTeamColor, so the ` +
        `account avatar silently falls back to teal for users who are on a team:\n` +
        offenders.map((f) => `  - ${f}`).join("\n") +
        `\n\nResolve it with useMyTeamColor(tripId) and pass it through. ` +
        `The prop is optional, so tsc will not tell you.`,
    ).toEqual([]);
  });

  it("the colour is resolved through the shared hook, not re-derived per host", () => {
    // Two hosts computing "my team colour" from different data is how they drift
    // — one reading the bootstrap, one a roster query, disagreeing after an edit.
    for (const file of ["app/dashboard/DashboardClient.tsx", "app/trips/[tripId]/page.tsx"]) {
      expect(codeOf(join(ROOT, file)), `${file} should use useMyTeamColor`).toContain(
        "useMyTeamColor",
      );
    }
  });
});

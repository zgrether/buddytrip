import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { FORMAT_SURFACE, type GameSurfaceId } from "@/lib/formatSurface";

/**
 * There is ONE game settings page, and the registry does not lie about it.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Three settings trees — `GameConfigurationView` (rack + stroke),
 * `NonGolfConfigurationView`, and ~390 lines inline in `MatchGameView` — each
 * assembling the same shared components in the same canonical order. They agreed
 * only by having been dragged into agreement, one cross-format consistency pass
 * at a time, and match still carried a private `ZoneHeader` at the end of it.
 *
 * ── The two things worth pinning ────────────────────────────────────────────
 * 1. Nobody builds a second one. `SettingsSlideOver` is the settings shell, and
 *    `GameSettingsPage` is the only thing allowed to open it. A fifth format that
 *    "just needs a slightly different page" is the fourth tree arriving.
 * 2. The registry matches the slots. `FORMAT_SURFACE.nongolf.course` says
 *    non-golf has no course; this asserts `NonGolfGameView` passes no `courseRow`,
 *    and that the three that DO declare a course pass one. A registry field that
 *    nothing checks is a comment with a type annotation.
 *
 * Both are source scans rather than renders, because what is being defended is a
 * property of the FILES — "there is only one of these" cannot be observed from
 * inside a single mounted component.
 */

const GAMES = resolve(__dirname);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx$/.test(e) && !e.includes(".test.")) out.push(full);
  }
  return out;
}

const ALL = files(GAMES);
const read = (f: string) => readFileSync(f, "utf8");
const base = (f: string) => f.split(/[\\/]/).pop()!;

/** The one component allowed to open the settings shell. */
const PAGE = "GameSettingsPage.tsx";

/** Where each surface's settings call site lives. */
const CALLERS: Record<GameSurfaceId, string> = {
  match: "MatchGameView.tsx",
  rack: "RackGameView.tsx",
  stroke: "StrokeGameView.tsx",
  nongolf: "NonGolfGameView.tsx",
  pickem: "PickemGameView.tsx",
};

const SURFACES = Object.keys(FORMAT_SURFACE) as GameSurfaceId[];

describe("one settings page", () => {
  it("only GameSettingsPage renders the settings shell", () => {
    const owners = ALL.filter((f) => read(f).includes("<SettingsSlideOver")).map(base);
    expect(
      owners,
      "A format that opens `SettingsSlideOver` itself is building a second " +
        "settings page. Pass slots to `GameSettingsPage` instead — the zone " +
        "order it encodes (Rules before Modifiers, Course before Handicaps) is " +
        "a decision, and three copies of it is how two of three get moved.",
    ).toEqual([PAGE]);
  });

  it("no format keeps a private ZoneHeader", () => {
    // Match did, character-identical to the shared one, for as long as it had its
    // own tree. Nothing rendered differently, which is why it survived.
    const privateDefs = ALL.filter(
      (f) => base(f) !== "ZoneHeader.tsx" && /function ZoneHeader\b/.test(read(f)),
    ).map(base);
    expect(privateDefs, "Import `@/components/games/ZoneHeader`.").toEqual([]);
  });

  it("every surface in the registry has a settings call site", () => {
    for (const id of SURFACES) {
      const file = ALL.find((f) => base(f) === CALLERS[id]);
      expect(file, `${id}: no view file named ${CALLERS[id]}`).toBeTruthy();
      expect(
        read(file!),
        `${id} does not render GameSettingsPage — a surface in the registry with ` +
          `no settings page is a format that compiles and then has nowhere to be ` +
          `configured.`,
      ).toContain(`surface="${id}"`);
    }
  });

  it.each(["course", "modifiers"] as const)(
    "the registry's `%s` matches the slot each view passes",
    (slot) => {
      // The registry is the written-down answer; the call site is the actual one.
      // A new format declaring `course: true` and forgetting the row — or the
      // reverse — is precisely the omission this phase exists to make impossible.
      const prop = slot === "course" ? "courseRow=" : "modifiersRow=";
      for (const id of SURFACES) {
        const src = read(ALL.find((f) => base(f) === CALLERS[id])!);
        expect(
          src.includes(prop),
          `${id}: FORMAT_SURFACE says ${slot}=${FORMAT_SURFACE[id][slot]} but ` +
            `${CALLERS[id]} ${src.includes(prop) ? "does" : "does not"} pass ${prop}`,
        ).toBe(FORMAT_SURFACE[id][slot]);
      }
    },
  );

  it("the scan sees the real files (not passing vacuously)", () => {
    expect(ALL.length).toBeGreaterThan(20);
    expect(ALL.some((f) => base(f) === PAGE)).toBe(true);
    for (const f of Object.values(CALLERS)) {
      expect(ALL.some((x) => base(x) === f), `${f} not found`).toBe(true);
    }
  });
});

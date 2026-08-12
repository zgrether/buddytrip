import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_COLOR, badgedRole } from "./roleColor";

const src = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

describe("badgedRole", () => {
  it("marks Owner and Organizer, and nothing else", () => {
    expect(badgedRole("Owner")).toBe("Owner");
    expect(badgedRole("Organizer")).toBe("Organizer");
    for (const r of ["Member", "Planner", "", null, undefined, "owner"]) {
      expect(badgedRole(r)).toBeNull();
    }
  });
});

describe("Organizer does not collide with the accent", () => {
  it("is not the accent token", () => {
    // The reason this colour changed at all: the rail paints the role as a 3px
    // edge, and the selected-row treatment and the trophy mark on that same row
    // are both already the accent.
    expect(ROLE_COLOR.Organizer.text).not.toContain("bt-accent");
    expect(ROLE_COLOR.Organizer.faint).not.toContain("bt-accent");
    expect(ROLE_COLOR.Organizer.border).not.toContain("bt-accent");
  });

  it("is a different hue family from Owner", () => {
    expect(ROLE_COLOR.Organizer.text).not.toBe(ROLE_COLOR.Owner.text);
  });
});

/**
 * ── Source guard: the badge and the edge are painted from ONE value ─────────
 *
 * Same idiom as `TripIdProvider.test.ts` — the invariant is "nobody re-derives
 * this locally", which no runtime assertion can see, because a second hardcoded
 * copy that happens to match today produces identical behaviour. It only shows
 * up the day one side changes, which is precisely how the badge and the pill
 * got out of sync being written twice in the first place.
 *
 * Scoped to the files that paint a ROLE. `CrewRoster.tsx` is checked for the
 * import rather than for the absence of tokens, because it legitimately uses
 * `--color-bt-warning` for pending-invite state and the planning trio for its
 * travel CTA — neither of which is a role colour.
 */
describe("source guard — no second copy of a role colour", () => {
  const ROLE_TOKENS = [
    "--color-bt-owner",
    "--color-bt-warning-faint",
    "--color-bt-warning-border",
    "--color-bt-planning-faint",
    "--color-bt-planning-border",
  ];

  for (const file of ["components/RoleBadge.tsx", "components/shell/rail/RailTripRow.tsx"]) {
    it(`${file} names no role colour token directly`, () => {
      const body = src(file);
      for (const token of ROLE_TOKENS) {
        expect(body, `${file} should read ${token} via @/lib/roleColor`).not.toContain(token);
      }
    });
  }

  for (const file of [
    "components/RoleBadge.tsx",
    "components/shell/rail/RailTripRow.tsx",
    "components/shell/ContextRail.tsx",
    "app/trips/[tripId]/tabs/components/CrewRoster.tsx",
  ]) {
    it(`${file} imports the shared source`, () => {
      expect(src(file)).toMatch(/from "@\/lib\/roleColor"/);
    });
  }

  it("the rail key says Owner and Organizer, and never 'Admin'", () => {
    // "Admin" named a grouping — Owner-or-Organizer as one amber band — that no
    // longer exists. The only mentions left are the comments explaining why it
    // went, so comment lines are stripped and the check is on what can RENDER.
    //
    // This used to assert exact markup (`<span>Owner</span>`) and broke the
    // moment the key's spans were regrouped to stop the trophy wrapping away
    // from its label — a true invariant reported as broken by a cosmetic
    // change. The invariant is the three WORDS being present as label text, so
    // it now matches a bare JSX text node on its own line: markup-tolerant, but
    // still falsified if a label is deleted (a `role="Owner"` prop would not
    // satisfy it).
    // Strip comment BLOCKS, not comment lines: the surviving "Admin" mentions
    // live inside a `{/* … */}` JSX comment whose continuation lines start with
    // ordinary prose, so a per-line filter walks straight past them.
    const code = src("components/shell/ContextRail.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .split("\n");

    for (const word of ["Owner", "Organizer", "Cup"]) {
      expect(
        code.some((l) => l.trim() === word),
        `the rail key should render "${word}" as a label`,
      ).toBe(true);
    }
    expect(
      code.join("\n"),
      "'Admin' names a grouping that no longer exists",
    ).not.toMatch(/\bAdmin\b/);
  });
});

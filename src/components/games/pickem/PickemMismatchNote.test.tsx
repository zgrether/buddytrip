import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMismatchNote, type MismatchTeam } from "./PickemMismatchNote";

/**
 * The note that says where the pairing and the rosters disagree.
 *
 * ── The regression this pins ───────────────────────────────────────────────
 *
 * It lived inside `PickemMatchesPanel`. Moving the BUILDER to the shared
 * `MatchSetup` left it behind, so it rendered only on the read-only post-lock
 * display — too late to act on — and vanished from the surface where the runner
 * actually pairs. Two surfaces disagreeing about the same person, and the wrong
 * one was right.
 *
 * ── And the wording is not cosmetic ────────────────────────────────────────
 *
 * "Swap them out for someone on the roster" is a correct instruction beside a
 * pairing grid and a lie beside a locked one — a message naming an action the
 * reader cannot take. `actionable` is what keeps those apart, so it is asserted
 * in both directions rather than assumed.
 */

const team = (id: string, name: string, memberIds: string[]): MismatchTeam => ({
  id,
  name,
  memberIds,
});

const NAMES: Record<string, string> = { a1: "Zach", a2: "Rob", b1: "Frank", ghost: "New Name" };
const nameOf = (id: string) => NAMES[id] ?? "Unknown";

const render = (
  pairs: { a: string | null; b: string | null }[],
  teams: [MismatchTeam, MismatchTeam],
  actionable = true
) =>
  renderToStaticMarkup(
    <PickemMismatchNote pairs={pairs} teams={teams} nameOf={nameOf} actionable={actionable} />
  );

describe("PickemMismatchNote", () => {
  it("says NOTHING when the pairing matches the rosters", () => {
    const html = render(
      [{ a: "a1", b: "b1" }],
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])]
    );
    expect(html).toBe("");
  });

  it("INSTRUCTS where the reader can act", () => {
    const html = render(
      [{ a: "ghost", b: "b1" }],
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])],
      true
    );
    expect(html).toContain("New Name");
    expect(html).toContain("no longer on either team");
    expect(html).toContain("swap them");
  });

  it("STATES the same fact where they cannot", () => {
    // The read-only post-lock display. Naming an action its reader cannot take
    // is the class that cost a session in Phase 7 — the reader goes looking,
    // finds nothing, and concludes the app is broken.
    const html = render(
      [{ a: "ghost", b: "b1" }],
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])],
      false
    );
    expect(html).toContain("New Name");
    expect(html).toContain("no longer on either team");
    expect(html).not.toContain("swap");
  });

  it("names who is on a team but in no match", () => {
    const html = render(
      [{ a: "a1", b: "b1" }],
      [team("A", "Team Buddy", ["a1", "a2"]), team("B", "Team Banks", ["b1"])]
    );
    expect(html).toContain("Rob");
    expect(html).toContain("not in a match yet");
  });

  it("explains UNEVEN sides with both counts and the consequence", () => {
    const html = render(
      [],
      [team("A", "Team Buddy", ["a1", "a2", "b1"]), team("B", "Team Banks", ["ghost"])]
    );
    expect(html).toContain("Team Buddy has 3 and Team Banks has 1");
    expect(html).toContain("2 players will have no opponent");
  });

  it("blames the side that is actually LARGER", () => {
    // Direction, not magnitude — a version that always named the first team
    // passes an "is it uneven" check and tells the runner to cut the wrong one.
    // The whole clause is asserted, in order, because both names appear either
    // way. That exact assertion was decorative once and a mutation proved it.
    const html = render([], [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1", "a2"])]);
    expect(html).toContain("Team Banks has 2 and Team Buddy has 1");
  });

  it("does not count an EMPTY SLOT as a person", () => {
    // Half-filled rows are the normal mid-edit state; firing on every open slot
    // makes this noise, and noise is what teaches people to ignore it.
    const html = render(
      [{ a: "a1", b: null }],
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", [])]
    );
    expect(html).not.toContain("no longer on either team");
  });
});

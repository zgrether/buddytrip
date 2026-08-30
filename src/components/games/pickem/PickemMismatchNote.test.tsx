import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMismatchNote, type MismatchTeam } from "./PickemMismatchNote";

/**
 * The note that says where the pairing and the rosters disagree.
 *
 * ── The regression this pins ───────────────────────────────────────────────
 *
 * It lived inside `PickemMatchesPanel` — the read-only post-lock pairing grid,
 * since deleted, whose job the board's match cards now do. Moving the BUILDER
 * to the shared
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

/**
   * ── r7 §4: THE UNASSIGNED AND UNEVEN LINES ARE GONE ────────────────────────
   *
   * Three cases here used to assert them. They described what the pairing grid
   * six pixels below was already showing — four empty slots, and two rosters of
   * different lengths — so a paragraph naming the people was the longest way to
   * say it.
   *
   * They are replaced by their inverse rather than deleted, because "the note
   * renders nothing" is the whole point and needs to be asserted somewhere. The
   * one line that stays is the one the grid CANNOT express.
   */
  it("says NOTHING about people who are merely unpaired — the grid shows that", () => {
    const html = render(
      [{ a: "a1", b: "b1" }],
      [team("A", "Team Buddy", ["a1", "a2"]), team("B", "Team Banks", ["b1"])]
    );
    expect(html).not.toContain("not in a match yet");
    // Nothing at all, rather than an empty box: the note is its own container.
    expect(html).toBe("");
  });

  it("says NOTHING about uneven rosters either", () => {
    const html = render(
      [],
      [team("A", "Team Buddy", ["a1", "a2", "b1"]), team("B", "Team Banks", ["ghost"])]
    );
    expect(html).not.toContain("will have no opponent");
    expect(html).toBe("");
  });

  it("STILL warns about somebody paired who has left the team", () => {
    /**
     * The line the grid cannot express, and the reason this component survives
     * §4 rather than being deleted. An empty slot is visible; a slot holding
     * somebody who is no longer on either team looks exactly like a correct
     * pairing.
     *
     * Paired with the two above deliberately — "the note went quiet" is also
     * true of a build that removed all three, which would lose a real warning.
     */
    const html = render(
      [{ a: "ghost", b: "b1" }],
      [team("A", "Team Buddy", ["a1"]), team("B", "Team Banks", ["b1"])]
    );
    expect(html).toContain("no longer on either team");
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

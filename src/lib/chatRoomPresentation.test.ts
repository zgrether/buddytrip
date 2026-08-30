import { describe, it, expect } from "vitest";
import { chatRoomShowsTopFade, chatRoomTeamHeaderStyle } from "./chatRoomPresentation";

describe("chatRoomShowsTopFade", () => {
  /**
   * The whole point of this predicate: found by Zach looking at the built
   * surface — the flat top fade, painted over the team glow, read as "a drop
   * shadow cutting a hard dark band across the glow" rather than the soft
   * transition it is everywhere else. Crew and Organizers sit on a flat
   * surface the fade can blend with; the team room sits on a gradient it
   * can't, so it's the one room that suppresses it.
   */
  it("is suppressed in the team room", () => {
    expect(chatRoomShowsTopFade({ kind: "team", teamId: "t1" })).toBe(false);
  });

  it("shows in Crew and Organizers — both are a flat surface the fade can blend with", () => {
    expect(chatRoomShowsTopFade({ kind: "crew" })).toBe(true);
    expect(chatRoomShowsTopFade({ kind: "planning" })).toBe(true);
  });
});

describe("chatRoomTeamHeaderStyle", () => {
  /**
   * Pins the actual VALUES, not just "it changed" — the first version shipped
   * at 10px/uppercase/dim and read as a section label rather than the identity
   * it needs to carry as the one thing on screen saying this room is private.
   * A test asserting only "font-size is bigger than before" would pass against
   * a build that fixed the size and left the uppercase — this asserts every
   * property the fix touched.
   */
  it("is 14px, in the team's colour, not uppercase", () => {
    expect(chatRoomTeamHeaderStyle("#22c55e")).toEqual({
      fontSize: 14,
      color: "#22c55e",
      textTransform: "none",
    });
  });

  it("falls back to the accent token when the team's colour hasn't loaded", () => {
    expect(chatRoomTeamHeaderStyle(null).color).toBe("var(--color-bt-accent)");
    expect(chatRoomTeamHeaderStyle(undefined).color).toBe("var(--color-bt-accent)");
  });

  it("never uppercases, even the shape of the property — not merely omitted", () => {
    // Distinct from "no textTransform key at all", which would let the class
    // list re-introduce `uppercase` with nothing here to override it. This
    // function's whole job is to be the one place that decision is made.
    expect(chatRoomTeamHeaderStyle("#22c55e").textTransform).toBe("none");
  });
});

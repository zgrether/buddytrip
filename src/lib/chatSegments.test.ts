import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAT_SEGMENT,
  canSeePlanningSegment,
  chatTabUnreadTotal,
  hasDesignatedOrganizers,
  resolveActiveSegment,
  visibleChatSegments,
  type ChatSegmentId,
} from "./chatSegments";

// ── Chat tab segments — pure-logic tests ────────────────────────────────────
// Mirrors this codebase's convention (see TripTabBar.test.tsx): the derivation
// is extracted into plain functions and tested directly, rather than mounting
// a component — full rendering is covered by Playwright E2E.

describe("hasDesignatedOrganizers", () => {
  it("false when the trip has no Organizer members", () => {
    expect(
      hasDesignatedOrganizers([
        { role: "Owner", status: "in" },
        { role: "Member", status: "in" },
      ])
    ).toBe(false);
  });

  it("true once at least one Organizer is actually in", () => {
    expect(
      hasDesignatedOrganizers([
        { role: "Owner", status: "in" },
        { role: "Organizer", status: "in" },
      ])
    ).toBe(true);
  });

  it("ignores an Organizer who isn't actually in (e.g. only invited)", () => {
    expect(
      hasDesignatedOrganizers([
        { role: "Owner", status: "in" },
        { role: "Organizer", status: "invited" },
      ])
    ).toBe(false);
  });

  it("false for an empty roster", () => {
    expect(hasDesignatedOrganizers([])).toBe(false);
  });
});

describe("canSeePlanningSegment — requires BOTH live inputs", () => {
  it("hidden for a plain member even when organizers exist", () => {
    expect(canSeePlanningSegment(false, true)).toBe(false);
  });

  it("hidden for an owner/organizer when no organizers are designated", () => {
    // The exact regression this fix targets: a trip with only an Owner
    // (nobody promoted yet) must not show Planning to that Owner.
    expect(canSeePlanningSegment(true, false)).toBe(false);
  });

  it("visible only when the viewer can edit AND organizers exist", () => {
    expect(canSeePlanningSegment(true, true)).toBe(true);
  });

  it("hidden when neither condition holds", () => {
    expect(canSeePlanningSegment(false, false)).toBe(false);
  });
});

describe("visibleChatSegments — segment visibility matrix", () => {
  it("a plain member sees Crew · News", () => {
    const hasOrganizers = true; // organizers exist, but this viewer isn't one
    const canSeePlanning = canSeePlanningSegment(false, hasOrganizers);
    expect(visibleChatSegments(canSeePlanning)).toEqual(["crew", "news"]);
  });

  it("an organizer sees Crew · Planning · News", () => {
    const canSeePlanning = canSeePlanningSegment(true, true);
    expect(visibleChatSegments(canSeePlanning)).toEqual(["crew", "planning", "news"]);
  });

  it("the owner sees Crew · Planning · News once organizers are designated", () => {
    const canSeePlanning = canSeePlanningSegment(true, true);
    expect(visibleChatSegments(canSeePlanning)).toEqual(["crew", "planning", "news"]);
  });

  it("a trip with no organizers designated shows Crew · News even to the owner", () => {
    const hasOrganizers = false;
    const canSeePlanning = canSeePlanningSegment(/* isOwner/canEdit */ true, hasOrganizers);
    expect(visibleChatSegments(canSeePlanning)).toEqual(["crew", "news"]);
    expect(visibleChatSegments(canSeePlanning)).not.toContain("planning");
  });
});

describe("default segment", () => {
  it("is Crew, not News", () => {
    expect(DEFAULT_CHAT_SEGMENT).toBe("crew");
  });

  it("resolveActiveSegment starts on Crew for an unselected/default state", () => {
    expect(resolveActiveSegment(DEFAULT_CHAT_SEGMENT, true)).toBe("crew");
    expect(resolveActiveSegment(DEFAULT_CHAT_SEGMENT, false)).toBe("crew");
  });
});

describe("resolveActiveSegment — exactly one segment is ever active", () => {
  const ALL_SEGMENTS: ChatSegmentId[] = ["crew", "planning", "news"];

  it("falls back to Crew if Planning was selected but is no longer visible (demotion)", () => {
    expect(resolveActiveSegment("planning", false)).toBe("crew");
  });

  it("keeps the selection when Planning stays visible", () => {
    expect(resolveActiveSegment("planning", true)).toBe("planning");
  });

  it.each(ALL_SEGMENTS)("never resolves to more than one active segment (selected=%s)", (selected) => {
    for (const canSeePlanning of [true, false]) {
      const active = resolveActiveSegment(selected, canSeePlanning);
      // The old bug was two panels rendering (visible) at once. The
      // ChatView contract is: every non-active segment's wrapper is
      // `hidden`, so asserting the resolver returns a SINGLE segment id
      // (never an array, never undefined) is what guarantees only one
      // wrapper is ever left un-hidden for a given render.
      expect(ALL_SEGMENTS).toContain(active);
      expect(typeof active).toBe("string");
    }
  });
});

describe("chatTabUnreadTotal — tab badge excludes segments the caller can't see", () => {
  it("a plain member's badge excludes planning even if the count is nonzero", () => {
    // Regression fixture: unread planning messages exist (nonzero count),
    // but the viewer can't see the segment — the badge must not count them.
    const counts = { crew: 1, planning: 5, news: 0 };
    expect(chatTabUnreadTotal(counts, /* canSeePlanning */ false)).toBe(1);
  });

  it("an organizer's badge includes all three segments", () => {
    const counts = { crew: 1, planning: 5, news: 2 };
    expect(chatTabUnreadTotal(counts, true)).toBe(8);
  });

  it("zero unread everywhere is zero", () => {
    expect(chatTabUnreadTotal({ crew: 0, planning: 0, news: 0 }, true)).toBe(0);
  });
});

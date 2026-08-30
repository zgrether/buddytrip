import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAT_SEGMENT,
  canSeePlanningSegment,
  visibleChatSegments,
  resolveActiveChatSegment,
} from "./chatSegments";

describe("canSeePlanningSegment", () => {
  const withOrganizer = [
    { role: "Owner" as const, status: "in" },
    { role: "Organizer" as const, status: "in" },
    { role: "Member" as const, status: "in" },
  ];
  const noOrganizer = [
    { role: "Owner" as const, status: "in" },
    { role: "Member" as const, status: "in" },
  ];
  const pendingOrganizerInvite = [
    { role: "Owner" as const, status: "in" },
    { role: "Organizer" as const, status: "invited" },
  ];

  it("a plain member never sees Planning, even when organizers exist", () => {
    expect(canSeePlanningSegment("Member", withOrganizer)).toBe(false);
  });

  it("an Organizer sees Planning when organizers are designated", () => {
    expect(canSeePlanningSegment("Organizer", withOrganizer)).toBe(true);
  });

  it("the Owner sees Planning when organizers are designated", () => {
    expect(canSeePlanningSegment("Owner", withOrganizer)).toBe(true);
  });

  it("a trip with NO organizers designated hides Planning even from the Owner", () => {
    expect(canSeePlanningSegment("Owner", noOrganizer)).toBe(false);
  });

  it("a pending (not-yet-accepted) Organizer invite doesn't count as designated", () => {
    // Regression: role === "Organizer" alone isn't enough — an invited-but-
    // not-in member hasn't actually joined, so there's no one to plan with.
    expect(canSeePlanningSegment("Owner", pendingOrganizerInvite)).toBe(false);
  });

  it("hides Planning while role is still loading (null)", () => {
    expect(canSeePlanningSegment(null, withOrganizer)).toBe(false);
  });
});

describe("visibleChatSegments", () => {
  const access = (canSeePlanning: boolean, hasTeam: boolean) => ({ canSeePlanning, hasTeam });

  it("plain member / no-organizer trip, no team: Crew and News only", () => {
    expect(visibleChatSegments(access(false, false))).toEqual(["crew", "news"]);
  });

  it("organizer or owner on a trip with organizers, no team: Planning in the middle", () => {
    expect(visibleChatSegments(access(true, false))).toEqual(["crew", "planning", "news"]);
  });

  it("a plain member ON a team gets Team, and no Planning", () => {
    // The decisive case for "no Team tab for someone on no team": the ONLY
    // difference from the first case is hasTeam, so a build that keyed the Team
    // tab off anything else (role, competition existence) fails here.
    expect(visibleChatSegments(access(false, true))).toEqual(["crew", "team", "news"]);
  });

  it("all four, in order: Crew · Team · Organizers · News", () => {
    expect(visibleChatSegments(access(true, true))).toEqual([
      "crew",
      "team",
      "planning",
      "news",
    ]);
  });
});

describe("default segment", () => {
  it("defaults to Crew, not News", () => {
    expect(DEFAULT_CHAT_SEGMENT).toBe("crew");
  });
});

describe("resolveActiveChatSegment", () => {
  const access = (canSeePlanning: boolean, hasTeam: boolean) => ({ canSeePlanning, hasTeam });

  it("keeps the current selection when it's still visible", () => {
    expect(resolveActiveChatSegment("planning", access(true, false))).toBe("planning");
    expect(resolveActiveChatSegment("news", access(false, false))).toBe("news");
    expect(resolveActiveChatSegment("crew", access(false, false))).toBe("crew");
    expect(resolveActiveChatSegment("team", access(false, true))).toBe("team");
  });

  it("falls back to Crew when Planning was selected but access is lost (demotion)", () => {
    expect(resolveActiveChatSegment("planning", access(false, false))).toBe("crew");
  });

  /**
   * The segment is remembered for the SESSION and chat is a trip-scoped
   * overlay, so this is not an edge case: open chat on a trip where you have a
   * team, then open it on one where you do not, and without this the bar would
   * highlight a Team tab it is not rendering.
   */
  it("falls back to Crew when Team was selected but there is no team", () => {
    expect(resolveActiveChatSegment("team", access(false, false))).toBe("crew");
    expect(resolveActiveChatSegment("team", access(true, false))).toBe("crew");
  });
});

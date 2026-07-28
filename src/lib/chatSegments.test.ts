import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHAT_SEGMENT,
  canSeePlanningSegment,
  visibleChatSegments,
  resolveActiveChatSegment,
} from "./chatSegments";

describe("canSeePlanningSegment", () => {
  const withOrganizer = [
    { role: "Owner" as const },
    { role: "Organizer" as const },
    { role: "Member" as const },
  ];
  const noOrganizer = [{ role: "Owner" as const }, { role: "Member" as const }];

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

  it("hides Planning while role is still loading (null)", () => {
    expect(canSeePlanningSegment(null, withOrganizer)).toBe(false);
  });
});

describe("visibleChatSegments", () => {
  it("plain member / no-organizer trip: Crew and News only", () => {
    expect(visibleChatSegments(false)).toEqual(["crew", "news"]);
  });

  it("organizer or owner on a trip with organizers: all three, Planning in the middle", () => {
    expect(visibleChatSegments(true)).toEqual(["crew", "planning", "news"]);
  });
});

describe("default segment", () => {
  it("defaults to Crew, not News", () => {
    expect(DEFAULT_CHAT_SEGMENT).toBe("crew");
  });
});

describe("resolveActiveChatSegment", () => {
  it("keeps the current selection when it's still visible", () => {
    expect(resolveActiveChatSegment("planning", true)).toBe("planning");
    expect(resolveActiveChatSegment("news", false)).toBe("news");
    expect(resolveActiveChatSegment("crew", false)).toBe("crew");
  });

  it("falls back to Crew when Planning was selected but access is lost (demotion)", () => {
    expect(resolveActiveChatSegment("planning", false)).toBe("crew");
  });
});

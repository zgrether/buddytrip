import { describe, it, expect } from "vitest";

/**
 * Unit tests for pure logic in DatesSection.
 *
 * These test the confirmed-member derivation and low-crew banner threshold:
 *   - confirmedMembers: members whose status is in ["in", "likely", "maybe", "out"]
 *   - isLowCrew: confirmedMembers.length < 4 → amber banner shown
 */

// ── Mirrors DatesSection confirmed-member filter ───────────────────────────

type MemberStatus = "in" | "likely" | "maybe" | "out" | "invited" | "declined";

function getConfirmedMembers(members: { status: MemberStatus }[]) {
  return members.filter(
    (m) =>
      m.status === "in" ||
      m.status === "likely" ||
      m.status === "maybe" ||
      m.status === "out"
  );
}

function isLowCrew(confirmedCount: number) {
  return confirmedCount < 4;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DatesSection: confirmed member filter", () => {
  it("counts in/likely/maybe/out as confirmed", () => {
    const members = [
      { status: "in" as MemberStatus },
      { status: "likely" as MemberStatus },
      { status: "maybe" as MemberStatus },
      { status: "out" as MemberStatus },
    ];
    expect(getConfirmedMembers(members)).toHaveLength(4);
  });

  it("excludes invited and declined members", () => {
    const members = [
      { status: "invited" as MemberStatus },
      { status: "declined" as MemberStatus },
      { status: "in" as MemberStatus },
    ];
    expect(getConfirmedMembers(members)).toHaveLength(1);
  });
});

describe("DatesSection: low-crew banner threshold", () => {
  it("shows amber banner when fewer than 4 confirmed members", () => {
    expect(isLowCrew(0)).toBe(true);
    expect(isLowCrew(1)).toBe(true);
    expect(isLowCrew(2)).toBe(true);
    expect(isLowCrew(3)).toBe(true);
  });

  it("hides banner when 4 or more confirmed members", () => {
    expect(isLowCrew(4)).toBe(false);
    expect(isLowCrew(5)).toBe(false);
    expect(isLowCrew(10)).toBe(false);
  });

  it("banner threshold: exactly 3 confirmed members triggers banner", () => {
    const members = [
      { status: "in" as MemberStatus },
      { status: "likely" as MemberStatus },
      { status: "maybe" as MemberStatus },
      { status: "invited" as MemberStatus }, // not confirmed
    ];
    const confirmed = getConfirmedMembers(members);
    expect(isLowCrew(confirmed.length)).toBe(true);
  });

  it("banner absent: exactly 4 confirmed members", () => {
    const members = [
      { status: "in" as MemberStatus },
      { status: "likely" as MemberStatus },
      { status: "maybe" as MemberStatus },
      { status: "out" as MemberStatus },
    ];
    const confirmed = getConfirmedMembers(members);
    expect(isLowCrew(confirmed.length)).toBe(false);
  });
});

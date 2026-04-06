import { describe, it, expect } from "vitest";

/**
 * Unit tests for pure logic in DatesSection.
 *
 * These test the confirmed-member derivation:
 *   - confirmedMembers: members whose status is in ["in", "likely", "maybe", "out"]
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

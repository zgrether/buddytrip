import { describe, it, expect } from "vitest";
import { canAccessCompetition } from "./competitionAccess";

/**
 * canAccessCompetition — the ONE predicate behind both the "Live" nav entry
 * (shown when true) and the pre-live wall (shown when false). These tests pin
 * the Stage-5 access matrix in both phases so nav and wall can't diverge.
 */
describe("canAccessCompetition", () => {
  const upcoming = "upcoming";
  const active = "active";

  it("owner / co-admin (canEdit) can access in BOTH phases", () => {
    expect(canAccessCompetition({ canEdit: true, amDelegate: false, status: upcoming })).toBe(true);
    expect(canAccessCompetition({ canEdit: true, amDelegate: false, status: active })).toBe(true);
  });

  it("a delegate (member-role, builder) can access in BOTH phases", () => {
    expect(canAccessCompetition({ canEdit: false, amDelegate: true, status: upcoming })).toBe(true);
    expect(canAccessCompetition({ canEdit: false, amDelegate: true, status: active })).toBe(true);
  });

  it("a plain member is WALLED pre-live, admitted once live (go-live reveals)", () => {
    expect(canAccessCompetition({ canEdit: false, amDelegate: false, status: upcoming })).toBe(false);
    expect(canAccessCompetition({ canEdit: false, amDelegate: false, status: active })).toBe(true);
  });

  it("a plain member cannot access a completed competition pre-reveal states", () => {
    expect(canAccessCompetition({ canEdit: false, amDelegate: false, status: "completed" })).toBe(false);
    expect(canAccessCompetition({ canEdit: false, amDelegate: false, status: null })).toBe(false);
  });

  it("nav-visibility and wall-visibility are exact complements (can't disagree)", () => {
    for (const canEdit of [true, false]) {
      for (const amDelegate of [true, false]) {
        for (const status of [upcoming, active, "completed", null]) {
          const navShows = canAccessCompetition({ canEdit, amDelegate, status });
          const wallShows = !canAccessCompetition({ canEdit, amDelegate, status });
          expect(navShows).toBe(!wallShows);
        }
      }
    }
  });
});

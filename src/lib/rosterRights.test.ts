import { describe, it, expect } from "vitest";
import { rosterRights } from "./rosterRights";

// Each case pins one refusal the server makes (migrations 199/200 and
// assertRosterUnlocked), so the screen never offers what the server refuses and
// never hides what it allows.
const ME = "me";
const TEAMMATE = "teammate";

describe("rosterRights — staff (Owner or Organizer)", () => {
  it("before results: add, trade, and remove anyone including themselves", () => {
    const r = rosterRights({ staff: true, captainOfTeam: false, locked: false, viewerId: ME });
    expect([r.add, r.trade, r.remove(TEAMMATE), r.remove(ME), r.captainLocked]).toEqual([true, true, "enabled", "enabled", false]);
  });

  it("after results: adds stay open, trades stop, and the × shows LOCKED rather than vanishing", () => {
    const r = rosterRights({ staff: true, captainOfTeam: false, locked: true, viewerId: ME });
    expect([r.add, r.trade, r.remove(TEAMMATE), r.captainLocked]).toEqual([true, false, "locked", false]);
  });

  it("staff who also captain get STAFF rights, not the captain's narrower ones", () => {
    const r = rosterRights({ staff: true, captainOfTeam: true, locked: true, viewerId: ME });
    expect([r.add, r.remove(ME), r.captainLocked]).toEqual([true, "locked", false]);
  });
});

describe("rosterRights — captain of this team (not staff)", () => {
  it("before results: add and remove teammates, but never trade", () => {
    const r = rosterRights({ staff: false, captainOfTeam: true, locked: false, viewerId: ME });
    expect([r.add, r.trade, r.remove(TEAMMATE), r.captainLocked]).toEqual([true, false, "enabled", false]);
  });

  it("never removes themselves — the server refuses it, so the × is not offered", () => {
    const r = rosterRights({ staff: false, captainOfTeam: true, locked: false, viewerId: ME });
    expect(r.remove(ME)).toBe("hidden");
  });

  it("after results: nothing at all, and the note says who can still act", () => {
    const r = rosterRights({ staff: false, captainOfTeam: true, locked: true, viewerId: ME });
    expect([r.add, r.trade, r.remove(TEAMMATE), r.captainLocked]).toEqual([false, false, "hidden", true]);
  });
});

describe("rosterRights — everyone else", () => {
  it("a plain member (or a game delegate — delegation grants no roster rights) is read-only", () => {
    for (const locked of [false, true]) {
      const r = rosterRights({ staff: false, captainOfTeam: false, locked, viewerId: ME });
      expect([r.add, r.trade, r.remove(TEAMMATE), r.remove(ME), r.captainLocked]).toEqual([false, false, "hidden", "hidden", false]);
    }
  });
});

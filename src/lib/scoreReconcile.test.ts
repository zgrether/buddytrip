import { describe, it, expect } from "vitest";
import { reconcileScores } from "./scoreReconcile";
import { scoreCellKey, type ScoreValues } from "@/components/games/types";

const NONE = new Set<string>();

describe("reconcileScores — merge server truth without clobbering the enterer", () => {
  it("adds a teammate's new score from the server", () => {
    const local: ScoreValues = { u1: { "1": 4 } };
    const server: ScoreValues = { u1: { "1": 4 }, u2: { "1": 5 } };
    expect(reconcileScores(local, server, NONE)).toEqual({ u1: { "1": 4 }, u2: { "1": 5 } });
  });

  it("reflects a remote EDIT to a confirmed cell (server value wins when not protected)", () => {
    const local: ScoreValues = { u1: { "1": 4 } };
    const server: ScoreValues = { u1: { "1": 5 } }; // corrected elsewhere
    expect(reconcileScores(local, server, NONE)).toEqual({ u1: { "1": 5 } });
  });

  it("does NOT overwrite an unconfirmed local cell (the enterer wins)", () => {
    const local: ScoreValues = { u1: { "1": 7 } }; // just typed, still saving
    const server: ScoreValues = { u1: { "1": 4 } }; // stale server value
    const prot = new Set([scoreCellKey("u1", "1")]);
    expect(reconcileScores(local, server, prot)).toEqual({ u1: { "1": 7 } });
  });

  // A cell the server doesn't have was CLEARED elsewhere. This used to be the
  // documented gap — the merge only overlaid, so a remote clear reached no other
  // device until a full exit and re-entry (the #807 asymmetry). The scenario that
  // gap existed to protect (a poll racing a fresh save) is now covered by
  // protection, not by refusing to remove — see the next test.
  it("DROPS an unprotected local cell the server no longer has (remote clear)", () => {
    const local: ScoreValues = { u1: { "1": 4, "2": 6 } };
    const server: ScoreValues = { u1: { "1": 4 } }; // hole 2 cleared on another device
    expect(reconcileScores(local, server, NONE)).toEqual({ u1: { "1": 4 } });
  });

  it("keeps a PROTECTED cell the server payload lacks (poll racing a fresh save)", () => {
    const local: ScoreValues = { u1: { "1": 4, "2": 6 } }; // hole 2 just saved
    const server: ScoreValues = { u1: { "1": 4 } }; // response predates hole 2
    // In useScoreSaver this key is protected by `saving`/outbox, and for a few
    // seconds after confirmation by CONFIRM_GRACE_MS — so the removal above can
    // never take a score the enterer just watched save (#15).
    const prot = new Set([scoreCellKey("u1", "2")]);
    expect(reconcileScores(local, server, prot)).toEqual({ u1: { "1": 4, "2": 6 } });
  });

  it("removes a participant's last cell without leaving a stale value behind", () => {
    const local: ScoreValues = { u1: { "1": 4 }, u2: { "1": 5 } };
    const server: ScoreValues = { u1: { "1": 4 } }; // u2's only score cleared
    expect(reconcileScores(local, server, NONE)).toEqual({ u1: { "1": 4 }, u2: {} });
  });

  it("protects an unconfirmed cell but still applies server truth to OTHER cells", () => {
    const local: ScoreValues = { u1: { "1": 7 }, u2: { "1": 3 } };
    const server: ScoreValues = { u1: { "1": 4 }, u2: { "1": 5 }, u3: { "1": 2 } };
    const prot = new Set([scoreCellKey("u1", "1")]); // u1/1 is mid-save locally
    expect(reconcileScores(local, server, prot)).toEqual({
      u1: { "1": 7 }, // kept (protected)
      u2: { "1": 5 }, // updated to server
      u3: { "1": 2 }, // added from server
    });
  });

  it("seeds from empty local (initial load takes the server scores)", () => {
    const server: ScoreValues = { u1: { "1": 4, "2": 5 } };
    expect(reconcileScores({}, server, NONE)).toEqual({ u1: { "1": 4, "2": 5 } });
  });

  it("does not mutate the inputs", () => {
    const local: ScoreValues = { u1: { "1": 4 } };
    const server: ScoreValues = { u1: { "1": 5 } };
    reconcileScores(local, server, NONE);
    expect(local).toEqual({ u1: { "1": 4 } });
    expect(server).toEqual({ u1: { "1": 5 } });
  });
});

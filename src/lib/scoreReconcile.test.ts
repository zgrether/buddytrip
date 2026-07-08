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

  it("never drops a local cell the server payload lacks (poll racing a fresh save)", () => {
    const local: ScoreValues = { u1: { "1": 4, "2": 6 } }; // hole 2 just saved
    const server: ScoreValues = { u1: { "1": 4 } }; // response predates hole 2
    // Even unprotected, the missing cell is kept — overlay only SETS server cells.
    expect(reconcileScores(local, server, NONE)).toEqual({ u1: { "1": 4, "2": 6 } });
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
